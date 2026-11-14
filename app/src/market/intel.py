"""Market intelligence for a product: live web research with Keenable, synthesized by an LLM.

1. plan    - LLM turns the variants into a category + one search query per research topic
2. search  - Keenable search per topic (recent pages first), dedupe
3. read    - Keenable fetch of the top review/complaint pages for real customer language
4. analyze - LLM writes a structured MarketIntel grounded in those sources, incl. how each
             variant's price and features compare to the market

The compact `decision_context()` view is what Drex (and the LLM panel) see at decision time.
"""
import asyncio
import json
from datetime import datetime, timezone

from pydantic import BaseModel

from ..model import llm_client
from ..models import Product, Variant
from . import keenable_client as kc

TOPICS = {
    "competitors": "similar competing products in the same category",
    "prices": "current prices of competing products",
    "complaints": "customer complaints, negative reviews and common problems",
    "features": "features that are standard across the category",
    "claims": "marketing claims competitors frequently advertise",
    "gaps": "unmet needs, underserved customers, things buyers wish existed",
}


class Competitor(BaseModel):
    name: str
    price: float | None = None
    currency: str | None = "USD"
    key_points: list[str] = []
    source_url: str | None = None


class VariantPosition(BaseModel):
    variant_id: str
    price_position: str            # "below market" | "in line" | "above market" | "unknown"
    price_percentile: float | None = None  # 0 = cheapest competitor, 1 = most expensive
    missing_common_features: list[str] = []
    advantages: list[str] = []
    exposed_to_complaints: list[str] = []
    verdict: str = ""


class MarketIntel(BaseModel):
    product_id: str
    created_at: str
    category: str
    summary: str
    competitors: list[Competitor] = []
    price_range: dict = {}         # {low, median, high, currency}
    complaints: list[str] = []
    common_features: list[str] = []
    common_claims: list[str] = []
    gaps: list[str] = []
    positions: list[VariantPosition] = []
    queries: dict[str, str] = {}
    sources: list[dict] = []       # [{id, title, url, topic, published_at}]
    requests_used: int = 0

    def decision_context(self, variant_id: str) -> dict:
        """Compact market view a shopper would plausibly know when looking at this variant."""
        pos = next((p for p in self.positions if p.variant_id == variant_id), None)
        return {
            "category": self.category,
            "competitor_prices": [
                {"name": c.name, "price": c.price} for c in self.competitors if c.price is not None][:6],
            "market_price_range": self.price_range,
            "features_most_competitors_have": self.common_features[:8],
            "common_customer_complaints_in_category": self.complaints[:6],
            "this_product_vs_market": pos.model_dump(exclude={"variant_id"}) if pos else None,
        }


def _variant_brief(v: Variant) -> dict:
    return {"variant_id": v.variant_id, **v.as_product()}


async def _plan(product: Product) -> dict:
    briefs = [_variant_brief(v) for v in product.variants]
    msg = (
        "These are variants of one product being A/B tested:\n" + json.dumps(briefs, indent=1) +
        "\n\nName the product category in a few words (e.g. 'wireless over-ear headphones'), and write one "
        "concise web search query per topic below to research the CURRENT market for this category. Do not "
        "use the product's own (possibly fictional) brand name; search for the category and real competitors.\n"
        + "\n".join(f"- {k}: {v}" for k, v in TOPICS.items()) +
        '\n\nRespond as JSON: {"category": "...", "queries": {"competitors": "...", ...}}'
    )
    out = await llm_client.chat_json([{"role": "user", "content": msg}], max_tokens=500)
    queries = {k: out.get("queries", {}).get(k) or f"{out.get('category', product.name)} {v}" for k, v in TOPICS.items()}
    return {"category": out.get("category") or product.name, "queries": queries}


