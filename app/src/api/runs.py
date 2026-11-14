"""Panel runs for a product: run Drex over personas x variants, save, load, analyze."""
import json

from ..models import Decision, Persona, Product
from ..model.analysis import analyze
from ..model.panel import load_personas, run_panel
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
    result = await run_panel(personas, product.variants, market=market)
    path = store.save_run(product.id, result, personas, product.variants)
    return _view(path.stem, json.loads(path.read_text()), personas)


def get(pid: str, run_id: str) -> dict:
    raw = store.load_run(pid, run_id)
    by_id = {p.id: p for p in load_personas()}
    personas = [by_id[i] for i in raw["persona_ids"] if i in by_id]
    return _view(run_id, raw, personas)
