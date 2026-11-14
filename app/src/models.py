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

    def decision_view(self) -> dict:
        """What Drex sees: everything except our ids/labels and the aggregation weight."""
        return self.model_dump(exclude={"id", "label", "weight"})


class Attribute(BaseModel):
    name: str                  # whatever the document calls it: "price", "return policy", "battery life", ...
    value: str
    page: int | None = None    # NDI citation
    quote: str | None = None


class Variant(BaseModel):
    variant_id: str            # "A", "B", ... by upload order; A = control
    source_file: str
    product_name: str | None = None
    attributes: list[Attribute] = []   # dynamic: NDI decides which fields the doc has

    def as_product(self) -> dict:
        """What Drex sees: name + every attribute, no citation metadata."""
        return {"product_name": self.product_name, **{a.name: a.value for a in self.attributes}}


class Product(BaseModel):
    """A product under test; holds its variants (A = control)."""
    id: str
    name: str
    created_at: str
    variants: list[Variant] = []


class Decision(BaseModel):
    """One persona x one variant, from Drex."""
    persona_id: str
    variant_id: str
    p_buy: float               # Drex noul answer
    buy_confidence: float
    outcome: str               # "buy" | "consider" | "reject" (BUY_THRESHOLD / CONSIDER_THRESHOLD)
    skip_reason: str           # "would_buy" for buyers, else the top non-would_buy label
    skip_reason_probs: dict[str, float]
    skip_reason_confidence: float
    low_confidence: bool       # buy_confidence < LOW_CONFIDENCE
    request_id: str | None = None
    latency_ms: float | None = None
