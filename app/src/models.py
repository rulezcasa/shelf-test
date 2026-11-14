from pydantic import BaseModel


class Persona(BaseModel):
    id: str
    label: str
    age_band: str
    gender: str
    location_type: str
    region: str
    household: str
    income_band: str
    occupation: str
    tech_savviness: str
    shopping_style: str
    price_sensitivity: str
    priorities: list[str]
    dealbreakers: list[str]
    bio: str
    weight: float = 1.0


class Variant(BaseModel):
    variant_id: str
    source_file: str
    product_name: str | None = None
    price: float | None = None
    currency: str | None = None
    pricing_model: str | None = None
    key_features: list[str] = []
    claims: list[str] = []
    warranty: str | None = None
    return_policy: str | None = None
    shipping: str | None = None
    social_proof: str | None = None
    promotions: str | None = None
    target_audience: str | None = None
    citations: dict[str, list[dict]] = {}


class Decision(BaseModel):
    persona_id: str
    variant_id: str
    p_buy: float
    buy_confidence: float
    buy: bool
    skip_reason: str
    skip_reason_probs: dict[str, float]
    skip_reason_confidence: float
    low_confidence: bool
    request_id: str | None = None
    latency_ms: float | None = None
