"""Run the decision model on the data pack and print a summary.

  python app/scripts/run_panel.py --mock              # offline, 1000 customers x canonical products
  python app/scripts/run_panel.py -n 50               # live Drex on 50 customers
  python app/scripts/run_panel.py --products p.json   # products from the NDI pipeline (Product list)
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.analysis import analyze  # noqa: E402
from src.data_pack import load_canonical_products, load_customers  # noqa: E402
from src.models import Product  # noqa: E402
from src.panel import run_panel  # noqa: E402


def progress(done, total):
    if done % max(1, total // 20) == 0 or done == total:
        print(f"\r  {done}/{total}", end="", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=None, help="number of customers (default all)")
    ap.add_argument("--mock", action="store_true", default=None)
    ap.add_argument("--products", type=Path, help="JSON list (or {products: [...]}) of Product records")
    a = ap.parse_args()

    customers = load_customers(a.n)
    if a.products:
        raw = json.loads(a.products.read_text())
        products = [Product(**p) for p in (raw["products"] if isinstance(raw, dict) else raw)]
    else:
        products = load_canonical_products()

    res = asyncio.run(run_panel(customers, products, on_progress=progress, mock=a.mock))
    r = analyze(res, customers)
    s = r["stats"]
    print(f"\n\n{s['ok']}/{s['pairs']} decisions in {s['wall_s']}s  mock={s['mock']}  cached={s['cached']}"
          f"  failed={s['failed']}  median latency={s['median_latency_ms']}ms  tokens={s['input_tokens']}")
    print("\nSimulated purchase propensity (not real conversion):")
    print(r["summary"].round(3).to_string(index=False))
    print("\nLift vs control (paired bootstrap 95% CI):")
    print(r["lift"].round(3).to_string(index=False))
    print("\nTop skip reasons:")
    print(r["skip_reasons"].groupby("product_id").head(3).round(3).to_string(index=False))
    seg = r["segments"]
    print("\nBy price sensitivity:")
    print(seg[seg.dimension == "price_band"].pivot(index="segment", columns="product_id", values="propensity").round(3))
    print("\nBaseline propensity:")
    print(r["baseline_summary"][["product_id", "propensity", "buy_share", "preference_share"]].round(3).to_string(index=False))
    print("\nDrex vs baseline agreement:", {k: round(v, 3) for k, v in r["agreement"].items()})
    print(f"\nRun saved: {s.get('run_file')}")


if __name__ == "__main__":
    main()
