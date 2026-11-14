# ShelfTest — Build Spec

> Synthetic-shopper A/B testing for product variants.
> Built for the Nace AI Drexathon (Nov 14, 2026). Build window: ~5 hours. Team of 1–2.
>
> **Claude Code:** read this whole file before writing code. Build the milestones in order. Keep everything small, working, and demoable at every milestone. Do not add features that aren't listed here.
>
> **This spec is a guideline, not a contract.** The goal is a working product by the deadline. As we build, we will change things: field names, prompts, layout, libraries, even milestones. Real API behavior and what works in the demo win over anything written here. When something in this file turns out to be wrong or gets in the way, pick the simplest working approach, tell us what you changed, and update this file to match so it stays current.

---

## 1. What we're building

A tool that predicts which product variant converts better **before** it gets real traffic.

1. The user supplies **2+ product variant documents** (PDF spec sheets, landing-page PDFs, pricing sheets).
2. **NDI** (Nace Document Intelligence) extracts each variant into a structured JSON record.
3. A fixed panel of **synthetic personas** (generated once across a wide demographic range) evaluates every variant.
4. **Drex** (Nace's decision model) returns, per persona × variant:
   - **Buy vs skip**: P(buy) + confidence (`noul` question)
   - **Skip reason**: one of a fixed set of reasons (`choice` question)
5. A dashboard shows predicted conversion per variant, lift vs control, a segment breakdown, and skip-reason breakdown.

**Out of scope for now:** head-to-head variant comparison, score/Likert questions, LLM-written explanations, personas built from real data (that's a stretch goal, §9).

---

## 2. Stack

- Python 3.11+
- `httpx` (async HTTP), `pydantic` v2 (models), `python-dotenv`
- `pandas`, `numpy` (aggregation)
- `streamlit` + `altair` (UI/charts — fastest path to a demo)
- `reportlab` (only to generate sample variant PDFs for testing)

Use raw `httpx` calls against the REST APIs (not the vendor SDKs) so we control retries, caching, and mocking. Keep each API client in one small file.

---

## 3. Repo layout

```
shelf-test/
  BUILD.md
  README.md
  app/                         # backend: core product + pre-build scripts + data
    requirements.txt
    .env.example               # copy to app/.env
    src/
      config.py                # env + settings
      models.py                # pydantic: Persona, Variant, Decision, PanelResult
      ndi_client.py            # upload / extract (+ job polling)
      extract_variants.py      # doc -> Variant via NDI, cached
      drex_client.py           # POST /v1/systemone, retries, cache, mock mode
      panel.py                 # run personas × variants concurrently
      analysis.py              # aggregation, lift, bootstrap CI, segments
    scripts/
      make_sample_variants.py  # generates 2 demo PDFs (variant A/B)
      gen_personas.py          # one-time pre-build: persona generator, writes data/personas.json
      run_panel.py             # CLI: extract + run + print summary
    data/
      variants/                # input docs
      personas.json            # generated persona panel (committed)
      cache/ndi/               # extracted variants (json)
      cache/drex/              # drex responses keyed by request hash
      runs/                    # one JSON per panel run
  webapp/                      # frontend (TBD; replaces the Streamlit app.py in §7)
```

Run everything from the `shelf-test` conda env (Python 3.12), e.g. `python app/scripts/gen_personas.py`.

---

## 4. Config / env

`.env.example`:

```
# Drex (decision model) — console key
NACE_API_KEY=nace_sk_...
DREX_BASE_URL=https://console.nace.ai
DREX_MODEL=drex-latest

# NDI (document intelligence)
NDI_API_KEY=ndi_sk_...
NDI_BASE_URL=https://ndi-api.nace.ai

# Behavior
BUY_THRESHOLD=0.5
LOW_CONFIDENCE=0.6
DREX_CONCURRENCY=8
MOCK_DREX=false
MOCK_NDI=false
```

**Important — verify keys at kickoff.** Drex uses console keys (`nace_sk_...`, `Authorization: Bearer`). The direct NDI API at `ndi-api.nace.ai` uses separate `ndi_sk_...` keys sent as `X-API-Key`, and console keys do **not** work there. If the hackathon only hands out a console key, check the Console docs for the Perception/NDI endpoint path and update `ndi_client.py` (base URL + auth header are the only things that should change). Keep base URL and auth header style configurable for exactly this reason.

---

## 5. Data models (`src/models.py`)

### Persona

```python
class Persona(BaseModel):
    id: str                    # "P001"
    label: str                 # "34, urban nurse, family w/ kids"
    age_band: str              # "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+"
    gender: str                # "female" | "male" | "nonbinary"
    location_type: str         # "urban" | "suburban" | "rural"
    region: str                # "US-West" | "US-South" | "US-Midwest" | "US-Northeast"
    household: str             # "single" | "couple" | "family_with_kids" | "retiree" | "roommates"
    income_band: str           # "<35k" | "35-75k" | "75-150k" | "150k+"
    occupation: str
    tech_savviness: str        # "low" | "medium" | "high"
    shopping_style: str        # "bargain_hunter" | "researcher" | "brand_loyal" | "impulse" | "eco_conscious" | "convenience_first"
    price_sensitivity: str     # "high" | "medium" | "low"  (derived from income + style)
    priorities: list[str]      # top 3 of: price, quality, durability, convenience, sustainability, brand, design, support, features
    dealbreakers: list[str]    # 0–2 of: "no free returns", "subscription required", "no warranty", "slow shipping", "poor reviews", "complicated setup"
    bio: str                   # 2–3 sentence natural-language summary built from the fields above
    weight: float = 1.0        # population weight for aggregation
```

### Variant (NDI extraction target)

```python
class Variant(BaseModel):
    variant_id: str            # "A", "B", ... (assigned by us from upload order; A = control)
    source_file: str
    product_name: str | None
    price: float | None
    currency: str | None
    pricing_model: str | None  # "one-time" | "subscription" | ...
    key_features: list[str] = []
    claims: list[str] = []     # marketing claims / value props
    warranty: str | None
    return_policy: str | None
    shipping: str | None
    social_proof: str | None   # ratings, review counts, testimonials summary
    promotions: str | None
    target_audience: str | None
    citations: dict[str, list[dict]] = {}   # field path -> NDI citations (page, quote)
```

### Decision (one persona × one variant)

```python
class Decision(BaseModel):
    persona_id: str
    variant_id: str
    p_buy: float               # Drex noul value
    buy_confidence: float      # Drex confidence for the noul answer
    buy: bool                  # p_buy >= BUY_THRESHOLD
    skip_reason: str           # Drex choice (top label)
    skip_reason_probs: dict[str, float]
    skip_reason_confidence: float
    low_confidence: bool       # buy_confidence < LOW_CONFIDENCE
    request_id: str | None
    latency_ms: float | None
```

---

## 6. Components

### 6.1 Persona generator (`scripts/gen_personas.py`)

A one-time pre-build step, not part of the core product: `src/` only reads `data/personas.json`.

Kept deliberately simple (hackathon build, not a reproducible product):

- `generate_personas(n=60, seed=None) -> list[Persona]`: weighted random draws per field, roughly matching US adults. Age bands are cycled so all six are evenly represented; no stratification or seeding requirements.
- Plausibility rules: `retiree` ⇒ 55+, `family_with_kids` ⇒ 25–54 (mostly), `65+` ⇒ "retired" ~80%, `18-24` ⇒ income mostly `<35k`/`35-75k`, occupation drawn from a pool per income band.
- `price_sensitivity`: `<35k` or `bargain_hunter` ⇒ high; `150k+` ⇒ low; else medium.
- `priorities`: 3, always including the style's anchor (bargain_hunter→price, eco_conscious→sustainability, researcher→features, brand_loyal→brand, impulse→design, convenience_first→convenience); high price-sensitivity personas always include price.
- `dealbreakers`: 0–2, weighted toward "no free returns" / "no warranty" so the sample A/B variants actually split the panel.
- `bio`: template string from the fields (no LLM). `weight`: 1.0 for all.
- `scripts/gen_personas.py` writes `data/personas.json` and prints a diversity summary. The committed JSON *is* the stable panel; regenerate only when you want a new one.

### 6.2 NDI client + variant extraction (`src/ndi_client.py`, `src/extract_variants.py`)

Direct NDI API (verify per §4):

| Step | Call |
|---|---|
| Upload | `POST {NDI_BASE_URL}/v1/uploads` — multipart, field `file`. Returns `upload_id`. |
| Extract | `POST {NDI_BASE_URL}/v1/extract?wait_seconds=60` — JSON body below. Returns a Job. |
| Poll | `GET {NDI_BASE_URL}/v1/jobs/{job_id}` until `status` is terminal (`succeeded` / failed states). |

Auth header: `X-API-Key: $NDI_API_KEY`.

Extract body:

```json
{
  "source": {"type": "upload", "upload_id": "<id>"},
  "schema": { ...JSON Schema derived from Variant, minus variant_id/source_file/citations... },
  "instructions": "This is a product marketing or spec document for one product variant. Extract the price as a number without currency symbols. key_features: concrete features/specs. claims: marketing value propositions. If a field is absent, leave it null.",
  "citations": {"enabled": true, "include_source_text": true}
}
```

Completed job `result` contains `data` (JSON matching schema), `fields` (per-field `path`, `status`, `value`; `not_found` is a normal status, not an error) and citations. Map `data` → `Variant`, store citations per field path in `Variant.citations`. Check the "extract response format" docs page for the exact citation property names and adapt the mapping.

`extract_variants.py`:
- `extract_variant(path: Path, variant_id: str) -> Variant`
- Cache by file SHA-256 in `data/cache/ndi/<sha>.json`. Re-runs never re-call NDI for the same file.
- `MOCK_NDI=true`: return a hand-written Variant from a sidecar `<file>.mock.json` if present (lets UI work be done before keys are confirmed).

### 6.3 Drex client (`src/drex_client.py`)

Endpoint: `POST {DREX_BASE_URL}/v1/systemone`
Headers: `Authorization: Bearer $NACE_API_KEY`, `Content-Type: application/json`

Request per persona × variant:

```json
{
  "model": "drex-latest",
  "state": {
    "task": "You are simulating whether this shopper would purchase this product after reading its product page.",
    "persona": { ...Persona minus id/weight... },
    "product": { ...Variant minus variant_id/source_file/citations... }
  },
  "questions": {
    "buy": {
      "type": "noul",
      "instructions": "Given this shopper's budget, priorities, dealbreakers and shopping style, would they buy this product? Yes = they would purchase. No = they would skip."
    },
    "skip_reason": {
      "type": "choice",
      "instructions": "What is the single biggest reason this shopper might NOT buy this product? Pick 'would_buy' if nothing meaningfully holds them back.",
      "criteria": {
        "price": "Too expensive for their budget or not worth the price to them",
        "missing_feature": "Lacks a feature or spec they need",
        "quality_trust": "Doubts about quality, brand credibility, or weak reviews/social proof",
        "shipping_returns": "Shipping, return policy, or warranty terms are a problem",
        "unclear_value": "The value proposition or product description is confusing",
        "not_target_user": "The product is not relevant to their life or needs",
        "would_buy": "Nothing meaningfully holds them back"
      }
    }
  }
}
```

Response (200):

```json
{
  "model": "drex-max-v1.1",
  "answers": {
    "buy":         {"type": "noul", "noul": 0.81, "confidence": 0.81},
    "skip_reason": {"type": "choice", "choice": "price", "confidence": 0.74,
                    "probabilities": {"price": 0.74, "missing_feature": 0.08, "...": 0.0}}
  },
  "usage": {"input_tokens": 512, "output_tokens": 0},
  "evaluation_time_ms": 150.2,
  "request_id": "req_..."
}
```

- `noul` = probability of yes (0–1). `buy = noul >= BUY_THRESHOLD`.
- `choice` = highest-probability label; keep the full `probabilities` map.
- **Skip reason handling:** for skippers, if Drex's top label is `would_buy`, use the highest-probability label *excluding* `would_buy` and store it. For buyers, store `would_buy`. Always keep the raw probabilities.

Client requirements:
- `async decide(state, questions) -> dict` using a shared `httpx.AsyncClient` (timeout 60s).
- Retry on `429`, `500`, `529` with exponential backoff + jitter (max 4 attempts). Do not retry `401/402/422`; surface the error body clearly.
- Cache: key = SHA-256 of canonical JSON `{model, state, questions}`; store in `data/cache/drex/<key>.json`. Check cache before calling.
- `MOCK_DREX=true`: no network. Return a deterministic pseudo-answer derived from a hash of the request plus a simple heuristic (e.g. lower P(buy) when price is high and persona price_sensitivity is high; reason = `price` in that case). Lets the UI and analysis be built and tested offline.
- Only 200 responses are billed; log `usage.input_tokens` totals per run.

### 6.4 Panel runner (`src/panel.py`)

- `async run_panel(personas, variants, on_progress=None) -> list[Decision]`
- All persona × variant pairs, concurrency limited by `asyncio.Semaphore(DREX_CONCURRENCY)`.
- Calls `on_progress(done, total)` for the UI progress bar.
- A failed pair is logged and skipped (don't crash the run); report the failure count at the end.
- Writes `data/runs/<timestamp>.json` with personas, variants, decisions, and settings.

### 6.5 Analysis (`src/analysis.py`)

Input: `list[Decision]`, `list[Persona]`. Variant `A` is control.

Per variant:
- `expected_conversion` = weighted mean of `p_buy`
- `hard_conversion` = weighted share with `buy == True`
- `mean_confidence`, `low_confidence_count`
- 95% CI on `expected_conversion` via bootstrap over personas (1,000 resamples, fixed seed)

Lift (each non-control variant vs A):
- `abs_lift` = conv_X − conv_A, `rel_lift` = abs_lift / conv_A
- Paired bootstrap CI on abs_lift (resample personas, same draw for both variants)
- `prob_better` = share of bootstrap draws where X > A

Segments: expected conversion per variant grouped by `age_band`, `income_band`, `shopping_style`, `location_type`, `household`. Return tidy DataFrames.

Skip reasons: for each variant, the distribution of `skip_reason` among skippers (counts + share).

Persona table: one row per persona with P(buy) per variant, delta, and the skip reason per variant. Sort by largest absolute delta (the personas a variant won or lost).

---

## 7. UI (`app.py`, Streamlit)

Single page, top to bottom:

1. **Sidebar**
   - Upload 2+ variant documents (or "Use sample variants" button → `data/variants/sample_*`).
   - Persona panel: count (default 60) + seed → "Regenerate" (writes personas.json).
   - Buy threshold slider (0.3–0.8, default 0.5), low-confidence threshold.
   - Mock toggles (Drex / NDI), model name.
2. **Variants** — "Extract with NDI" button. Show one card per variant side by side: name, price, features, return policy, etc. Each field gets a small "source" expander with the NDI citation quote and page.
3. **Run panel** — button + progress bar ("120 decisions… 2.4 s"). Show the total decisions, wall time, and median Drex latency once done.
4. **Results**
   - KPI row: conversion per variant (with CI), lift of B vs A (abs + rel, CI, P(better)).
   - Segment chart: grouped bar, expected conversion by selected dimension (dropdown), one bar per variant.
   - Skip reasons: stacked/grouped bar of reason share per variant.
   - Heatmap: persona (rows, sorted by segment) × variant, color = P(buy).
   - Persona table (from §6.5) with a filter for "low confidence only". Clicking/expanding a row shows the persona bio and the raw Drex probabilities.
5. **Export** — download the run JSON and a CSV of decisions.

Keep styling default Streamlit. Cache expensive steps with `st.cache_data` / session state so slider changes don't re-call APIs (threshold changes should only re-run analysis).

---

## 8. Milestones (build in this order)

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | Repo layout, requirements, `.env.example`, config loads. |
| M1 | Personas | `gen_personas.py` writes 60 varied personas and prints a diversity summary. |
| M2 | Drex client (mock + live) | Mock mode returns parsed answers offline; one live call with a real key returns parsed `buy` + `skip_reason`. |
| M3 | Sample variants + NDI | `make_sample_variants.py` makes two PDFs that differ meaningfully (e.g. A: $129, 30-day free returns, 1-yr warranty; B: $99, 14-day returns buyer pays shipping, no warranty, more features). NDI extracts both into `Variant` with citations (or mock sidecars if keys pending). |
| M4 | Panel + analysis via CLI | `python scripts/run_panel.py data/variants/*.pdf` prints per-variant conversion, lift with CI, top skip reasons. |
| M5 | Streamlit dashboard | All sections in §7 working end to end on sample variants. |
| M6 | Demo polish | Cached demo run loads instantly; README with setup + 60-second demo script. |

Commit after each milestone. If time is short, M5 can drop the heatmap and the persona table expander — KPIs, segment chart and skip reasons are the must-haves.

---

## 9. Stretch goals (only after M6)

1. **Personas from survey CSVs** — NDI parses the spreadsheet into tables; map rows to `Persona` (or use NDI extract with the Persona JSON Schema per respondent).
2. **Personas from interview audio/video** — NDI parse transcribes with speaker attribution; NDI extract per speaker → `Persona`.
3. **Grounded skip reasons** — for the top skip reason per variant, use NDI Ground to highlight the passage in the variant doc that drives it (e.g. the return-policy clause).
4. **Live price slider (optional, ~30 min)** — the demo wow moment and our answer to "is it accurate?".
   - In the Variants section, add a price override slider per variant (default = extracted price, range ≈ 0.5×–2× of it).
   - Changing it creates a modified copy of that `Variant` (only `price` changes, citations stay) and re-runs the panel for **that variant only**. Other variants' decisions come from cache.
   - Show a before/after comparison: conversion per variant, segment chart split by `price_sensitivity`, and the skip-reason shift (expect a jump in `price`).
   - Expected on stage: raise B from $99 to $149 → conversion drops mostly in high price-sensitivity segments and `price` becomes the dominant skip reason. If it doesn't, that's a prompt/state issue to fix before the demo.
   - Cache keys already include the full state, so each price point is cached and replays instantly.

---

## 10. Demo script (60–90 s)

1. "Real A/B tests take weeks of traffic. We test variants in seconds with a synthetic shopper panel."
2. Drop in two product PDFs → NDI extracts structured fields, each with a source citation.
3. Run 60 personas × 2 variants → 120 Drex decisions, show the wall time.
4. B beats A overall by X pts — but loses with high-price-sensitivity / retiree segments; skip reasons show `shipping_returns` jumped for B.
5. *(If the price slider is built)* Drag B's price from $99 to $149, re-run: conversion drops mostly in price-sensitive segments and `price` becomes the top skip reason.
6. Close: "Use it to decide which variants deserve real traffic." (Be clear that synthetic personas don't replace real customers.)

---

## 11. Guardrails for the build

- Never commit `.env` or keys.
- All API calls go through the cache; demo must work with Wi-Fi off once cached.
- Fail loudly on `401/402/422` with the response body — those are config bugs, not transient.
- Keep prompts (question `instructions` and `criteria`) in one place (`drex_client.py` constants) so they can be tuned quickly.
- Don't add score questions, head-to-head questions, or LLM calls unless asked.

---

## 12. Change log (what we actually built)

- **Data source pivot:** we use the MarketTwin data pack (`../MarketTwin_Hackathon_Data_Pack`, `DATA_PACK_DIR`) instead of generated personas: 1,000 `Customer`s (headphone preferences) × `Product`s shaped like `canonical_products.json`. Demographics are for reporting only; Drex sees `Customer.decision_inputs()` only.
- **Outcomes:** buy (`p_buy >= BUY_THRESHOLD`, 0.6) / consider (`>= CONSIDER_THRESHOLD`, 0.35) / reject. Skip reasons are headphone-specific (see `drex_client.SKIP_REASONS`).
- **Baseline:** `src/baseline.py` is the transparent heuristic from `experiment_config.json`. It is also the `MOCK_DREX` backend, and every run reports Drex-vs-baseline agreement.
- **Decision model (M4):** `src/panel.py` (`run_panel` → Drex + baseline decisions, saved to `data/runs/`), `src/analysis.py` (`analyze()` → summary with bootstrap CI and preference share, paired lift, segments incl. `price_band`/`budget_band`/`primary_use_case`, skip reasons, customer table, agreement). CLI: `python app/scripts/run_panel.py [--mock] [-n N] [--products products.json]`.
- **NDI handoff:** the NDI pipeline (partner) should output a JSON list of `Product` records; pass it via `--products`.
