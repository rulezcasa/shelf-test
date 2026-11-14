"""What-if scenarios on top of Keenable market research.

A Scenario changes the market (competitor prices, free shipping, a competitor's reviews, an
emerging pain point) and/or one of our variants (price, a new feature). We apply it to the
variants + per-variant market context, run every persona x variant through Drex, and return
what the dashboard animates: conversion per variant, which variant each persona picks, the
recommendation, and an explanation of what moved vs the baseline (no changes).

Drex answers are cached on disk by request hash, so moving a slider back replays instantly.
"""
import asyncio
import copy
import hashlib
import json
import re
from collections import Counter, defaultdict

from pydantic import BaseModel

from .. import config
from ..model import drex_client
from ..models import Attribute, Decision, Persona, Variant
from .intel import MarketIntel

CACHE = config.CACHE_DIR / "drex_scenarios"
WALK_AWAY = "none"  # persona rejects every variant


class Scenario(BaseModel):
    competitor_price_pct: float = 0          # -50..+50, e.g. -10 = competitors 10% cheaper
    competitor_free_shipping: bool = False
    own_price_pct: float = 0                 # -50..+100 on target_variant
    target_variant: str | None = None        # default: last variant (the challenger)
    new_feature: str | None = None           # added to target_variant
    poor_reviews_competitor: str | None = None
    pain_point: str | None = None            # a concern that just became important to shoppers

    def is_baseline(self) -> bool:
        return self == Scenario(target_variant=self.target_variant)


# ---- applying a scenario ------------------------------------------------------

def _num(s: str) -> float | None:
    m = re.search(r"\d[\d,]*\.?\d*", s or "")
    return float(m.group().replace(",", "")) if m else None


def _price_attr(v: Variant) -> Attribute | None:
    return next((a for a in v.attributes if "price" in a.name.lower() and _num(a.value) is not None), None)


def variant_price(v: Variant) -> float | None:
    a = _price_attr(v)
    return _num(a.value) if a else None


def apply_variants(variants: list[Variant], sc: Scenario) -> list[Variant]:
    target = sc.target_variant or variants[-1].variant_id
    out = []
    for v in variants:
        v = v.model_copy(deep=True)
        if v.variant_id == target:
            a = _price_attr(v)
            if a and sc.own_price_pct:
                new = _num(a.value) * (1 + sc.own_price_pct / 100)
                a.value = re.sub(r"\d[\d,]*\.?\d*", f"{new:.2f}".rstrip("0").rstrip("."), a.value, count=1)
            if sc.new_feature:
                v.attributes.append(Attribute(name="new_feature", value=sc.new_feature))
        out.append(v)
    return out


def apply_market(intel: MarketIntel, variants: list[Variant], sc: Scenario) -> dict[str, dict]:
    """Per-variant market context with the scenario's market changes applied."""
    f = 1 + sc.competitor_price_pct / 100
    changes = []
    if sc.competitor_price_pct:
        changes.append(f"Competitors have {'cut' if f < 1 else 'raised'} prices by {abs(sc.competitor_price_pct):.0f}%")
    if sc.competitor_free_shipping:
        changes.append("Major competitors now offer free shipping and free returns")
    if sc.poor_reviews_competitor:
        changes.append(f"{sc.poor_reviews_competitor} has recently received many poor customer reviews")
    if sc.pain_point:
        changes.append(f"Shoppers have recently started to care a lot about: {sc.pain_point}")

    comp_prices = [c.price * f for c in intel.competitors if c.price is not None]
    out = {}
    for v in variants:
        ctx = copy.deepcopy(intel.decision_context(v.variant_id))
        ctx["competitor_prices"] = [
            {**c, "price": round(c["price"] * f, 2),
             **({"recent_reviews": "many poor reviews"} if c["name"] == sc.poor_reviews_competitor else {}),
             **({"shipping": "free shipping"} if sc.competitor_free_shipping else {})}
            for c in ctx["competitor_prices"]]
        pr = dict(ctx.get("market_price_range") or {})
        for k in ("low", "median", "high"):
            if isinstance(pr.get(k), (int, float)):
                pr[k] = round(pr[k] * f, 2)
        ctx["market_price_range"] = pr
        # Price position recomputed from (scenario) prices instead of the LLM's snapshot.
        pos = ctx.get("this_product_vs_market") or {}
        price = variant_price(v)
        if price is not None and comp_prices:
            pct = sum(p < price for p in comp_prices) / len(comp_prices)
            pos["price_percentile"] = round(pct, 2)
            pos["price_position"] = "below market" if pct < 0.34 else "above market" if pct > 0.66 else "in line"
        if sc.new_feature and any(a.name == "new_feature" for a in v.attributes):
            pos["advantages"] = list(pos.get("advantages", [])) + [sc.new_feature]
        ctx["this_product_vs_market"] = pos
        if changes:
            ctx["recent_market_changes"] = changes
        if sc.pain_point:
            ctx["common_customer_complaints_in_category"] = [sc.pain_point] + ctx["common_customer_complaints_in_category"]
        out[v.variant_id] = ctx
    return out


# ---- running ------------------------------------------------------------------

