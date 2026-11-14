"""Loaders for the MarketTwin data pack."""
import json

from . import config
from .models import Customer, Product


def load_customers(limit: int | None = None) -> list[Customer]:
    rows = json.loads(config.CUSTOMERS_PATH.read_text())["customers"]
    return [Customer(**r) for r in rows[:limit]]


def load_canonical_products() -> list[Product]:
    return [Product(**p) for p in json.loads(config.CANONICAL_PRODUCTS_PATH.read_text())["products"]]
