"""Run the persona panel on one product's variants through Drex and print the summary.

    python scripts/run_panel.py                 # most recent product, all personas
    python scripts/run_panel.py <product_id> -n 5
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.api import store  # noqa: E402
from src.model.analysis import analyze  # noqa: E402
from src.model.panel import load_personas, run_panel  # noqa: E402


def progress(done, total, _decision=None):
    if done % max(1, total // 20) == 0 or done == total:
        print(f"\r  {done}/{total}", end="", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("product_id", nargs="?", help="default: most recently created product")
    ap.add_argument("-n", type=int, default=None, help="number of personas (default all)")
    a = ap.parse_args()

    if a.product_id:
        product = store.get(a.product_id)
    else:
        products = store.list_products()
        if not products:
            sys.exit("No products yet. Create one and upload variants in the webapp.")
        product = products[0]
    if len(product.variants) < 2:
        sys.exit(f"{product.name} has {len(product.variants)} variant(s); need at least 2.")

    personas = load_personas(a.n)
    print(f"{product.name}: {len(personas)} personas x {len(product.variants)} variants")
    res = asyncio.run(run_panel(personas, product.variants, on_progress=progress))
    r = analyze(res, personas)
    s = r["stats"]
    print(f"\n\n{s['ok']}/{s['pairs']} decisions in {s['wall_s']}s  failed={s['failed']}"
          f"  median latency={s['median_latency_ms']}ms")
    for f in s["failures"][:3]:
        print("  failure:", f["error"][:300])
    if not res["decisions"]:
        return
    print("\nSimulated purchase propensity (not real conversion):")
    print(r["summary"].round(3).to_string(index=False))
    print("\nLift vs control (paired bootstrap 95% CI):")
    print(r["lift"].round(3).to_string(index=False))
    print("\nTop skip reasons:")
    print(r["skip_reasons"].groupby("variant_id").head(3).round(3).to_string(index=False))
    seg = r["segments"]
    print("\nBy price sensitivity:")
    print(seg[seg.dimension == "price_sensitivity"].pivot(index="segment", columns="variant_id", values="propensity").round(3))
    print(f"\nRun saved: {store.save_run(product.id, res, personas, product.variants)}")


if __name__ == "__main__":
    main()
