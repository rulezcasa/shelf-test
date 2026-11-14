"""One-time pre-build step: generate the synthetic shopper panel -> data/personas.json.

Weighted random draws per field + a few plausibility rules. The core product (src/)
only reads data/personas.json; it never generates personas.

    python scripts/gen_personas.py [-n 60]
"""

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import PERSONAS_PATH  # noqa: E402
from src.models import Persona  # noqa: E402

AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
AGE_RANGE = {"18-24": (18, 24), "25-34": (25, 34), "35-44": (35, 44),
             "45-54": (45, 54), "55-64": (55, 64), "65+": (65, 82)}

INCOMES = ["<35k", "35-75k", "75-150k", "150k+"]
INCOME_WEIGHTS = {  # income given age
    "18-24": [50, 35, 12, 3],
    "65+":   [35, 35, 22, 8],
}
DEFAULT_INCOME_WEIGHTS = [20, 30, 33, 17]
INCOME_TEXT = {"<35k": "under $35k", "35-75k": "$35–75k",
               "75-150k": "$75–150k", "150k+": "over $150k"}

REGIONS = (["US-South", "US-West", "US-Midwest", "US-Northeast"], [38, 24, 21, 17])
LOCATIONS = (["urban", "suburban", "rural"], [30, 52, 18])
GENDERS = (["female", "male", "nonbinary"], [49, 48, 3])

OCCUPATIONS = {
    "<35k": ["retail associate", "barista", "warehouse worker", "home health aide",
             "student", "line cook", "rideshare driver", "cashier"],
    "35-75k": ["teacher", "electrician", "dental hygienist", "office manager",
               "truck driver", "graphic designer", "police officer", "bookkeeper"],
    "75-150k": ["nurse", "software developer", "accountant", "civil engineer",
                "marketing manager", "pharmacist", "sales manager", "physical therapist"],
    "150k+": ["software engineer", "physician", "attorney", "product director",
              "small-business owner", "financial advisor", "dentist", "VP of operations"],
}

STYLES = ["bargain_hunter", "researcher", "brand_loyal", "impulse",
          "eco_conscious", "convenience_first"]
STYLE_TEXT = {
    "bargain_hunter": "Hunts for deals and compares prices before buying anything.",
    "researcher": "Researches purchases carefully, reading specs and reviews.",
    "brand_loyal": "Sticks with brands they trust and pays for reliability.",
    "impulse": "Often buys on impulse when something catches their eye.",
    "eco_conscious": "Prefers sustainable products and avoids wasteful brands.",
    "convenience_first": "Values convenience and will pay to avoid hassle.",
}

PRIORITIES = ["price", "quality", "durability", "convenience", "sustainability",
              "brand", "design", "support", "features"]
STYLE_PRIORITY = {"bargain_hunter": "price", "researcher": "features",
                  "brand_loyal": "brand", "impulse": "design",
                  "eco_conscious": "sustainability", "convenience_first": "convenience"}

# Return/warranty dealbreakers weighted up so the A/B sample variants actually split people.
DEALBREAKERS = (["no free returns", "no warranty", "subscription required",
                 "slow shipping", "poor reviews", "complicated setup"],
                [25, 20, 15, 12, 18, 10])
DEALBREAKER_TEXT = {
    "no free returns": "Won't buy without free returns.",
    "no warranty": "Won't buy anything without a warranty.",
    "subscription required": "Refuses products that require a subscription.",
    "slow shipping": "Won't wait on slow shipping.",
    "poor reviews": "Skips anything with weak reviews.",
    "complicated setup": "Avoids products that are complicated to set up.",
}

HOUSEHOLD_TEXT = {"single": "lives alone", "couple": "lives with a partner",
                  "family_with_kids": "lives with a partner and kids",
                  "retiree": "is retired and lives with a spouse",
                  "roommates": "lives with roommates"}


def _a(word) -> str:
    return ("an " if str(word)[0].lower() in "aeiou8" or str(word).startswith("18") else "a ") + str(word)


def _pick(rng, options_weights):
    options, weights = options_weights
    return rng.choices(options, weights=weights)[0]


