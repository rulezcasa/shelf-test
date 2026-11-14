"""Panel runs for a product: run Drex over personas x variants, save, load, analyze."""
import asyncio
import json
from collections.abc import AsyncIterator

from ..models import Decision, Persona, Product
from ..model.analysis import analyze
from ..model.panel import load_personas, run_panel
from ..market import jobs as market_jobs
from . import store


def _records(df) -> list[dict]:
    """DataFrame -> JSON-safe records (NaN -> None)."""
    return json.loads(df.to_json(orient="records"))


def _view(run_id: str, raw: dict, personas: list[Persona]) -> dict:
    decisions = [Decision(**d) for d in raw["decisions"]]
    out = {
        "id": run_id,
        "created_at": raw.get("created_at"),
        "stats": raw["stats"],
        "variants": raw.get("variants", []),
        "personas": [p.model_dump() for p in personas],
        "decisions": [d.model_dump() for d in decisions],
        "analysis": None,
    }
    if decisions:
        a = analyze({"decisions": decisions, "stats": raw["stats"]}, personas)
        out["analysis"] = {k: _records(v) for k, v in a.items() if k != "stats"}
    return out


async def create(product: Product, n: int | None = None, use_market: bool = True) -> dict:
    """use_market: give Drex the product's saved Keenable market context, if there is one."""
    personas = load_personas(n)
    market = store.load_market(product.id) if use_market else None
    market_jobs.start(product)
    result = await run_panel(personas, product.variants, market=market)
    path = store.save_run(product.id, result, personas, product.variants)
    return _view(path.stem, json.loads(path.read_text()), personas)


async def stream(product: Product, n: int | None = None, use_market: bool = True) -> AsyncIterator[str]:
    """Same as create(), but yields NDJSON events as decisions arrive (for the live run animation):
    {"type":"start","total":N,"personas":[ids],"variants":[ids]}
    {"type":"decision","done":i,"total":N,"persona_id","variant_id","p_buy","outcome","skip_reason"}  (or "failed")
    {"type":"done","run_id":...,"stats":{...}}  /  {"type":"error","message":...}
    """
    personas = load_personas(n)
    market = store.load_market(product.id) if use_market else None  # last saved research
    market_jobs.start(product)  # fresh competitor research runs alongside the panel
    queue: asyncio.Queue = asyncio.Queue()

    def progress(done: int, total: int, d) -> None:
        ev = {"type": "decision" if d else "failed", "done": done, "total": total}
        if d:
            ev |= {"persona_id": d.persona_id, "variant_id": d.variant_id, "p_buy": d.p_buy,
                   "outcome": d.outcome, "skip_reason": d.skip_reason}
        queue.put_nowait(ev)

    async def work():
        try:
            result = await run_panel(personas, product.variants, on_progress=progress, market=market)
            if not result["decisions"]:
                err = result["stats"]["failures"][0]["error"] if result["stats"]["failures"] else "no decisions"
                queue.put_nowait({"type": "error", "message": f"every Drex call failed: {err}"})
            else:
                path = store.save_run(product.id, result, personas, product.variants)
                queue.put_nowait({"type": "done", "run_id": path.stem, "stats": result["stats"]})
        except Exception as e:  # config errors (e.g. missing key) surface to the UI
            queue.put_nowait({"type": "error", "message": str(e)})

    yield json.dumps({"type": "start", "total": len(personas) * len(product.variants),
                      "personas": [p.id for p in personas],
                      "variants": [v.variant_id for v in product.variants]}) + "\n"
    task = asyncio.create_task(work())
    while True:
        ev = await queue.get()
        yield json.dumps(ev) + "\n"
        if ev["type"] in ("done", "error"):
            break
    await task


def get(pid: str, run_id: str) -> dict:
    raw = store.load_run(pid, run_id)
    if not raw.get("variants"):  # runs saved before variant snapshots: use the product's current variants
        used = {d["variant_id"] for d in raw["decisions"]}
        raw["variants"] = [v.model_dump() for v in store.get(pid).variants if v.variant_id in used]
    by_id = {p.id: p for p in load_personas()}
    personas = [by_id[i] for i in raw["persona_ids"] if i in by_id]
    return _view(run_id, raw, personas)
