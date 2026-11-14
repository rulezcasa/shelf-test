"""Run every customer x product through Drex (and the transparent baseline), concurrently."""
import asyncio
import json
import logging
import time
from datetime import datetime

from . import baseline, config
from .drex_client import DrexClient, outcome_for
from .models import Customer, CustomerDecision, Product

log = logging.getLogger(__name__)


def baseline_decision(c: Customer, p: Product) -> CustomerDecision:
    b = baseline.score(c, p)
    probs = b["skip_reason_probs"]
    outcome = outcome_for(b["p_buy"])
    others = {k: v for k, v in probs.items() if k != "would_buy"}
    reason = "would_buy" if outcome == "buy" else max(others, key=others.get)
    conf = 0.5 + abs(b["p_buy"] - 0.5)
    return CustomerDecision(
        customer_id=c.customer_id, product_id=p.product_id, p_buy=b["p_buy"], buy_confidence=conf,
        outcome=outcome, skip_reason=reason, skip_reason_probs=probs,
        skip_reason_confidence=probs.get(reason, 0.0), low_confidence=conf < config.LOW_CONFIDENCE,
        source="baseline", latency_ms=0.0,
    )


async def run_panel(customers: list[Customer], products: list[Product], on_progress=None,
                    mock: bool | None = None, save: bool = True) -> dict:
    """Returns {"decisions": [...Drex/mock...], "baseline": [...], "stats": {...}}."""
    sem = asyncio.Semaphore(config.DREX_CONCURRENCY)
    pairs = [(c, p) for c in customers for p in products]
    total, done, failures = len(pairs), 0, []
    decisions: list[CustomerDecision] = []
    t0 = time.perf_counter()

    async with DrexClient(mock=mock) as drex:
        async def one(c: Customer, p: Product):
            nonlocal done
            async with sem:
                try:
                    decisions.append(await drex.evaluate(c, p))
                except Exception as e:  # a failed pair is logged and skipped
                    log.error("pair %s x %s failed: %s", c.customer_id, p.product_id, e)
                    failures.append({"customer_id": c.customer_id, "product_id": p.product_id, "error": str(e)})
            done += 1
            if on_progress:
                on_progress(done, total)

        await asyncio.gather(*(one(c, p) for c, p in pairs))
        tokens, is_mock = drex.input_tokens, drex.mock

    wall = time.perf_counter() - t0
    live = sorted(d.latency_ms for d in decisions if not d.cached and d.latency_ms)
    result = {
        "decisions": decisions,
        "baseline": [baseline_decision(c, p) for c, p in pairs],
        "stats": {
            "pairs": total, "ok": len(decisions), "failed": len(failures), "failures": failures[:20],
            "wall_s": round(wall, 3), "cached": sum(d.cached for d in decisions),
            "median_latency_ms": live[len(live) // 2] if live else None,
            "input_tokens": tokens, "mock": is_mock,
            "buy_threshold": config.BUY_THRESHOLD, "consider_threshold": config.CONSIDER_THRESHOLD,
        },
    }
    if save:
        result["stats"]["run_file"] = str(save_run(result, customers, products))
    return result


def save_run(result: dict, customers: list[Customer], products: list[Product]):
    runs = config.RUNS_DIR
    runs.mkdir(parents=True, exist_ok=True)
    path = runs / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps({
        "stats": result["stats"],
        "products": [p.model_dump() for p in products],
        "customer_ids": [c.customer_id for c in customers],
        "decisions": [d.model_dump() for d in result["decisions"]],
        "baseline": [d.model_dump() for d in result["baseline"]],
    }, indent=1))
    return path
