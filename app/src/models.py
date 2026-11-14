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


# --- MarketTwin data pack schemas (used by the decision model) ---------------

DECISION_INPUTS = [
    "headphone_budget_usd", "price_sensitivity", "quality_preference", "battery_importance",
    "portability_preference", "connectivity_importance", "design_preference", "primary_use_case",
]


class Customer(BaseModel):
    """One row of synthetic_customers_1000.json. Demographics are for reporting only."""
    customer_id: str
    age_band: str
    gender: str
    income_band: str
    headphone_budget_usd: float
    price_sensitivity: float
    quality_preference: float
    battery_importance: float
    portability_preference: float
    connectivity_importance: float
    design_preference: float
    brand_loyalty: float
    primary_use_case: str
    weight: float = 1.0

    def decision_inputs(self) -> dict:
        """Only the fields the decision model may see (guardrail: no age/gender/income)."""
        return {k: getattr(self, k) for k in DECISION_INPUTS}


class ProductFeatures(BaseModel):
    active_noise_cancellation: bool | None = None
    battery_life_hours: float | None = None
    weight_grams: float | None = None
    multipoint_bluetooth: bool | None = None
    water_resistance_rating: str | None = None
    warranty_months: float | None = None
    wireless_charging: bool | None = None


class Product(BaseModel):
    """Normalized product (canonical_products.json shape). NDI output gets mapped into this."""
    product_id: str
    name: str | None = None
    category: str | None = None
    brand: str | None = None
    price: float | None = None
    currency: str | None = "USD"
    positioning: str | None = None
    features: ProductFeatures = ProductFeatures()
    claims: list[str] = []
    source_document: str | None = None
    citations: dict[str, list[dict]] = {}

    def decision_view(self) -> dict:
        return self.model_dump(exclude={"product_id", "source_document", "citations"})


class CustomerDecision(BaseModel):
    customer_id: str
    product_id: str
    p_buy: float
    buy_confidence: float
    outcome: str                      # "buy" | "consider" | "reject"
    skip_reason: str
    skip_reason_probs: dict[str, float]
    skip_reason_confidence: float
    low_confidence: bool
    source: str                       # "drex" | "mock" | "baseline"
    request_id: str | None = None
    latency_ms: float | None = None
    cached: bool = False
