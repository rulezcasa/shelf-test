"""Run every persona x variant of a product through Drex, concurrently."""
import asyncio
import json
import logging
import time

from .. import config
from ..models import Decision, Persona, Variant
from . import drex_client

log = logging.getLogger(__name__)


def load_personas(limit: int | None = None) -> list[Persona]:
    """Our persona panel (data/personas.json, written by scripts/gen_personas.py)."""
    return [Persona(**p) for p in json.loads(config.PERSONAS_PATH.read_text())[:limit]]


async def run_panel(personas: list[Persona], variants: list[Variant], on_progress=None,
                    market=None) -> dict:
    """Returns {"decisions": [Decision...], "stats": {...}}. A failed pair is logged and skipped.

    on_progress(done, total, decision_or_None) is called after every pair (None = that pair failed).
    market: optional MarketIntel; each variant then sees its own market context.
    """
    sem = asyncio.Semaphore(config.DREX_CONCURRENCY)
    pairs = [(p, v) for p in personas for v in variants]
    total, done, failures = len(pairs), 0, []
    decisions: list[Decision] = []
    t0 = time.perf_counter()

    async with drex_client.client() as http:
        async def one(p: Persona, v: Variant):
            nonlocal done
            d = None
            async with sem:
                try:
                    ctx = market.decision_context(v.variant_id) if market else None
                    d = await drex_client.evaluate(http, p, v, ctx)
                    decisions.append(d)
                except Exception as e:
                    log.error("pair %s x %s failed: %s", p.id, v.variant_id, e)
                    failures.append({"persona_id": p.id, "variant_id": v.variant_id, "error": str(e)})
            done += 1
            if on_progress:
                on_progress(done, total, d)

        await asyncio.gather(*(one(p, v) for p, v in pairs))

    lat = sorted(d.latency_ms for d in decisions if d.latency_ms)
    return {
        "decisions": decisions,
        "stats": {
            "pairs": total, "ok": len(decisions), "failed": len(failures), "failures": failures[:20],
            "wall_s": round(time.perf_counter() - t0, 3),
            "median_latency_ms": lat[len(lat) // 2] if lat else None,
            "model": config.DREX_MODEL,
            "market_context": bool(market), "market_created_at": market.created_at if market else None,
            "buy_threshold": config.BUY_THRESHOLD, "consider_threshold": config.CONSIDER_THRESHOLD,
        },
    }