async def _research(queries: dict[str, str], step=lambda _: None) -> tuple[list[dict], list[dict], int]:
    year_ago = f"{datetime.now().year - 1}-01-01"
    async with kc.client() as http:
        results = await asyncio.gather(*(kc.search(http, q, max_results=8, published_after=year_ago)
                                         for q in queries.values()))
        sources, seen = [], set()
        for topic, rs in zip(queries, results):
            for r in rs:
                if r["url"] in seen:
                    continue
                seen.add(r["url"])
                sources.append({"id": len(sources) + 1, "topic": topic, **r})
        # Read the top review/complaint pages in full for real customer language.
        to_read = [s for s in sources if s["topic"] == "complaints"][:3]
        step("read")
        pages = await asyncio.gather(*(kc.fetch(http, s["url"], max_chars=5000) for s in to_read),
                                     return_exceptions=True)
    read = [{"source_id": s["id"], "content": p["content"]} for s, p in zip(to_read, pages)
            if isinstance(p, dict) and p.get("content")]
    return sources, read, len(queries) + len(to_read)


async def _analyze(product: Product, category: str, sources: list[dict], pages: list[dict]) -> dict:
    snippets = "\n\n".join(
        f"[{s['id']}] ({s['topic']}) {s['title']} — {s['url']}\n{(s.get('snippet') or '')[:600]}" for s in sources)
    full = "\n\n".join(f"[{p['source_id']}] FULL PAGE EXCERPT:\n{p['content'][:4000]}" for p in pages)
    variants = json.dumps([_variant_brief(v) for v in product.variants], indent=1)
    msg = f"""You are a market analyst. Using ONLY the web sources below, describe the current market for: {category}.
Then compare each product variant under test against that market.

Variants under test (A = control):
{variants}

Web sources (search snippets):
{snippets}

{full}

Rules: list 6-10 real named competitors mentioned in the sources, each with its price if any source states one
(null otherwise, never guess); prefer real named products; keep each list item
short (under 15 words); do not invent facts. price_position is "below market", "in line", "above market" or
"unknown"; price_percentile is 0..1 against competitor prices (null if unknown).

Respond as JSON:
{{"summary": "2-3 sentences on the current market",
  "competitors": [{{"name": "...", "price": 199.0, "currency": "USD", "key_points": ["..."], "source_id": 3}}],
  "price_range": {{"low": 0, "median": 0, "high": 0, "currency": "USD"}},
  "complaints": ["3-6 items"], "common_features": ["4-8 items"], "common_claims": ["3-6 items"], "gaps": ["2-5 items"],
  "positions": [{{"variant_id": "A", "price_position": "...", "price_percentile": 0.5,
                 "missing_common_features": ["..."], "advantages": ["..."],
                 "exposed_to_complaints": ["..."], "verdict": "one sentence"}}]}}"""
    return await llm_client.chat_json([{"role": "user", "content": msg}], max_tokens=2500)


async def build(product: Product, on_step=None) -> MarketIntel:
    """on_step(name) is called as each stage (plan, search, read, analyze) begins."""
    step = on_step or (lambda _: None)
    step("plan")
    plan = await _plan(product)
    step("search")
    sources, pages, used = await _research(plan["queries"], step)
    if not sources:
        raise kc.KeenableError("Keenable returned no results for any query")
    step("analyze")
    a = await _analyze(product, plan["category"], sources, pages)
    by_id = {s["id"]: s["url"] for s in sources}
    competitors = []
    for c in a.get("competitors", [])[:12]:
        try:
            competitors.append(Competitor(**{**c, "source_url": by_id.get(c.get("source_id"))}))
        except Exception:
            continue
    positions = []
    for p in a.get("positions", []):
        try:
            positions.append(VariantPosition(**p))
        except Exception:
            continue
    return MarketIntel(
        product_id=product.id,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        category=plan["category"],
        summary=a.get("summary", ""),
        competitors=competitors,
        price_range=a.get("price_range") or {},
        complaints=a.get("complaints", [])[:10],
        common_features=a.get("common_features", [])[:12],
        common_claims=a.get("common_claims", [])[:10],
        gaps=a.get("gaps", [])[:8],
        positions=positions,
        queries=plan["queries"],
        sources=[{k: s.get(k) for k in ("id", "title", "url", "topic", "published_at")} for s in sources],
        requests_used=used,
    )
