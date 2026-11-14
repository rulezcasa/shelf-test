from pydantic import BaseModel


class Persona(BaseModel):
    """A synthetic shopper. Generated personas fill every field; interview personas leave
    anything the interviewee didn't say empty (None / []) rather than guessing."""
    id: str
    label: str                       # short display line, e.g. "42, suburban nurse, family with kids"
    name: str | None = None          # interviewee's first name, if they gave one
    age_band: str | None = None
    gender: str | None = None
    location_type: str | None = None
    region: str | None = None
    household: str | None = None
    income_band: str | None = None
    occupation: str | None = None
    tech_savviness: str | None = None
    shopping_style: str | None = None
    price_sensitivity: str | None = None
    priorities: list[str] = []
    dealbreakers: list[str] = []
    bio: str | None = None
    weight: float = 1.0
    source: str = "generated"        # "generated" | "interview"
    source_file: str | None = None   # original audio file name for interview personas

    def decision_view(self) -> dict:
        """What Drex sees: the persona's attributes, minus our ids/labels/bookkeeping and empty fields."""
        d = self.model_dump(exclude={"id", "label", "name", "weight", "source", "source_file"})
        return {k: v for k, v in d.items() if v not in (None, "", [])}


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
