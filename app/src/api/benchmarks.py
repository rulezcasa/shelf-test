"""Drex vs LLM benchmarks: run both decision models on the same persona x variant panel, compute
metrics, save to data/benchmarks/<timestamp>/, load for the webapp. Used by the API and scripts/benchmark.py.
"""
import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path

import pandas as pd

from .. import config
from ..model import drex_client, llm_client
from ..model.analysis import decision_frame, lift, product_summary
from ..model.panel import load_personas
from ..models import Decision, Persona, Variant

OUT_DIR = config.DATA_DIR / "benchmarks"
MODELS = ("drex", "llm")


# ---- running -----------------------------------------------------------------

async def run_model(name: str, personas: list[Persona], variants: list[Variant], repeat: int,
                    on_progress=None) -> tuple[list[dict], dict]:
    """All pairs once, plus `repeat` extra passes on the first 10 pairs for consistency.

    on_progress(done, total, failed) is called after every call.
    """
    pairs = [(p, v) for p in personas for v in variants]
    jobs = [(p, v, 0) for p, v in pairs] + [(p, v, r) for r in range(1, repeat + 1) for p, v in pairs[:10]]
    sem = asyncio.Semaphore(config.DREX_CONCURRENCY if name == "drex" else config.LLM_CONCURRENCY)
    out, errors, usage = [], [], {"prompt_tokens": 0, "completion_tokens": 0}
    mod = drex_client if name == "drex" else llm_client
    t0 = time.perf_counter()
    async with mod.client() as http:
        async def one(p, v, r):
            async with sem:
                try:
                    if name == "drex":
                        d = await drex_client.evaluate(http, p, v)
                    else:
                        d, u = await llm_client.evaluate(http, p, v)
                        for k in usage:
                            usage[k] += u.get(k, 0)
                    out.append({"model": name, "repeat": r, **d.model_dump()})
                except Exception as e:
                    errors.append(str(e)[:300])
            if on_progress:
                on_progress(len(out) + len(errors), len(jobs), len(errors))
        await asyncio.gather(*(one(*j) for j in jobs))
    wall = time.perf_counter() - t0
    first = [d for d in out if d["repeat"] == 0]
    return out, {"wall_s": wall, "calls": len(jobs), "failed": len(errors), "errors": errors[:5],
                 "throughput_per_s": len(first) / wall if wall else None, **usage}


# ---- metrics -----------------------------------------------------------------

def metrics(df: pd.DataFrame, run_stats: dict, personas: list[Persona]) -> dict:
    res = {}
    main = df[df["repeat"] == 0]
    for m, g in main.groupby("model"):
        dec = [Decision(**{k: (None if pd.isna(r[k]) else r[k]) if not isinstance(r[k], (dict, list)) else r[k] for k in Decision.model_fields}) for r in g.to_dict("records")]
        frame = decision_frame(dec, personas)
        lat = g.latency_ms.dropna()
        st = run_stats[m]
        cost = None
        if m == "llm":
            cost = (st["prompt_tokens"] * config.LLM_PRICE_IN + st["completion_tokens"] * config.LLM_PRICE_OUT) / 1e6
        rep = df[(df.model == m)]
        cons = None
        if rep["repeat"].max() > 0:
            piv = rep.groupby(["persona_id", "variant_id"]).p_buy.agg(["std", "count"])
            cons = float(piv[piv["count"] > 1]["std"].mean())
        res[m] = {
            "summary": product_summary(frame).to_dict("records"),
            "lift": lift(frame).to_dict("records"),
            "latency_median_ms": float(lat.median()), "latency_p95_ms": float(lat.quantile(0.95)),
            "wall_s": st["wall_s"], "throughput_per_s": st["throughput_per_s"],
            "calls": st["calls"], "failed": st["failed"],
            "tokens_in": st.get("prompt_tokens"), "tokens_out": st.get("completion_tokens"),
            "cost_usd": cost, "repeat_std": cons,
            "skip_reasons": g[g.outcome != "buy"].skip_reason.value_counts(normalize=True).to_dict(),
        }
    if {"drex", "llm"} <= set(main.model):
        w = main.pivot_table(index=["persona_id", "variant_id"], columns="model", values="p_buy").dropna()
        o = main.pivot_table(index=["persona_id", "variant_id"], columns="model", values="outcome", aggfunc="first").dropna()
        pref = {m: main[main.model == m].pivot(index="persona_id", columns="variant_id", values="p_buy").idxmax(axis=1)
                for m in ("drex", "llm")}
        common = pref["drex"].index.intersection(pref["llm"].index)
        res["agreement"] = {
            "p_buy_pearson": float(w.drex.corr(w.llm)),
            "p_buy_spearman": float(w.drex.rank().corr(w.llm.rank())),
            "mean_abs_diff": float((w.drex - w.llm).abs().mean()),
            "outcome_agreement": float((o.drex == o.llm).mean()),
            "preferred_variant_agreement": float((pref["drex"][common] == pref["llm"][common]).mean()),
        }
    return res


