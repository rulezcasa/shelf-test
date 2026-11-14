"""Benchmark Drex vs an LLM (DeepInfra) on the same persona x variant panel, and plot it.

    python app/scripts/benchmark.py -n 20                 # 20 personas x 2 variants, both models
    python app/scripts/benchmark.py                       # all 60 personas
    python app/scripts/benchmark.py --replot <dir>        # re-plot a saved benchmark, no API calls

Variants default to the MarketTwin data pack's two headphones (canonical_products.json), or
pass --product <store id> to use a product uploaded in the webapp.
Writes data/benchmarks/<timestamp>/{decisions.json, summary.json, benchmark.png}.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import config  # noqa: E402
from src.api import benchmarks  # noqa: E402
from src.model.panel import load_personas  # noqa: E402
from src.models import Attribute, Variant  # noqa: E402

COLORS = {"drex": "#2a6fdb", "llm": "#e07a1f"}


# ---- inputs ------------------------------------------------------------------

def canonical_variants() -> list[Variant]:
    path = config.ROOT.parent.parent / "MarketTwin_Hackathon_Data_Pack" / "canonical_products.json"
    out = []
    for p in json.loads(path.read_text())["products"]:
        attrs = {"brand": p["brand"], "category": p["category"], "price": f"${p['price']:.0f}",
                 "positioning": p["positioning"], **p["features"], "claims": "; ".join(p["claims"])}
        out.append(Variant(variant_id=p["product_id"], source_file=p["source_document"], product_name=p["name"],
                           attributes=[Attribute(name=k, value=str(v)) for k, v in attrs.items()]))
    return out


# ---- running -----------------------------------------------------------------

async def run_model(name: str, personas, variants, repeat: int):
    def progress(done, total, failed):
        print(f"\r  {name}: {done}/{total}" + (f" ({failed} failed)" if failed else ""), end="", flush=True)
    out, st = await benchmarks.run_model(name, personas, variants, repeat, on_progress=progress)
    print()
    for e in st["errors"][:3]:
        print("   error:", e)
    return out, st


# ---- plotting ----------------------------------------------------------------

def plot(df: pd.DataFrame, met: dict, personas, out: Path, title: str):
    main = df[df["repeat"] == 0].merge(
        pd.DataFrame([{"persona_id": p.id, "price_sensitivity": p.price_sensitivity} for p in personas]),
        on="persona_id")
    models = [m for m in ("drex", "llm") if m in met]
    label = {"drex": f"Drex ({config.DREX_MODEL})", "llm": f"LLM ({config.LLM_MODEL.split('/')[-1]})"}
    fig, ax = plt.subplots(2, 3, figsize=(17, 10))
    fig.suptitle(f"{title} — Drex vs LLM benchmark (simulated purchase intent, not real conversion)", fontsize=13)
    width = 0.38

    # 1. propensity per variant with CI
    a = ax[0, 0]
    variants = sorted(main.variant_id.unique())
    x = np.arange(len(variants))
    for i, m in enumerate(models):
        s = pd.DataFrame(met[m]["summary"]).set_index("variant_id").reindex(variants)
        a.bar(x + (i - 0.5) * width, s.propensity, width, color=COLORS[m], label=label[m],
              yerr=[s.propensity - s.ci_low, s.ci_high - s.propensity], capsize=4)
    a.set_xticks(x, variants); a.set_ylim(0, 1); a.set_title("Mean P(buy) per variant (95% CI)"); a.legend(fontsize=8)

    # 2. lift vs control
    a = ax[0, 1]
    for i, m in enumerate(models):
        for j, l in enumerate(met[m]["lift"]):
            a.errorbar(l["abs_lift"], i + j * 0.1, xerr=[[l["abs_lift"] - l["ci_low"]], [l["ci_high"] - l["abs_lift"]]],
                       fmt="o", color=COLORS[m], capsize=5, ms=8)
            a.annotate(f"{l['variant_id']} vs {l['control']}: {l['abs_lift']:+.3f}  P(better)={l['prob_better']:.2f}",
                       (l["abs_lift"], i + j * 0.1 + 0.15), ha="center", fontsize=8)
    a.axvline(0, color="grey", ls="--"); a.set_yticks(range(len(models)), [label[m] for m in models], fontsize=8)
    a.set_ylim(-0.6, len(models) - 0.3); a.set_title("Lift vs control (paired bootstrap 95% CI)")

    # 3. latency
    a = ax[0, 2]
    data = [main[main.model == m].latency_ms.dropna() for m in models]
    bp = a.boxplot(data, tick_labels=[label[m] for m in models], patch_artist=True, showfliers=False)
    for patch, m in zip(bp["boxes"], models):
        patch.set_facecolor(COLORS[m])
    a.set_yscale("log"); a.set_ylabel("ms per decision (log)"); a.tick_params(axis="x", labelsize=8)
    a.set_title("Latency per decision")
    for i, m in enumerate(models):
        a.annotate(f"median {met[m]['latency_median_ms']:.0f} ms", (i + 1, met[m]["latency_median_ms"]),
                   xytext=(28, 0), textcoords="offset points", fontsize=8)

    # 4. scatter agreement
    a = ax[1, 0]
    if "agreement" in met:
        w = main.pivot_table(index=["persona_id", "variant_id"], columns="model", values="p_buy").dropna().reset_index()
        for v in variants:
            s = w[w.variant_id == v]
            a.scatter(s.drex, s.llm, alpha=0.7, label=f"variant {v}")
        a.plot([0, 1], [0, 1], color="grey", ls="--"); a.set_xlim(0, 1); a.set_ylim(0, 1)
        ag = met["agreement"]
        a.set_title(f"P(buy) agreement  r={ag['p_buy_pearson']:.2f}, outcome agree={ag['outcome_agreement']:.0%}")
        a.set_xlabel("Drex P(buy)"); a.set_ylabel("LLM P(buy)"); a.legend(fontsize=8)

    # 5. skip reasons
    a = ax[1, 1]
    reasons = sorted({r for m in models for r in met[m]["skip_reasons"]})
    y = np.arange(len(reasons))
    for i, m in enumerate(models):
        a.barh(y + (i - 0.5) * width, [met[m]["skip_reasons"].get(r, 0) for r in reasons], width,
               color=COLORS[m], label=label[m])
    a.set_yticks(y, reasons, fontsize=8); a.set_title("Skip-reason share among non-buyers"); a.legend(fontsize=8)

    # 6. segment: price sensitivity
    a = ax[1, 2]
    order = [s for s in ("low", "medium", "high") if s in set(main.price_sensitivity)]
    seg = main.groupby(["model", "variant_id", "price_sensitivity"]).p_buy.mean()
    for m in models:
        for v, ls in zip(variants, ("-", "--", ":")):
            a.plot(order, [seg.get((m, v, s), np.nan) for s in order], ls, marker="o", color=COLORS[m],
                   label=f"{m} · {v}")
    a.set_ylim(0, 1); a.set_xlabel("persona price sensitivity"); a.set_title("Mean P(buy) by price sensitivity")
    a.legend(fontsize=8)

    # footer: cost / throughput / consistency
    lines = []
    for m in models:
        r = met[m]
        cost = f"${r['cost_usd']:.4f}" if r["cost_usd"] is not None else "n/a"
        cons = f"{r['repeat_std']:.3f}" if r["repeat_std"] is not None else "n/a"
        lines.append(f"{label[m]}: {r['calls']} calls, {r['failed']} failed, wall {r['wall_s']:.1f}s, "
                     f"{r['throughput_per_s']:.1f} decisions/s, p95 {r['latency_p95_ms']:.0f} ms, "
                     f"cost {cost}, repeat std {cons}")
    fig.text(0.01, 0.005, "\n".join(lines), fontsize=9, family="monospace")
    fig.tight_layout(rect=(0, 0.05, 1, 0.97))
    fig.savefig(out, dpi=130)
    plt.close(fig)


# ---- main --------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=None, help="number of personas (default all)")
    ap.add_argument("--product", help="store product id to use instead of the data-pack headphones")
    ap.add_argument("--models", default="drex,llm")
    ap.add_argument("--repeat", type=int, default=2, help="extra passes on 10 pairs to measure consistency")
    ap.add_argument("--replot", type=Path, help="benchmark dir to re-plot without API calls")
    a = ap.parse_args()

    personas = load_personas(a.n)
    if a.replot:
        out = a.replot
        saved = json.loads((out / "decisions.json").read_text())
        df, run_stats, title = pd.DataFrame(saved["decisions"]), saved["run_stats"], saved["title"]
        personas = [p for p in load_personas() if p.id in set(df.persona_id)]
    else:
        if a.product:
            from src.api import store
            prod = store.get(a.product)
            variants, title = prod.variants, prod.name
        else:
            variants, title = canonical_variants(), "MarketTwin headphones"
        print(f"{title}: {len(personas)} personas x {len(variants)} variants, models={a.models}")
        rows, run_stats = [], {}
        for m in a.models.split(","):
            r, st = asyncio.run(run_model(m, personas, variants, a.repeat))
            rows += r
            run_stats[m] = st
        df = pd.DataFrame(rows)
        out = benchmarks.save(title, rows, run_stats, personas, a.product)

    met = benchmarks.metrics(df, run_stats, personas)
    (out / "summary.json").write_text(json.dumps(met, indent=1, default=float))
    plot(df, met, personas, out / "benchmark.png", title)

    for m in ("drex", "llm"):
        if m in met:
            r = met[m]
            props = ", ".join(f"{s['variant_id']}={s['propensity']:.3f}" for s in r["summary"])
            lifts = ", ".join(f"{l['variant_id']}{l['abs_lift']:+.3f} [{l['ci_low']:+.3f},{l['ci_high']:+.3f}]" for l in r["lift"])
            print(f"{m:5} P(buy) {props} | lift {lifts} | median {r['latency_median_ms']:.0f}ms"
                  f" | {r['throughput_per_s']:.1f}/s | cost {r['cost_usd']} | repeat std {r['repeat_std']}")
    if "agreement" in met:
        print("agreement:", {k: round(v, 3) for k, v in met["agreement"].items()})
    print(f"\nSaved: {out / 'benchmark.png'}")


if __name__ == "__main__":
    main()
