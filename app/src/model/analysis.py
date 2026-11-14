"""Aggregate decisions: propensity per variant, paired lift with bootstrap CI, segments,
skip reasons, persona table. First variant is control. All results are
*simulated purchase intent*, not real conversion."""
import numpy as np
import pandas as pd

from ..models import Decision, Persona

SEGMENT_DIMS = ["age_band", "income_band", "shopping_style", "price_sensitivity", "location_type", "household", "tech_savviness"]
N_BOOT, SEED = 1000, 20261114


def persona_frame(personas: list[Persona]) -> pd.DataFrame:
    return pd.DataFrame([p.model_dump(exclude={"bio", "priorities", "dealbreakers"}) for p in personas]).rename(
        columns={"id": "persona_id"})


def decision_frame(decisions: list[Decision], personas: list[Persona]) -> pd.DataFrame:
    d = pd.DataFrame([x.model_dump() for x in decisions])
    return d.merge(persona_frame(personas), on="persona_id", how="left")


def _wide(df: pd.DataFrame, col: str = "p_buy") -> pd.DataFrame:
    """persona x variant matrix, only personas with all variants evaluated (paired design)."""
    return df.pivot(index="persona_id", columns="variant_id", values=col).dropna()


def product_summary(df: pd.DataFrame) -> pd.DataFrame:
    wide = _wide(df)
    w = df.groupby("persona_id")["weight"].first().reindex(wide.index).to_numpy()
    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, len(wide), (N_BOOT, len(wide)))
    rows = []
    for pid in wide.columns:
        x = wide[pid].to_numpy()
        boots = (x[idx] * w[idx]).sum(1) / w[idx].sum(1)
        sub = df[df.variant_id == pid]
        out = sub.outcome.value_counts(normalize=True)
        rows.append({
            "variant_id": pid,
            "propensity": float(np.average(x, weights=w)),
            "ci_low": float(np.percentile(boots, 2.5)), "ci_high": float(np.percentile(boots, 97.5)),
            "buy_share": float(out.get("buy", 0)), "consider_share": float(out.get("consider", 0)),
            "reject_share": float(out.get("reject", 0)),
            "mean_confidence": float(sub.buy_confidence.mean()),
            "low_confidence_count": int(sub.low_confidence.sum()),
            "preference_share": float((wide.idxmax(axis=1) == pid).mean()),  # share of personas who prefer this one
        })
    return pd.DataFrame(rows)


def lift(df: pd.DataFrame, control: str | None = None) -> pd.DataFrame:
    """Paired bootstrap lift of each variant vs control (same personas resampled for both)."""
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
            "variant_id": pid, "control": control,
            "abs_lift": float(diff.mean()), "rel_lift": float(diff.mean() / a.mean()),
            "ci_low": float(np.percentile(boots, 2.5)), "ci_high": float(np.percentile(boots, 97.5)),
            "prob_better": float((boots > 0).mean()),
        })
    return pd.DataFrame(rows)


def segments(df: pd.DataFrame, dim: str) -> pd.DataFrame:
    """Tidy: one row per (segment, variant) with mean propensity and n."""
    g = df.groupby([dim, "variant_id"]).agg(propensity=("p_buy", "mean"), n=("persona_id", "nunique"))
    return g.reset_index().rename(columns={dim: "segment"}).assign(dimension=dim)


def all_segments(df: pd.DataFrame) -> pd.DataFrame:
    return pd.concat([segments(df, d) for d in SEGMENT_DIMS], ignore_index=True)


def skip_reasons(df: pd.DataFrame) -> pd.DataFrame:
    s = df[df.outcome != "buy"].groupby(["variant_id", "skip_reason"]).size().rename("count").reset_index()
    s["share"] = s["count"] / s.groupby("variant_id")["count"].transform("sum")
    return s.sort_values(["variant_id", "count"], ascending=[True, False])


def persona_table(df: pd.DataFrame) -> pd.DataFrame:
    """One row per persona: p_buy and skip reason per variant, delta vs control, sorted by |delta|."""
    p = _wide(df).add_prefix("p_buy_")
    r = df.pivot(index="persona_id", columns="variant_id", values="skip_reason").add_prefix("reason_")
    t = p.join(r)
    cols = [c for c in p.columns]
    if len(cols) >= 2:
        t["delta"] = t[cols[1]] - t[cols[0]]
        t = t.reindex(t["delta"].abs().sort_values(ascending=False).index)
    return t.reset_index()


def analyze(result: dict, personas: list[Persona]) -> dict:
    """Everything the dashboard needs from one run_panel() result."""
    df = decision_frame(result["decisions"], personas)
    return {
        "summary": product_summary(df), "lift": lift(df), "segments": all_segments(df),
        "skip_reasons": skip_reasons(df), "personas": persona_table(df), "stats": result["stats"],
    }
