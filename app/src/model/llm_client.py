"""LLM decision model on DeepInfra (OpenAI-compatible API) answering the same two questions as Drex.

Same state (TASK + persona + product), same skip-reason labels, same Decision output, so the
analysis code and the benchmark treat both models identically.
"""
import json
import time

import httpx

from .. import config
from ..models import Decision, Persona, Variant
from .drex_client import SKIP_REASONS, build_state, outcome_for

SYSTEM = (
    "You are a purchase-decision simulator. You get a shopper persona and a product page and "
    "predict how that shopper would react. Answer ONLY with a JSON object."
)

INSTRUCTIONS = (
    "1. p_buy: probability from 0 to 1 that this shopper would buy this product, given their budget, "
    "priorities, dealbreakers and shopping style.\n"
    "2. skip_reason_probs: a probability for EVERY label below (summing to 1) for the single biggest "
    "reason this shopper might NOT buy. Use 'would_buy' if nothing meaningfully holds them back.\n"
    "Labels:\n" + "\n".join(f"- {k}: {v}" for k, v in SKIP_REASONS.items()) +
    '\n\nRespond exactly as: {"p_buy": 0.0, "skip_reason_probs": {"price": 0.0, ...}}'
)


class LLMError(RuntimeError):
    pass


def client() -> httpx.AsyncClient:
    if not config.DEEPINFRA_API_KEY:
        raise LLMError("DEEPINFRA_API_KEY is not set in shelf-test/.env")
    return httpx.AsyncClient(
        base_url=config.DEEPINFRA_BASE_URL,
        timeout=90,
        headers={"Authorization": f"Bearer {config.DEEPINFRA_API_KEY}"},
    )


def build_messages(persona: Persona, variant: Variant, market: dict | None = None) -> list[dict]:
    state = build_state(persona, variant, market)
    user = (f"Task: {state['task']}\n\nShopper persona:\n{json.dumps(state['persona'], indent=1)}\n\n"
            f"Product page:\n{json.dumps(state['product'], indent=1)}\n\n"
            + (f"Current market:\n{json.dumps(state['market'], indent=1)}\n\n" if market else "")
            + INSTRUCTIONS)
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


async def evaluate(http: httpx.AsyncClient, persona: Persona, variant: Variant,
                   model: str | None = None, market: dict | None = None) -> tuple[Decision, dict]:
    """One LLM call -> (Decision, usage)."""
    payload = {
        "model": model or config.LLM_MODEL,
        "messages": build_messages(persona, variant, market),
        "temperature": config.LLM_TEMPERATURE,
        "max_tokens": 300,
        "response_format": {"type": "json_object"},
    }
    t0 = time.perf_counter()
    for attempt in range(3):  # retry only on rate limit / transient server errors
        r = await http.post("/chat/completions", json=payload)
        if r.status_code not in (429, 500, 502, 503):
            break
        await _sleep(2 ** attempt)
    latency = (time.perf_counter() - t0) * 1000
    if r.status_code != 200:
        raise LLMError(f"DeepInfra {r.status_code}: {r.text[:500]}")
    data = r.json()
    text = data["choices"][0]["message"]["content"]
    return parse_answer(text, persona.id, variant.variant_id, latency), data.get("usage", {})


async def _sleep(s: float):
    import asyncio
    await asyncio.sleep(s)


def parse_answer(text: str, persona_id: str, variant_id: str, latency_ms: float) -> Decision:
    try:
        obj = json.loads(text[text.index("{"): text.rindex("}") + 1])
        p_buy = min(1.0, max(0.0, float(obj["p_buy"])))
        raw = {k: max(0.0, float(v)) for k, v in obj.get("skip_reason_probs", {}).items() if k in SKIP_REASONS}
    except (ValueError, KeyError, TypeError) as e:
        raise LLMError(f"unparseable LLM answer: {text[:300]}") from e
    total = sum(raw.values())
    probs = {k: raw.get(k, 0.0) / total for k in SKIP_REASONS} if total else {"would_buy": 1.0}
    outcome = outcome_for(p_buy)
    others = {k: v for k, v in probs.items() if k != "would_buy"}
    reason = "would_buy" if outcome == "buy" or not others else max(others, key=others.get)
    conf = 0.5 + abs(p_buy - 0.5)  # same proxy Drex uses when it gives no confidence
    return Decision(
        persona_id=persona_id, variant_id=variant_id, p_buy=p_buy, buy_confidence=conf,
        outcome=outcome, skip_reason=reason, skip_reason_probs=probs,
        skip_reason_confidence=probs.get(reason, 0.0), low_confidence=conf < config.LOW_CONFIDENCE,
        latency_ms=latency_ms,
    )


async def chat_json(messages: list[dict], max_tokens: int = 1500, model: str | None = None) -> dict:
    """One JSON-mode chat completion on DeepInfra -> parsed object (used by market intel)."""
    async with client() as http:
        http.timeout = httpx.Timeout(240)
        payload = {"model": model or config.LLM_MODEL, "messages": messages, "temperature": 0,
                   "max_tokens": max_tokens, "response_format": {"type": "json_object"}}
        for attempt in range(3):
            r = await http.post("/chat/completions", json=payload)
            if r.status_code not in (429, 500, 502, 503):
                break
            await _sleep(2 ** attempt)
    if r.status_code != 200:
        raise LLMError(f"DeepInfra {r.status_code}: {r.text[:500]}")
    text = r.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError as e:
        raise LLMError(f"unparseable LLM JSON: {text[:300]}") from e