def _household(rng, age_band):
    if age_band == "18-24":
        return _pick(rng, (["single", "roommates", "couple"], [40, 45, 15]))
    if age_band == "65+":
        return _pick(rng, (["retiree", "single", "couple"], [60, 25, 15]))
    if age_band == "55-64":
        return _pick(rng, (["couple", "single", "retiree", "family_with_kids"], [45, 25, 20, 10]))
    return _pick(rng, (["family_with_kids", "couple", "single", "roommates"],
                       [45, 25, 20, 10] if age_band != "25-34" else [25, 30, 25, 20]))


def _make_persona(rng, idx, age_band):
    income = rng.choices(INCOMES, weights=INCOME_WEIGHTS.get(age_band, DEFAULT_INCOME_WEIGHTS))[0]
    age = rng.randint(*AGE_RANGE[age_band])
    household = _household(rng, age_band)
    gender = _pick(rng, GENDERS)
    region = _pick(rng, REGIONS)
    location = _pick(rng, LOCATIONS)

    if age_band == "65+" and rng.random() < 0.8:
        occupation = "retired"
    elif age_band == "18-24" and income == "<35k" and rng.random() < 0.4:
        occupation = "college student"
    else:
        occupation = rng.choice(OCCUPATIONS[income])

    tech = rng.choices(["low", "medium", "high"],
                       weights=[1, 3, 6] if age <= 34 else [2, 5, 3] if age <= 54 else [5, 4, 1])[0]

    style_w = [1.0] * len(STYLES)
    if income == "<35k":
        style_w[STYLES.index("bargain_hunter")] = 3
    if income == "150k+":
        style_w[STYLES.index("brand_loyal")] = 2
        style_w[STYLES.index("convenience_first")] = 2
    style = rng.choices(STYLES, weights=style_w)[0]

    if income == "<35k" or style == "bargain_hunter":
        price_sens = "high"
    elif income == "150k+":
        price_sens = "low"
    else:
        price_sens = "medium"

    must = STYLE_PRIORITY[style]
    others = [p for p in PRIORITIES if p != must]
    if price_sens == "high" and must != "price":
        priorities = [must, "price", rng.choice([p for p in others if p != "price"])]
    else:
        priorities = [must] + rng.sample(others, 2)

    n_db = rng.choices([0, 1, 2], weights=[30, 50, 20])[0]
    dealbreakers = []
    while len(dealbreakers) < n_db:
        d = _pick(rng, DEALBREAKERS)
        if d not in dealbreakers:
            dealbreakers.append(d)

    label = f"{age}, {location} {occupation}, {household.replace('_', ' ')}"
    bio = (
        f"{_a(age)[0].upper() + _a(age)[1:]}-year-old {gender} {'retiree' if occupation == 'retired' else occupation} "
        f"in {_a(location)} area of the {region.replace('US-', 'US ')} who {HOUSEHOLD_TEXT[household]}. "
        f"Household income {INCOME_TEXT[income]}; {tech} comfort with technology. "
        f"{STYLE_TEXT[style]} Cares most about {priorities[0]}, {priorities[1]} and {priorities[2]}."
    )
    if dealbreakers:
        bio += " " + " ".join(DEALBREAKER_TEXT[d] for d in dealbreakers)

    return Persona(
        id=f"P{idx:03d}", label=label, age_band=age_band, gender=gender,
        location_type=location, region=region, household=household,
        income_band=income, occupation=occupation, tech_savviness=tech,
        shopping_style=style, price_sensitivity=price_sens,
        priorities=priorities, dealbreakers=dealbreakers, bio=bio,
    )


def generate_personas(n: int = 60, seed: int | None = None) -> list[Persona]:
    """Age bands are cycled so every band is evenly represented; everything else is random."""
    rng = random.Random(seed)
    return [_make_persona(rng, i + 1, AGE_BANDS[i % len(AGE_BANDS)]) for i in range(n)]


FIELDS = ["age_band", "income_band", "household", "shopping_style",
          "price_sensitivity", "location_type", "region"]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=60)
    args = ap.parse_args()

    personas = generate_personas(args.n)
    PERSONAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PERSONAS_PATH.write_text(json.dumps([p.model_dump() for p in personas], indent=2))
    print(f"Wrote {len(personas)} personas -> {PERSONAS_PATH}")
    for f in FIELDS:
        print(f"  {f:18} {dict(Counter(getattr(p, f) for p in personas).most_common())}")
    db = Counter(d for p in personas for d in p.dealbreakers)
    print(f"  {'dealbreakers':18} {dict(db.most_common())}")
