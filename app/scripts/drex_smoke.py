"""Smoke test the Drex client.

  python app/scripts/drex_smoke.py --mock -n 200     # offline
  python app/scripts/drex_smoke.py -n 1              # one live call (needs NACE_API_KEY)
"""
import argparse
import asyncio
import collections
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.data_pack import load_canonical_products, load_customers  # noqa: E402
from src.drex_client import DrexClient  # noqa: E402


async def main(n: int, mock: bool, no_cache: bool):
    customers = load_customers(n)
    products = load_canonical_products()
    t0 = time.perf_counter()
    async with DrexClient(mock=mock, use_cache=not no_cache) as drex:
        decisions = [await drex.evaluate(c, p) for c in customers for p in products]
    dt = time.perf_counter() - t0

    print(f"{len(decisions)} decisions in {dt:.2f}s  (mock={mock}, tokens={drex.input_tokens})")
    if n == 1:
        for d in decisions:
            print(d.model_dump_json(indent=1))
    for p in products:
        ds = [d for d in decisions if d.product_id == p.product_id]
        mean = sum(d.p_buy for d in ds) / len(ds)
        outcomes = collections.Counter(d.outcome for d in ds)
        reasons = collections.Counter(d.skip_reason for d in ds if d.outcome != "buy").most_common(3)
        print(f"  {p.product_id} {p.name:15} ${p.price:.0f}  mean p_buy={mean:.3f}  {dict(outcomes)}  top skip={reasons}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=50)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--no-cache", action="store_true")
    a = ap.parse_args()
    asyncio.run(main(a.n, a.mock, a.no_cache))
