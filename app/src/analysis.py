"""Aggregate decisions: propensity per product, paired lift with bootstrap CI, segments,
skip reasons, Drex-vs-baseline agreement. First product is control. All results are
*simulated purchase intent*, not real conversion."""
import numpy as np
import pandas as pd

from .models import Customer, CustomerDecision

SEGMENT_DIMS = ["primary_use_case", "price_band", "budget_band", "age_band", "income_band", "gender"]
N_BOOT, SEED = 1000, 20261114


def _band(x: float, cuts=(0.33, 0.66), labels=("low", "medium", "high")) -> str:
    return labels[sum(x >= c for c in cuts)]


def customer_frame(customers: list[Customer]) -> pd.DataFrame:
    df = pd.DataFrame([c.model_dump() for c in customers])
    df["price_band"] = df["price_sensitivity"].map(_band)  # price-sensitivity band
    df["budget_band"] = pd.cut(df["headphone_budget_usd"], [0, 150, 250, 1e9],
                               labels=["<$150", "$150-249", "$250+"], right=False).astype(str)
    return df


def decision_frame(decisions: list[CustomerDecision], customers: list[Customer]) -> pd.DataFrame:
    d = pd.DataFrame([x.model_dump() for x in decisions])
    return d.merge(customer_frame(customers), on="customer_id", how="left")


def _wide(df: pd.DataFrame, col: str = "p_buy") -> pd.DataFrame:
    """customer x product matrix, only customers with all products evaluated (paired design)."""
    return df.pivot(index="customer_id", columns="product_id", values=col).dropna()


def product_summary(df: pd.DataFrame) -> pd.DataFrame:
    wide = _wide(df)
    w = df.groupby("customer_id")["weight"].first().reindex(wide.index).to_numpy()
    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, len(wide), (N_BOOT, len(wide)))
    rows = []
    for pid in wide.columns:
        x = wide[pid].to_numpy()
        boots = (x[idx] * w[idx]).sum(1) / w[idx].sum(1)
        sub = df[df.product_id == pid]
        out = sub.outcome.value_counts(normalize=True)
        rows.append({
            "product_id": pid,
            "propensity": float(np.average(x, weights=w)),
            "ci_low": float(np.percentile(boots, 2.5)), "ci_high": float(np.percentile(boots, 97.5)),
            "buy_share": float(out.get("buy", 0)), "consider_share": float(out.get("consider", 0)),
            "reject_share": float(out.get("reject", 0)),
            "mean_confidence": float(sub.buy_confidence.mean()),
            "low_confidence_count": int(sub.low_confidence.sum()),
            "preference_share": float((wide.idxmax(axis=1) == pid).mean()),  # share who prefer this one
        })
    return pd.DataFrame(rows)


def lift(df: pd.DataFrame, control: str | None = None) -> pd.DataFrame:
    """Paired bootstrap lift of each product vs control (same customers resampled for both)."""
    wide = _wide(df)
    control = control or wide.columns[0]
    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, len(wide), (N_BOOT, len(wide)))
    a = wide[control].to_numpy()
    rows = []
    for pid in wide.columns:
        if pid == control:
            continue
        diff = wide[pid].to_numpy() - a
        boots = diff[idx].mean(1)
        rows.append({
            "product_id": pid, "control": control,
            "abs_lift": float(diff.mean()), "rel_lift": float(diff.mean() / a.mean()),
            "ci_low": float(np.percentile(boots, 2.5)), "ci_high": float(np.percentile(boots, 97.5)),
            "prob_better": float((boots > 0).mean()),
        })
    return pd.DataFrame(rows)


def segments(df: pd.DataFrame, dim: str) -> pd.DataFrame:
    """Tidy: one row per (segment, product) with mean propensity and n."""
    g = df.groupby([dim, "product_id"]).agg(propensity=("p_buy", "mean"), n=("customer_id", "nunique"))
    return g.reset_index().rename(columns={dim: "segment"}).assign(dimension=dim)


def all_segments(df: pd.DataFrame) -> pd.DataFrame:
    return pd.concat([segments(df, d) for d in SEGMENT_DIMS], ignore_index=True)


def skip_reasons(df: pd.DataFrame) -> pd.DataFrame:
    s = df[df.outcome != "buy"].groupby(["product_id", "skip_reason"]).size().rename("count").reset_index()
    s["share"] = s["count"] / s.groupby("product_id")["count"].transform("sum")
    return s.sort_values(["product_id", "count"], ascending=[True, False])


def customer_table(df: pd.DataFrame) -> pd.DataFrame:
    """One row per customer: p_buy and skip reason per product, delta vs control, sorted by |delta|."""
    p = _wide(df).add_prefix("p_buy_")
    r = df.pivot(index="customer_id", columns="product_id", values="skip_reason").add_prefix("reason_")
    t = p.join(r)
    cols = [c for c in p.columns]
    if len(cols) >= 2:
        t["delta"] = t[cols[1]] - t[cols[0]]
        t = t.reindex(t["delta"].abs().sort_values(ascending=False).index)
    return t.reset_index()


def agreement(drex_df: pd.DataFrame, base_df: pd.DataFrame) -> dict:
    """How often Drex and the baseline agree on outcome, preferred product, and propensity."""
    m = drex_df.merge(base_df[["customer_id", "product_id", "p_buy", "outcome"]],
                      on=["customer_id", "product_id"], suffixes=("", "_base"))
    wd, wb = _wide(drex_df), _wide(base_df).reindex(_wide(drex_df).index)
    return {
        "outcome_agreement": float((m.outcome == m.outcome_base).mean()),
        "preference_agreement": float((wd.idxmax(axis=1) == wb.idxmax(axis=1)).mean()),
        "p_buy_correlation": float(np.corrcoef(m.p_buy, m.p_buy_base)[0, 1]),
        "mean_abs_diff": float((m.p_buy - m.p_buy_base).abs().mean()),
    }


def analyze(result: dict, customers: list[Customer]) -> dict:
    """Everything the dashboard needs from one run_panel() result."""
    df = decision_frame(result["decisions"], customers)
    base = decision_frame(result["baseline"], customers)
    return {
        "summary": product_summary(df), "lift": lift(df), "segments": all_segments(df),
        "skip_reasons": skip_reasons(df), "customers": customer_table(df),
        "baseline_summary": product_summary(base), "baseline_lift": lift(base),
        "agreement": agreement(df, base), "stats": result["stats"],
    }
