"""Drex decision-model client: prompts, request building, retries, cache, mock mode."""
import asyncio
import hashlib
import json
import logging
import random
import time

import httpx

from . import baseline, config
from .models import Customer, CustomerDecision, Product

log = logging.getLogger(__name__)

# ---- Prompts (tune here) ----------------------------------------------------

TASK = (
    "You are simulating whether this shopper would purchase this pair of headphones after "
    "reading its product brochure. Preference scores are 0-1 (1 = matters a lot). "
    "headphone_budget_usd is what they planned to spend."
)

SKIP_REASONS = {
    "price": "Too expensive for their budget or not worth the price to them",
    "battery_life": "Battery life is not enough for how they use headphones",
    "portability_comfort": "Too heavy, bulky or not portable enough",
    "connectivity": "Lacks connectivity they need, e.g. multipoint Bluetooth",
    "missing_feature": "Lacks another feature they need (ANC, water resistance, charging)",
    "quality_trust": "Doubts about sound/build quality, brand, or warranty",
    "not_a_fit": "The product does not fit their use case or taste",
    "would_buy": "Nothing meaningfully holds them back",
}

QUESTIONS = {
    "buy": {
        "type": "noul",
        "instructions": (
            "Given this shopper's budget, price sensitivity, feature preferences and primary use "
            "case, would they buy this product? Yes = they would purchase. No = they would skip."
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

RETRY_STATUS = {429, 500, 502, 503, 529}
MAX_ATTEMPTS = 4


class DrexError(RuntimeError):
    pass


def build_state(customer: Customer, product: Product) -> dict:
    return {"task": TASK, "shopper": customer.decision_inputs(), "product": product.decision_view()}


def cache_key(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def outcome_for(p_buy: float) -> str:
    if p_buy >= config.BUY_THRESHOLD:
        return "buy"
    if p_buy >= config.CONSIDER_THRESHOLD:
        return "consider"
    return "reject"


class DrexClient:
    def __init__(self, mock: bool | None = None, model: str | None = None, use_cache: bool = True):
        self.mock = config.MOCK_DREX if mock is None else mock
        self.model = model or config.DREX_MODEL
        self.use_cache = use_cache
        self.cache_dir = config.CACHE_DIR / "drex"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.input_tokens = 0
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self):
        if not self.mock:
            if not config.NACE_API_KEY or config.NACE_API_KEY.startswith("nace_sk_..."):
                raise DrexError("NACE_API_KEY is not set in app/.env (or set MOCK_DREX=true)")
            self._http = httpx.AsyncClient(
                base_url=config.DREX_BASE_URL,
                timeout=60,
                headers={"Authorization": f"Bearer {config.NACE_API_KEY}"},
            )
        return self

    async def __aexit__(self, *exc):
        if self._http:
            await self._http.aclose()

    # -- raw call ---------------------------------------------------------------

    async def decide(self, state: dict, questions: dict = QUESTIONS) -> tuple[dict, bool]:
        """Return (raw response, cached?)."""
        payload = {"model": self.model, "state": state, "questions": questions}
        key = cache_key({**payload, "mock": self.mock})
        path = self.cache_dir / f"{key}.json"
        if self.use_cache and path.exists():
            return json.loads(path.read_text()), True

        resp = self._mock_response(state, key) if self.mock else await self._post(payload)
        if self.use_cache:
            path.write_text(json.dumps(resp))
        return resp, False

    async def _post(self, payload: dict) -> dict:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            t0 = time.perf_counter()
            try:
                r = await self._http.post("/v1/systemone", json=payload)
            except httpx.TransportError as e:
                if attempt == MAX_ATTEMPTS:
                    raise DrexError(f"network error: {e}") from e
            else:
                if r.status_code == 200:
                    data = r.json()
                    data.setdefault("evaluation_time_ms", (time.perf_counter() - t0) * 1000)
                    self.input_tokens += data.get("usage", {}).get("input_tokens", 0)
                    return data
                if r.status_code not in RETRY_STATUS or attempt == MAX_ATTEMPTS:
                    raise DrexError(f"Drex {r.status_code}: {r.text}")
                log.warning("Drex %s, retry %d", r.status_code, attempt)
            await asyncio.sleep(min(2 ** attempt, 20) * 0.5 + random.random())
        raise DrexError("unreachable")

    def _mock_response(self, state: dict, key: str) -> dict:
        c = Customer(customer_id="mock", age_band="", gender="", income_band="",
                     brand_loyalty=0.5, **state["shopper"])
        p = Product(product_id="mock", **state["product"])
        b = baseline.score(c, p)
        jitter = (int(key[:8], 16) / 0xFFFFFFFF - 0.5) * 0.06  # deterministic +-3pts
        p_buy = min(1.0, max(0.0, b["p_buy"] + jitter))
        probs = b["skip_reason_probs"]
        top = max(probs, key=probs.get)
        return {
            "model": "mock-baseline",
            "answers": {
                "buy": {"type": "noul", "noul": round(p_buy, 4), "confidence": round(0.5 + abs(p_buy - 0.5), 4)},
                "skip_reason": {"type": "choice", "choice": top, "confidence": probs[top], "probabilities": probs},
            },
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "evaluation_time_ms": 0.0,
            "request_id": f"mock_{key[:12]}",
        }

    # -- typed call -------------------------------------------------------------

    async def evaluate(self, customer: Customer, product: Product) -> CustomerDecision:
        resp, cached = await self.decide(build_state(customer, product))
        return parse_decision(resp, customer.customer_id, product.product_id,
                              source="mock" if self.mock else "drex", cached=cached)


def parse_decision(resp: dict, customer_id: str, product_id: str, source: str, cached: bool = False) -> CustomerDecision:
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

    return CustomerDecision(
        customer_id=customer_id,
        product_id=product_id,
        p_buy=p_buy,
        buy_confidence=conf,
        outcome=outcome,
        skip_reason=reason,
        skip_reason_probs=probs,
        skip_reason_confidence=float(sr.get("confidence", probs.get(reason, 0.0))),
        low_confidence=conf < config.LOW_CONFIDENCE,
        source=source,
        request_id=resp.get("request_id"),
        latency_ms=resp.get("evaluation_time_ms"),
        cached=cached,
    )
