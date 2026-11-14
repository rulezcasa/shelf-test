"""Transparent baseline heuristic (experiment_config.json -> baseline_model).

Affordability vs budget + feature fit vs stated preferences -> value -> logistic.
Not trained or validated; used to compare against Drex and as the MOCK_DREX backend.
"""
import math

from .models import Customer, Product

# How much each use case leans on each feature (added to the customer's own importance).
USE_CASE_BOOST = {
    "travel": {"battery": 0.3, "anc": 0.3, "portability": 0.2},
    "commuting": {"anc": 0.3, "portability": 0.2, "battery": 0.1},
    "remote_work": {"connectivity": 0.4, "quality": 0.1},
    "study": {"anc": 0.2, "battery": 0.1},
    "casual": {"design": 0.2},
}


def _clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def component_scores(c: Customer, p: Product) -> dict[str, float]:
    """0..1 score per dimension: how well the product satisfies it."""
    f = p.features
    price = p.price or 0.0
    budget = c.headphone_budget_usd
    over = max(0.0, price - budget) / budget
    under = max(0.0, budget - price) / budget
    affordability = _clip(1.0 - over * (1.5 + 2.5 * c.price_sensitivity) + 0.3 * under * c.price_sensitivity)

    premium = 1.0 if (p.positioning or "").lower() == "premium" else 0.5
    quality = _clip(0.5 * premium + 0.5 * (f.warranty_months or 0) / 24)
    return {
        "price": affordability,
        "battery": _clip((f.battery_life_hours or 0) / 30),
        "portability": _clip(1.0 - ((f.weight_grams or 300) - 180) / 150),
        "connectivity": 1.0 if f.multipoint_bluetooth else 0.2,
        "anc": 1.0 if f.active_noise_cancellation else 0.0,
        "quality": quality,
        "design": 0.7,  # no design signal in the docs; neutral
    }


def feature_weights(c: Customer) -> dict[str, float]:
    w = {
        "battery": c.battery_importance,
        "portability": c.portability_preference,
        "connectivity": c.connectivity_importance,
        "quality": c.quality_preference,
        "design": c.design_preference,
        "anc": 0.3,
    }
    for k, v in USE_CASE_BOOST.get(c.primary_use_case, {}).items():
        w[k] += v
    return w


# Map scoring dimensions to the skip-reason labels Drex also uses.
DIM_TO_REASON = {
    "price": "price",
    "battery": "battery_life",
    "portability": "portability_comfort",
    "connectivity": "connectivity",
    "anc": "missing_feature",
    "quality": "quality_trust",
    "design": "not_a_fit",
}


def score(c: Customer, p: Product) -> dict:
    s = component_scores(c, p)
    w = feature_weights(c)
    fit = sum(w[k] * s[k] for k in w) / sum(w.values())
    price_weight = 0.35 + 0.4 * c.price_sensitivity
    value = price_weight * s["price"] + (1 - price_weight) * fit
    p_buy = 1 / (1 + math.exp(-8 * (value - 0.62)))

    # Skip reason = dimension with the biggest weighted shortfall.
    gaps = {k: w[k] * (1 - s[k]) for k in w}
    gaps["price"] = price_weight * 2.5 * (1 - s["price"])
    raw = {DIM_TO_REASON[k]: g for k, g in gaps.items()}
    raw["would_buy"] = max(0.0, p_buy - 0.4) * 2
    total = sum(raw.values()) or 1.0
    probs = {k: round(v / total, 4) for k, v in raw.items()}
    return {"p_buy": p_buy, "skip_reason_probs": probs, "components": s}
