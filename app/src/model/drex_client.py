"""Drex decision-model client: prompts, request building, one call per persona x variant.

Deliberately plain: no retries, no cache. Any non-200 raises with the response body.
"""
import time

import httpx

from .. import config
from ..models import Decision, Persona, Variant
from ..ndi.ndi_client import describe_error

# ---- Prompts (tune here) ----------------------------------------------------

TASK = (
    "You are simulating whether this shopper would purchase this product after reading its "
    "product page. The persona describes who they are, what they care about and their dealbreakers; "
    "the product lists everything the page says about it."
)

# Drex `choice` questions need a fixed label set; it returns a probability for each label.
SKIP_REASONS = {
    "price": "Too expensive for their budget or not worth the price to them",
    "missing_feature": "Lacks a feature or spec they need",
    "quality_trust": "Doubts about quality, brand credibility, or weak reviews/social proof",
    "shipping_returns": "Shipping, return policy, or warranty terms are a problem",
    "unclear_value": "The value proposition or product description is confusing",
    "not_target_user": "The product is not relevant to their life or needs",
    "would_buy": "Nothing meaningfully holds them back",
}

QUESTIONS = {
    "buy": {
        "type": "noul",
        "instructions": (
            "Given this shopper's budget, priorities, dealbreakers and shopping style, would they buy "
            "this product? Yes = they would purchase. No = they would skip."
        ),
    },
    "skip_reason": {
        "type": "choice",
        "instructions": (
            "What is the single biggest reason this shopper might NOT buy this product? "
            "Pick 'would_buy' if nothing meaningfully holds them back."
        ),
        "criteria": SKIP_REASONS,
    },
}


class DrexError(RuntimeError):
    pass


def client() -> httpx.AsyncClient:
    if not config.NACE_API_KEY:
        raise DrexError("NACE_API_KEY is not set in shelf-test/.env")
    return httpx.AsyncClient(
        base_url=config.DREX_BASE_URL,
        timeout=60,
        headers={"Authorization": f"Bearer {config.NACE_API_KEY}"},
    )


MARKET_TASK = (
    " The shopper has also seen what else is on the market right now (competitor prices, features most "
    "competitors have, common complaints in the category) and compares this product against it."
)


def build_state(persona: Persona, variant: Variant, market: dict | None = None) -> dict:
    """market: MarketIntel.decision_context(variant_id) from live Keenable research, or None."""
    state = {"task": TASK + (MARKET_TASK if market else ""), "persona": persona.decision_view(),
             "product": variant.as_product()}
    if market:
        state["market"] = market
    return state


def outcome_for(p_buy: float) -> str:
    if p_buy >= config.BUY_THRESHOLD:
        return "buy"
    if p_buy >= config.CONSIDER_THRESHOLD:
        return "consider"
    return "reject"


async def evaluate(http: httpx.AsyncClient, persona: Persona, variant: Variant,
                   market: dict | None = None) -> Decision:
    """One Drex call -> Decision."""
    payload = {"model": config.DREX_MODEL, "state": build_state(persona, variant, market), "questions": QUESTIONS}
    t0 = time.perf_counter()
    r = await http.post("/v1/systemone", json=payload)
    latency = (time.perf_counter() - t0) * 1000
    if r.status_code != 200:
        raise DrexError(describe_error("Drex", r))
    return parse_decision(r.json(), persona.id, variant.variant_id, latency)


def parse_decision(resp: dict, persona_id: str, variant_id: str, latency_ms: float | None = None) -> Decision:
    buy = resp["answers"]["buy"]
    sr = resp["answers"]["skip_reason"]
    p_buy = float(buy["noul"])
    conf = float(buy.get("confidence", 0.5 + abs(p_buy - 0.5)))
    probs = {k: float(v) for k, v in (sr.get("probabilities") or {sr["choice"]: sr.get("confidence", 1.0)}).items()}
    outcome = outcome_for(p_buy)

    if outcome == "buy":
        reason = "would_buy"
    else:  # a non-buyer always gets a real reason, even if Drex's top label is would_buy
        others = {k: v for k, v in probs.items() if k != "would_buy"}
        reason = max(others, key=others.get) if others else sr["choice"]

    return Decision(
        persona_id=persona_id,
        variant_id=variant_id,
        p_buy=p_buy,
        buy_confidence=conf,
        outcome=outcome,
        skip_reason=reason,
        skip_reason_probs=probs,
        skip_reason_confidence=float(sr.get("confidence", probs.get(reason, 0.0))),
        low_confidence=conf < config.LOW_CONFIDENCE,
        request_id=resp.get("request_id"),
        latency_ms=resp.get("evaluation_time_ms", latency_ms),
    )
