"""Product document -> Variant, via NDI.

No fixed product fields: NDI pulls out every purchase-relevant attribute it finds as a
name/value list, so a blender, a SaaS plan and a mattress all work with the same code.
"""
import re
import string
from pathlib import Path

from .. import config
from . import ndi_client
from ..models import Attribute, Variant

SCHEMA = {
    "type": "object",
    "properties": {
        "product_name": {"type": ["string", "null"]},
        "attributes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "value": {"type": "string"},
                },
                "required": ["name", "value"],
            },
        },
    },
}

INSTRUCTIONS = (
    "This document describes one product variant (spec sheet, landing page or pricing sheet). "
    "List every attribute a shopper would weigh when deciding to buy: price and pricing model, "
    "features and specs, marketing claims, warranty, returns, shipping, reviews/ratings, promotions, "
    "target audience, and anything else relevant to this product. "
    "Use short lowercase snake_case names (e.g. price, return_policy, battery_life) and keep each value "
    "concise but complete, including units and currency. Each name appears once; for lists "
    "(e.g. several features) join the items into one value separated by '; '."
)


def _citations_by_index(result: dict) -> dict[int, tuple]:
    """fields[].path '/attributes/3' -> (page, source_text) of its first citation.
    NDI often returns no citation for list items (enrichment 'degraded'), so this is best-effort."""
    out: dict[int, tuple] = {}
    for f in result.get("fields") or []:
        m = re.fullmatch(r"/attributes/(\d+)", f.get("path", ""))
        if m and f.get("citations"):
            c = f["citations"][0]
            out[int(m.group(1))] = ((c.get("location") or {}).get("page"), c.get("source_text"))
    return out


def extract_variant(source: dict | str | Path, variant_id: str, known_names: list[str] = ()) -> Variant:
    """`source` is a local file path or an NDI source object (e.g. {"type": "url", ...})."""
    if isinstance(source, (str, Path)):
        name = Path(source).name
        source = ndi_client.upload(Path(source))
    else:
        name = source.get("file_name") or source.get("url", "")
    instructions = INSTRUCTIONS
    if known_names:  # keep names consistent across variants so the comparison table lines up
        instructions += (" Naming: other variants of this product already use these attribute names: "
                         + ", ".join(known_names) + ". If a fact is the same kind as one of these, use that exact "
                         "name. If it is a different kind of fact (e.g. a promotion or discount when no promotion "
                         "name exists), give it its own new name; never merge it into an unrelated attribute.")
    result = ndi_client.extract(source, SCHEMA, instructions)
    data = result.get("data") or {}
    cites = _citations_by_index(result)
    attrs = []
    for i, a in enumerate(data.get("attributes") or []):
        if not a.get("name") or a.get("value") in (None, ""):
            continue
        page, quote = cites.get(i, (None, None))
        attrs.append(Attribute(name=a["name"], value=str(a["value"]), page=page, quote=quote))
    return Variant(
        variant_id=variant_id,
        source_file=name,
        product_name=data.get("product_name"),
        attributes=attrs,
    )


def extract_all(sources: list) -> list[Variant]:
    """First source is A (control), then B, C, ... Runs in order so later variants reuse earlier names."""
    variants: list[Variant] = []
    for i, s in enumerate(sources):
        known = list(dict.fromkeys(a.name for v in variants for a in v.attributes))
        variants.append(extract_variant(s, string.ascii_uppercase[i], known))
    return variants


if __name__ == "__main__":
    # python -m src.ndi.extract_variants data/variants/sample_A.pdf https://.../b.pdf
    import sys

    srcs = [
        {"type": "url", "url": a, "file_name": a.rsplit("/", 1)[-1]} if a.startswith("https://") else a
        for a in sys.argv[1:]
    ]
    for v in extract_all(srcs):
        print(v.model_dump_json(indent=2))