async def _evaluate_cached(http, persona: Persona, variant: Variant, market: dict) -> Decision:
    state = drex_client.build_state(persona, variant, market)
    key = hashlib.sha256(json.dumps([config.DREX_MODEL, state, drex_client.QUESTIONS], sort_keys=True)
                         .encode()).hexdigest()[:32]
    path = CACHE / f"{key}.json"
    if path.exists():
        return Decision.model_validate_json(path.read_text())
    d = await drex_client.evaluate(http, persona, variant, market)
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(d.model_dump_json())
    return d


async def run(personas: list[Persona], variants: list[Variant], intel: MarketIntel, sc: Scenario) -> list[Decision]:
    vs = apply_variants(variants, sc)
    ctx = apply_market(intel, vs, sc)
    sem = asyncio.Semaphore(config.DREX_CONCURRENCY)
    async with drex_client.client() as http:
        async def one(p, v):
            async with sem:
                try:
                    return await _evaluate_cached(http, p, v, ctx[v.variant_id])
                except Exception:
                    return None
        res = await asyncio.gather(*(one(p, v) for p in personas for v in vs))
    return [d for d in res if d]


# ---- summarizing ----------------------------------------------------------------

def choice(ds: list[Decision]) -> str:
    """Variant a persona would pick: highest p_buy among non-rejected variants."""
    ok = [d for d in ds if d.outcome != "reject"]
    return max(ok, key=lambda d: d.p_buy).variant_id if ok else WALK_AWAY


def summarize(decisions: list[Decision], personas: list[Persona], variant_ids: list[str]) -> dict:
    by_p = defaultdict(list)
    for d in decisions:
        by_p[d.persona_id].append(d)
    conv = {v: [d.p_buy for d in decisions if d.variant_id == v] for v in variant_ids}
    reasons = {v: Counter(d.skip_reason for d in decisions if d.variant_id == v and d.outcome != "buy")
               for v in variant_ids}
    picks = {p.id: choice(by_p[p.id]) for p in personas if p.id in by_p}
    share = Counter(picks.values())
    conversion = {v: (sum(x) / len(x) if x else 0) for v, x in conv.items()}
    return {
        "conversion": conversion,
        "buy_share": {v: sum(d.outcome == "buy" for d in decisions if d.variant_id == v) / max(1, len(conv[v]))
                      for v in variant_ids},
        "pick_share": {k: share.get(k, 0) / max(1, len(picks)) for k in [*variant_ids, WALK_AWAY]},
        "recommended": max(conversion, key=conversion.get) if conversion else None,
        "picks": picks,
        "p_buy": {f"{d.persona_id}:{d.variant_id}": round(d.p_buy, 3) for d in decisions},
        "skip_reasons": {v: {k: n / max(1, sum(c.values())) for k, n in c.most_common()} for v, c in reasons.items()},
    }


def explain(sc: Scenario, cur: dict, base: dict, personas: list[Persona], group_by: str = "shopping_style") -> list[str]:
    """Plain-language bullets on what changed vs the baseline (template-based, deterministic)."""
    out = []
    rec, brec = cur["recommended"], base["recommended"]
    c, b = cur["conversion"], base["conversion"]
    if sc.is_baseline():
        lead = sorted(c, key=c.get, reverse=True)
        gap = (c[lead[0]] - c[lead[1]]) * 100 if len(lead) > 1 else 0
        out.append(f"With today's market as Keenable found it, {rec} is recommended "
                   f"({c[rec]:.0%} mean purchase propensity, {gap:.1f} pts ahead).")
    elif rec != brec:
        out.append(f"The recommendation flips from {brec} to {rec} under this scenario.")
    else:
        out.append(f"{rec} stays the recommended variant.")
    if not sc.is_baseline():
        moves = ", ".join(f"{v} {(c[v] - b[v]) * 100:+.1f} pts" for v in c)
        out.append(f"Conversion vs today's market: {moves}.")
        # Who switched
        groups = {p.id: getattr(p, group_by) for p in personas}
        flows = Counter((base["picks"].get(pid), to) for pid, to in cur["picks"].items()
                        if base["picks"].get(pid) != to)
        if flows:
            (frm, to), n = flows.most_common(1)[0]
            movers = Counter(groups[pid] for pid, t in cur["picks"].items()
                             if base["picks"].get(pid) == frm and t == to)
            who = ", ".join(f"{g.replace('_', ' ')} ({k})" for g, k in movers.most_common(2))
            label = lambda x: "walking away" if x == WALK_AWAY else x  # noqa: E731
            out.append(f"{n} persona{'s' if n > 1 else ''} moved from {label(frm)} to {label(to)}, mostly {who}.")
        else:
            out.append("No persona changed which variant they would pick.")
        # Skip reason shift on the variant that lost the most
        loser = min(c, key=lambda v: c[v] - b[v])
        cr, br = cur["skip_reasons"].get(loser, {}), base["skip_reasons"].get(loser, {})
        if cr:
            top = max(cr, key=lambda k: cr[k] - br.get(k, 0))
            if cr[top] - br.get(top, 0) > 0.05:
                out.append(f"For {loser}, '{top.replace('_', ' ')}' is now {cr[top]:.0%} of skip reasons "
                           f"(was {br.get(top, 0):.0%}).")
    return out
