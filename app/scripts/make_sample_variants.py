"""Generate two demo product-page PDFs (A = control, B = challenger)."""
import sys
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src import config  # noqa: E402

OUT = config.DATA_DIR / "variants"

VARIANTS = {
    "sample_A": {
        "product_name": "Lumen Pro Wireless Earbuds",
        "price": 129.0,
        "currency": "USD",
        "pricing_model": "one-time",
        "key_features": [
            "Active noise cancellation",
            "8-hour battery, 24 hours with case",
            "IPX4 sweat resistance",
            "Bluetooth 5.3",
        ],
        "claims": ["Studio-grade sound you can trust", "Built to last for years"],
        "warranty": "1-year limited warranty",
        "return_policy": "30-day free returns, no questions asked",
        "shipping": "Free 2-day shipping",
        "social_proof": "4.6 stars from 2,300 reviews",
        "promotions": None,
        "target_audience": "Commuters and everyday listeners",
    },
    "sample_B": {
        "product_name": "Lumen Pro Wireless Earbuds",
        "price": 99.0,
        "currency": "USD",
        "pricing_model": "one-time",
        "key_features": [
            "Active noise cancellation",
            "10-hour battery, 32 hours with case",
            "IPX5 water resistance",
            "Bluetooth 5.3 with multipoint",
            "Wireless charging case",
            "Custom EQ app",
        ],
        "claims": ["More features for less", "Best value in premium audio"],
        "warranty": None,
        "return_policy": "14-day returns; buyer pays return shipping",
        "shipping": "Standard shipping, 5-7 business days",
        "social_proof": "4.3 stars from 410 reviews",
        "promotions": "Launch price, save $30",
        "target_audience": "Value-focused tech enthusiasts",
    },
}


def lines(v: dict) -> list[tuple[str, str]]:
    """(label, text) rows in page order; label is the Variant field each line backs."""
    rows = [
        ("product_name", v["product_name"]),
        ("price", f"${v['price']:.0f} (one-time purchase)"),
    ]
    if v["promotions"]:
        rows.append(("promotions", v["promotions"]))
    rows += [("claims", c) for c in v["claims"]]
    rows += [("key_features", f) for f in v["key_features"]]
    rows += [
        ("shipping", f"Shipping: {v['shipping']}"),
        ("return_policy", f"Returns: {v['return_policy']}"),
        ("warranty", f"Warranty: {v['warranty'] or 'No warranty included'}"),
        ("social_proof", f"Rated {v['social_proof']}"),
        ("target_audience", f"Made for: {v['target_audience']}"),
    ]
    return rows


def write_pdf(path: Path, v: dict) -> None:
    ss = getSampleStyleSheet()
    story = []
    for field, text in lines(v):
        style = ss["Title"] if field == "product_name" else ss["Heading2"] if field == "price" else ss["BodyText"]
        prefix = "• " if field == "key_features" else ""
        story += [Paragraph(prefix + text, style), Spacer(1, 4)]
    SimpleDocTemplate(str(path), pagesize=letter).build(story)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, v in VARIANTS.items():
        write_pdf(OUT / f"{name}.pdf", v)
        print("wrote", OUT / f"{name}.pdf")
