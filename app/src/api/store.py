"""File-backed product store. One folder per product:

    data/products/<product_id>/product.json   Product (incl. variants)
    data/products/<product_id>/files/<V>.pdf  original document per variant
    data/products/<product_id>/runs/<ts>.json Drex panel runs
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..config import DATA_DIR
from ..models import Persona, Product, Variant

PRODUCTS_DIR = DATA_DIR / "products"


def _dir(pid: str) -> Path:
    if not pid.isalnum():  # ids are hex; refuse anything path-like
        raise KeyError(pid)
    return PRODUCTS_DIR / pid


def list_products() -> list[Product]:
    if not PRODUCTS_DIR.exists():
        return []
    out = [Product.model_validate_json(p.read_text()) for p in PRODUCTS_DIR.glob("*/product.json")]
    return sorted(out, key=lambda p: p.created_at, reverse=True)


def get(pid: str) -> Product:
    f = _dir(pid) / "product.json"
    if not f.exists():
        raise KeyError(pid)
    return Product.model_validate_json(f.read_text())


def save(p: Product) -> Product:
    d = _dir(p.id)
    (d / "files").mkdir(parents=True, exist_ok=True)
    (d / "product.json").write_text(p.model_dump_json(indent=2))
    return p


def create(name: str) -> Product:
    return save(Product(id=uuid.uuid4().hex[:12], name=name, created_at=datetime.now(timezone.utc).isoformat()))


def delete(pid: str) -> None:
    d = _dir(pid)
    if not d.exists():
        raise KeyError(pid)
    for f in sorted(d.rglob("*"), reverse=True):
        f.rmdir() if f.is_dir() else f.unlink()
    d.rmdir()


def file_path(pid: str, vid: str) -> Path:
    if not (len(vid) == 1 and vid.isalpha()):
        raise KeyError(vid)
    return _dir(pid) / "files" / f"{vid}.pdf"


def _runs_dir(pid: str) -> Path:
    return _dir(pid) / "runs"


def save_run(pid: str, result: dict, personas: list[Persona], variants: list[Variant]) -> Path:
    """Write one panel run next to its product. Variants are snapshotted (they can be edited later)."""
    d = _runs_dir(pid)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps({
        "created_at": datetime.now(timezone.utc).isoformat(),
        "stats": {k: v for k, v in result["stats"].items()},
        "variants": [v.model_dump() for v in variants],
        "persona_ids": [p.id for p in personas],
        "decisions": [x.model_dump() for x in result["decisions"]],
    }, indent=1))
    return path


def list_runs(pid: str) -> list[dict]:
    """Newest first: id, created_at, stats, persona count, mean P(buy) per variant."""
    d = _runs_dir(pid)
    if not d.exists():
        return []
    out = []
    for f in sorted(d.glob("*.json"), reverse=True):
        raw = json.loads(f.read_text())
        by_variant: dict[str, list[float]] = {}
        for x in raw["decisions"]:
            by_variant.setdefault(x["variant_id"], []).append(x["p_buy"])
        out.append({
            "id": f.stem,
            "created_at": raw.get("created_at"),
            "stats": raw["stats"],
            "personas": len(raw.get("persona_ids", [])),
            # unweighted mean P(buy) per variant, for list views (full analysis via get_run)
            "propensity": {v: sum(xs) / len(xs) for v, xs in sorted(by_variant.items())},
        })
    return out


def load_run(pid: str, run_id: str) -> dict:
    if not run_id.replace("-", "").isdigit():
        raise KeyError(run_id)
    f = _runs_dir(pid) / f"{run_id}.json"
    if not f.exists():
        raise KeyError(run_id)
    return json.loads(f.read_text())


# ---- market intelligence (Keenable research), one current snapshot per product ----

def save_market(pid: str, intel) -> Path:
    path = _dir(pid) / "market.json"
    path.write_text(intel.model_dump_json(indent=1))
    return path


def load_market(pid: str):
    from ..market.intel import MarketIntel
    path = _dir(pid) / "market.json"
    return MarketIntel.model_validate_json(path.read_text()) if path.exists() else None