# ---- saving / loading --------------------------------------------------------

def save(title: str, rows: list[dict], run_stats: dict, personas: list[Persona], product_id: str | None = None) -> Path:
    out = OUT_DIR / datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    (out / "decisions.json").write_text(json.dumps(
        {"title": title, "product_id": product_id, "llm_model": config.LLM_MODEL, "drex_model": config.DREX_MODEL,
         "run_stats": run_stats, "decisions": rows}, indent=1))
    met = metrics(pd.DataFrame(rows), run_stats, personas)
    (out / "summary.json").write_text(json.dumps(met, indent=1, default=float))
    return out


def _dirs() -> list[Path]:
    if not OUT_DIR.exists():
        return []
    return sorted((d for d in OUT_DIR.glob("*") if (d / "summary.json").exists()), reverse=True)


def list_all() -> list[dict]:
    out = []
    for d in _dirs():
        meta = json.loads((d / "decisions.json").read_text())
        out.append({"id": d.name, "title": meta["title"], "llm_model": meta.get("llm_model"),
                    "drex_model": meta.get("drex_model"),
                    "personas": len({r["persona_id"] for r in meta["decisions"]})})
    return out


def get(bid: str) -> dict:
    """Raises KeyError if there is no such benchmark ('latest' = newest)."""
    dirs = _dirs()
    d = dirs[0] if bid == "latest" and dirs else OUT_DIR / bid
    if d.parent != OUT_DIR or not (d / "summary.json").exists():
        raise KeyError(bid)
    meta = json.loads((d / "decisions.json").read_text())
    sens = {p.id: p.price_sensitivity for p in load_personas()}
    pts: dict[tuple, dict] = {}
    for r in meta["decisions"]:
        if r["repeat"] == 0:
            k = (r["persona_id"], r["variant_id"])
            pts.setdefault(k, {"persona_id": k[0], "variant_id": k[1], "price_sensitivity": sens.get(k[0])})
            pts[k][r["model"]] = r["p_buy"]
            pts[k][f"{r['model']}_outcome"] = r["outcome"]
            pts[k][f"{r['model']}_latency_ms"] = r["latency_ms"]
    return {"id": d.name, "title": meta["title"], "llm_model": meta.get("llm_model"),
            "drex_model": meta.get("drex_model"), "metrics": json.loads((d / "summary.json").read_text()),
            "points": list(pts.values())}


# ---- streamed run for the webapp ---------------------------------------------

async def stream(title: str, variants: list[Variant], n: int | None = None, repeat: int = 2,
                 product_id: str | None = None) -> AsyncIterator[str]:
    """Runs Drex, then the LLM (one after the other so their latency/throughput don't interfere),
    yielding NDJSON events:
    {"type":"start","personas":N,"variants":[ids],"calls":C}
    {"type":"progress","model":"drex"|"llm","done":i,"total":C,"failed":f}
    {"type":"model_done","model":...,"wall_s":...,"failed":f}
    {"type":"done","id":<benchmark id>}  /  {"type":"error","message":...}
    """
    personas = load_personas(n)
    queue: asyncio.Queue = asyncio.Queue()

    async def work():
        try:
            if not config.DEEPINFRA_API_KEY:
                raise llm_client.LLMError("DEEPINFRA_API_KEY is not set in shelf-test/.env")
            rows, run_stats = [], {}
            for m in MODELS:
                r, st = await run_model(m, personas, variants, repeat, on_progress=lambda d, t, f, m=m: queue.put_nowait(
                    {"type": "progress", "model": m, "done": d, "total": t, "failed": f}))
                if not any(x["repeat"] == 0 for x in r):
                    raise RuntimeError(f"every {m} call failed: {st['errors'][0] if st['errors'] else 'unknown error'}")
                rows += r
                run_stats[m] = st
                queue.put_nowait({"type": "model_done", "model": m, "wall_s": st["wall_s"], "failed": st["failed"]})
            out = save(title, rows, run_stats, personas, product_id)
            queue.put_nowait({"type": "done", "id": out.name})
        except Exception as e:  # config errors (missing keys) and API failures surface to the UI
            queue.put_nowait({"type": "error", "message": str(e)})

    calls = len(personas) * len(variants) + repeat * min(10, len(personas) * len(variants))
    yield json.dumps({"type": "start", "personas": len(personas), "variants": [v.variant_id for v in variants],
                      "calls": calls}) + "\n"
    task = asyncio.create_task(work())
    while True:
        ev = await queue.get()
        yield json.dumps(ev) + "\n"
        if ev["type"] in ("done", "error"):
            break
    await task
