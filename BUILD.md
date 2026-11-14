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
6. A **Drex vs LLM benchmark** runs the same panel through a general-purpose LLM and compares them on speed, cost, consistency, output validity and sanity checks (§6.6). This is the track's "why a decision model and not an LLM" point, backed by numbers.

**Out of scope for now:** head-to-head variant comparison, score/Likert questions, LLM-written explanations, personas built from real data (that's a stretch goal, §9).

---

## 2. Stack

- Python 3.11+
- `httpx` (async HTTP), `pydantic` v2 (models), `python-dotenv`
- `pandas`, `numpy` (aggregation)
- `streamlit` + `altair` (UI/charts — fastest path to a demo)
- `reportlab` (only to generate sample variant PDFs for testing)

Use raw `httpx` calls against the REST APIs (not the vendor SDKs) so we control retries and caching. **No mocks anywhere:** everything runs against the real APIs; if a key or capability is missing, stop and ask. Keep each API client in one small file.

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
      main.py                  # FastAPI entry point (§7.1): uvicorn src.main:app --reload --port 8000 (from app/)
      api/                     # business logic behind the endpoints
        store.py               # file-backed product store under data/products/
      models.py                # pydantic: Persona, Attribute, Variant, Product, Decision
      ndi/
        ndi_client.py          # upload / extract (+ job polling)
        extract_variants.py    # doc -> Variant via NDI (dynamic attributes)
      model/                   # decision model
        drex_client.py         # POST /v1/systemone, prompts, parse -> Decision
        panel.py               # load personas, run personas × variants concurrently
        analysis.py            # aggregation, lift, bootstrap CI, segments, skip reasons
      llm_client.py            # LLM baseline: same decide() interface as drex_client, cached
      benchmark.py             # Drex vs LLM metrics (§6.6)
    scripts/
      make_sample_variants.py  # generates 2 demo PDFs (variant A/B)
      gen_personas.py          # one-time pre-build: persona generator, writes data/personas.json
      run_panel.py             # CLI: extract + run + print summary
      run_benchmark.py         # CLI: Drex vs LLM on the same panel, prints metrics table
    data/
      variants/                # input docs
      personas.json            # generated persona panel (committed)
      cache/drex/              # drex responses keyed by request hash
      cache/llm/               # LLM baseline responses keyed by request hash
      benchmarks/              # one JSON per benchmark run
      runs/                    # one JSON per panel run
      products/<id>/           # product.json (Product incl. variants) + runs/<ts>.json + files/<A|B|...>.pdf (git-ignored)
  webapp/                      # frontend: Vite + React + TS (replaces the Streamlit app.py in §7)
    src/App.tsx                # single-page layout, sections per §7
    src/api.ts                 # typed client for app/src/api (Vite proxies /api -> :8000)
    src/App.tsx                # navbar (Products | Tests) + hash routing
    src/ProductsPage.tsx       # product list -> product: upload variants, edit extracted fields, run a test
    src/TestsPage.tsx          # tests grouped by product -> one test's results
    src/TestResults.tsx        # one test: overview, segments, personas, export, run again
    src/RunGraph.tsx           # live run animation: persona ring -> variant nodes, edge per streamed decision
    src/PersonasPage.tsx       # #/personas: persona cards; add from interview audio; review dialog (audio, waveform, transcript, editable fields)
    src/LiveRun.tsx            # useLiveRun(product): streams a run + full-screen RunGraph overlay (product page "Run test", test page "Run again")
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

# NDI (document intelligence) uses the same console key
NACE_BASE_URL=https://console.nace.ai

# LLM baseline (benchmark only, §6.6)
LLM_API_KEY=...
LLM_BASE_URL=...
LLM_MODEL=...
LLM_PRICE_IN_PER_MTOK=0     # $ per 1M input tokens, for cost metric
LLM_PRICE_OUT_PER_MTOK=0
DREX_PRICE_PER_MTOK=0       # $ per 1M input tokens

# Behavior
BUY_THRESHOLD=0.5
LOW_CONFIDENCE=0.6
DREX_CONCURRENCY=8
```

**Keys (verified):** one console key (`nace_sk_...`, `Authorization: Bearer`) covers both Drex and NDI. Keys live in `shelf-test/.env` (repo root); `config.py` loads it from there.

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

### Variant (NDI extraction target, dynamic)

No fixed product fields: products differ (earbuds vs SaaS plan vs mattress) and Drex reads the whole context anyway. NDI returns whatever purchase-relevant attributes the document has.

```python
class Attribute(BaseModel):
    name: str                  # snake_case, chosen by NDI: "price", "return_policy", "battery_life", ...
    value: str                 # lists joined with "; "
    page: int | None = None    # NDI citation
    quote: str | None = None

class Variant(BaseModel):
    variant_id: str            # "A", "B", ... (upload order; A = control)
    source_file: str
    product_name: str | None
    attributes: list[Attribute] = []

    def as_product(self) -> dict: ...   # {product_name, name: value, ...} -> Drex `state.product`
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

### 6.2 NDI client + variant extraction (`src/ndi/ndi_client.py`, `src/ndi/extract_variants.py`)

NDI via the console (verified live):

| Step | Call |
|---|---|
| Extract | `POST {NACE_BASE_URL}/v1/documents/extract?wait_seconds=120` — returns a Job, usually already `succeeded` (~$0.06 for a 5-page doc). |
| Poll | `GET {NACE_BASE_URL}/v1/jobs/{job_id}` until `succeeded` / `failed` / `cancelled`. |
| Parse (not used) | `POST {NACE_BASE_URL}/v1/documents/parse` returns `result.document.markdown`. |

Headers: `Authorization: Bearer $NACE_API_KEY`, `X-Nace-Client: shelf-test/1`.

Sources:
- URL: `{"type": "url", "url": "https://...", "file_name": "x.pdf"}`.
- Local file (`ndi_client.upload`): `POST /v1/documents/upload-grants` `{"path": "shelf-test/<rand>-<name>", "ttl_seconds": 600}` → multipart POST to the grant's `upload_url` with header `X-Upload-Token`, part `file`, text field `metadata={"path": ...}` → job; `result.file` gives `{"type": "workspace_file", "workspace_id", "file_id"}` (no other keys allowed on this source). Random path prefix avoids `409 path_conflict`. The direct `ndi-api.nace.ai/v1/uploads` rejects console keys.

Extract body:

```json
{
  "source": {...},
  "schema": {"product_name": "string|null", "attributes": [{"name": "string", "value": "string"}]},
  "instructions": "List every attribute a shopper would weigh when deciding to buy (price, features, claims, warranty, returns, shipping, reviews, promotions, audience, anything else relevant). snake_case names, each name once, list items joined with '; '.",
  "citations": {"enabled": true, "include_source_text": true}
}
```

The schema is required (NDI won't infer one), but this generic name/value schema lets NDI choose the keys; verified to work. Response: `result.data` matches the schema; `result.fields[]` has `path` (`/attributes/3`), `status`, `confidence`, and `citations[]` with `location.page` (+ `polygons`) and `source_text`. Citations are best-effort: with `enrichment_status: "degraded"` some attributes come back with none, and `source_text` can be an HTML table row (strip tags for display).

`extract_variants.py`:
- `extract_variant(source: dict, variant_id: str) -> Variant`; `extract_all(sources)` assigns A, B, C… by order.
- No caching (kept simple): every call hits NDI.
- Consistent names: `extract_all` runs variants in order and tells NDI the attribute names earlier variants used (reuse for the same kind of fact, new name for a different kind). Verified on the samples: identical names across A/B, B's promotion kept as its own row.

### 6.3 Drex client (`src/model/drex_client.py`)

Endpoint: `POST {DREX_BASE_URL}/v1/systemone`
Headers: `Authorization: Bearer $NACE_API_KEY`, `Content-Type: application/json`

Request per persona × variant:

```json
{
  "model": "drex-latest",
  "state": {
    "task": "You are simulating whether this shopper would purchase this product after reading its product page.",
    "persona": { ...Persona minus id/weight... },
    "product": { ...Variant.as_product(): product_name + every attribute name: value... }
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
- Only 200 responses are billed; log `usage.input_tokens` totals per run.

### 6.4 Panel runner (`src/model/panel.py`)

- `async run_panel(personas, variants, on_progress=None) -> list[Decision]`
- All persona × variant pairs, concurrency limited by `asyncio.Semaphore(DREX_CONCURRENCY)`.
- Calls `on_progress(done, total)` for the UI progress bar.
- A failed pair is logged and skipped (don't crash the run); report the failure count at the end.
- Writes `data/runs/<timestamp>.json` with personas, variants, decisions, and settings.

### 6.5 Analysis (`src/model/analysis.py`)

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

### 6.6 Drex vs LLM benchmark (`src/llm_client.py`, `src/benchmark.py`)

Goal: show with numbers why a decision model fits this job better than prompting an LLM. Same personas, same variants, same `state` and `questions`; only the engine changes.

**LLM baseline (`llm_client.py`)**
- `async decide(state, questions) -> dict` returning the **same answer shape** as Drex (`buy.noul`, `buy.confidence`, `skip_reason.choice`, `skip_reason.probabilities`), so `panel.py` and `analysis.py` run unchanged with `engine="drex" | "llm"`.
- Prompt = the Drex `task` + persona + product + both question instructions + skip-reason criteria, asking for JSON only: `{"p_buy": 0-1, "confidence": 0-1, "skip_reason": "<label>"}`. Keep the prompt in one constant next to the Drex ones.
- Use the provider's structured/JSON output mode if available, temperature at the provider default (that's how people actually use it). Same retry and cache rules as Drex; record input/output tokens and latency.
- Invalid output (unparseable, out-of-range number, unknown label) counts as a **failure** for the validity metric, not retried.

**Consistency runs:** repeat each persona × variant pair `R=3` times per engine. Add `repeat_idx` to the cache key so repeats are real calls but still replay from cache in the demo.

**Metrics (per engine, side by side):**

| Metric | How |
|---|---|
| Latency | p50 / p95 ms per decision; panel wall time at the same concurrency |
| Throughput | decisions / second |
| Cost | $ per 1,000 decisions from logged tokens × configured prices |
| Output validity | % of responses that parse into a valid probability + allowed label |
| Consistency | mean std dev of P(buy) across the R repeats; **flip rate** = % of pairs whose buy/skip decision changes between repeats |
| Probability resolution | number of distinct P(buy) values and a histogram (LLMs tend to cluster on round numbers like 0.7 / 0.8) |
| Price sanity | for high price-sensitivity personas, raise each variant's price by 50%: % of pairs where P(buy) goes **up** (should be ~0) |
| Agreement | % of pairs where Drex and LLM make the same buy/skip call; do they pick the same winning variant and top skip reason? |

**Be honest about what this shows:** there's no real-customer ground truth, so these are speed, cost, stability and sanity metrics, not accuracy. Report whatever the numbers say, even where the LLM wins.

`benchmark.py`: `run_benchmark(personas, variants, R=3) -> BenchmarkResult` returning a tidy metrics table plus the raw decisions per engine; written to `data/benchmarks/<timestamp>.json`.

---

## 7. UI (`webapp/`, React)

> Moved from Streamlit to a Vite + React + TS app in `webapp/`. Run the API (`cd app && uvicorn src.main:app --reload --port 8000`) and the UI (`cd webapp && npm run dev`); Vite proxies `/api`. Everything is wired to the real API: products, variants, NDI extraction, Drex runs and Results. No mock data.

### 7.1 API (`app/src/main.py`)

| Method | Path | What |
|---|---|---|
| GET / POST | `/api/products` | list / create `{name}` |
| GET / PATCH / DELETE | `/api/products/{pid}` | get (incl. variants) / rename / delete |
| POST | `/api/products/{pid}/variants` | multipart `file` (PDF): store original, extract with NDI synchronously (~10–30 s), assign next free letter; earlier variants' attribute names passed for consistency. NDI failure → 502 with the NDI error. |
| PUT | `/api/products/{pid}/variants/{vid}` | save edits `{product_name, attributes}` (names non-empty + unique) |
| DELETE | `/api/products/{pid}/variants/{vid}` | remove variant + its file |
| GET | `/api/products/{pid}/variants/{vid}/file` | original PDF, inline |
| POST | `/api/personas/interview` | multipart audio (mp3/wav/m4a/…): NDI Parse → transcript, transcript markdown uploaded as a doc → NDI Extract (Persona schema) → new persona appended to `personas.json` (`source: "interview"`, unmentioned fields empty). ~15 s+. |
| PUT / DELETE | `/api/personas/{id}` | edit fields / delete (interview personas only) |
| GET | `/api/personas/{id}/audio` · `/transcript` | original recording · NDI transcript (speakers, timed segments, waveform peaks, markdown) |
| POST | `/api/products/{pid}/runs?n=` | run personas (all, or first n) × variants through Drex, save to `products/<id>/runs/<ts>.json` (with a snapshot of the variants), return the run. Needs ≥ 2 variants; Drex config error → 502. |
| GET | `/api/personas` | the persona panel (`data/personas.json`) |
| POST | `/api/products/{pid}/runs/stream?n=` | same as POST `/runs` but streams NDJSON: `start` (persona + variant ids), one `decision` per Drex answer (persona, variant, p_buy, outcome, skip_reason), then `done` (run id) or `error`. Drives the live run graph (`webapp/src/RunGraph.tsx`). |
| GET | `/api/products/{pid}/runs` | list runs, newest first (`id`, `created_at`, `stats`) |
| GET | `/api/products/{pid}/runs/latest` · `/runs/{run_id}` | full run: `stats`, `variants`, `personas`, `decisions`, `analysis` (`summary`, `lift`, `segments`, `skip_reasons`, `personas` table), computed on read |

UI navigation: **Products** (`#/products`, `#/products/<id>`), **Personas** (`#/personas`) and **Tests** (`#/tests`, `#/tests/<id>`, `#/tests/<id>/<run>`). A test = one saved panel run; running from a product opens its results.

Product page flow: create/open product → drop PDFs → one comparison table (row per field, column per variant) edited in place and auto-saved: click a cell to edit (list values one item per line; empty = remove from that variant), click a field name to rename it across variants (also merges mismatched names), × deletes a field everywhere, "+ Add field" adds a row. Column headers link to the original PDF. Citations are stored but not shown. → run panel.

Uploads for a product are serialized server-side (per-product lock) so concurrent uploads get distinct letters and each extraction sees earlier variants' field names.

Single page, top to bottom:

1. **Sidebar**
   - Upload 2+ variant documents (or "Use sample variants" button → `data/variants/sample_*`).
   - Persona panel: count (default 60) + seed → "Regenerate" (writes personas.json).
   - Buy threshold slider (0.3–0.8, default 0.5), low-confidence threshold.
   - Model name.
2. **Variants** — "Extract with NDI" button. Comparison table: one column per variant, one row per attribute name (union across variants, "—" where a variant lacks it). Each cell with a citation shows the NDI quote and page.
3. **Run panel** — button + progress bar ("120 decisions… 2.4 s"). Show the total decisions, wall time, and median Drex latency once done.
4. **Results**
   - KPI row: conversion per variant (with CI), lift of B vs A (abs + rel, CI, P(better)).
   - Segment chart: grouped bar, expected conversion by selected dimension (dropdown), one bar per variant.
   - Skip reasons: stacked/grouped bar of reason share per variant.
   - Heatmap: persona (rows, sorted by segment) × variant, color = P(buy).
   - Persona table (from §6.5) with a filter for "low confidence only". Clicking/expanding a row shows the persona bio and the raw Drex probabilities.
5. **Drex vs LLM** — metrics table from §6.6 (two columns, winner highlighted per row), plus two small charts: latency distribution and P(buy) histogram per engine. Loads from the latest `data/benchmarks/*.json`; a "Run benchmark" button re-runs it.
6. **Export** — download the run JSON and a CSV of decisions.

Keep styling default Streamlit. Cache expensive steps with `st.cache_data` / session state so slider changes don't re-call APIs (threshold changes should only re-run analysis).

---

## 8. Milestones (build in this order)

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | Repo layout, requirements, `.env.example`, config loads. |
| M1 | Personas | `gen_personas.py` writes 60 varied personas and prints a diversity summary. |
| M2 | Drex client | One live call with a real key returns parsed `buy` + `skip_reason`. |
| M3 | Sample variants + NDI | `make_sample_variants.py` makes two PDFs that differ meaningfully (e.g. A: $129, 30-day free returns, 1-yr warranty; B: $99, 14-day returns buyer pays shipping, no warranty, more features). NDI extracts both into `Variant` with citations. |
| M4 | Panel + analysis via CLI | `python scripts/run_panel.py data/variants/*.pdf` prints per-variant conversion, lift with CI, top skip reasons. |
| M5 | Streamlit dashboard | All sections in §7 working end to end on sample variants. |
| M5b | Drex vs LLM benchmark | `python scripts/run_benchmark.py` prints the §6.6 metrics table for both engines on the sample variants; the dashboard section shows it. |
| M6 | Demo polish | Cached demo run loads instantly; README with setup + 60-second demo script. |

Commit after each milestone. If time is short, M5 can drop the heatmap and the persona table expander — KPIs, segment chart and skip reasons are the must-haves.

---

## 9. Stretch goals (only after M6)

1. **Personas from survey CSVs** — NDI parses the spreadsheet into tables; map rows to `Persona` (or use NDI extract with the Persona JSON Schema per respondent).
2. **Personas from interview audio/video** — NDI parse transcribes with speaker attribution; NDI extract per speaker → `Persona`.
3. **Grounded skip reasons** — for the top skip reason per variant, use NDI Ground to highlight the passage in the variant doc that drives it (e.g. the return-policy clause).
4. **Live price slider (optional, ~30 min)** — the demo wow moment and our answer to "is it accurate?".
   - In the Variants section, add a price override slider per variant (default = extracted price, range ≈ 0.5×–2× of it).
   - Only shown when the variant has a `price` attribute. Changing it creates a modified copy of that `Variant` (only the `price` value changes) and re-runs the panel for **that variant only**. Other variants' decisions come from cache.
   - Show a before/after comparison: conversion per variant, segment chart split by `price_sensitivity`, and the skip-reason shift (expect a jump in `price`).
   - Expected on stage: raise B from $99 to $149 → conversion drops mostly in high price-sensitivity segments and `price` becomes the dominant skip reason. If it doesn't, that's a prompt/state issue to fix before the demo.
   - Cache keys already include the full state, so each price point is cached and replays instantly.

---

## 10. Demo script (60–90 s)

1. "Real A/B tests take weeks of traffic. We test variants in seconds with a synthetic shopper panel."
2. Drop in two product PDFs → NDI extracts structured fields, each with a source citation.
3. Run 60 personas × 2 variants → 120 Drex decisions, show the wall time.
4. B beats A overall by X pts — but loses with high-price-sensitivity / retiree segments; skip reasons show `shipping_returns` jumped for B.
5. "Why not just ask an LLM?" Show the Drex vs LLM table: latency, cost per 1k decisions, flip rate on repeat runs, invalid outputs, price-sanity violations.
6. *(If the price slider is built)* Drag B's price from $99 to $149, re-run: conversion drops mostly in price-sensitive segments and `price` becomes the top skip reason.
7. Close: "Use it to decide which variants deserve real traffic." (Be clear that synthetic personas don't replace real customers.)

---

## 11. Guardrails for the build

- Never commit `.env` or keys.
- Drex calls go through the cache. NDI is not cached; an offline demo replays a saved run.
- No mocks or fake data paths. Missing key or capability → ask, don't stub.
- Fail loudly on `401/402/422` with the response body — those are config bugs, not transient.
- Keep prompts (question `instructions` and `criteria`) in one place (`drex_client.py` constants) so they can be tuned quickly.
- Don't add score questions or head-to-head questions unless asked. LLM calls are only for the §6.6 benchmark baseline, never in the main Drex decision path.

---

## 12. Change log (what we actually built)

- **Decision model (`src/model/`), generic, not headphone-specific:**
  - Shoppers = our persona panel `data/personas.json` (60, from `gen_personas.py`). Drex sees `Persona.decision_view()` (all fields except id/label/weight).
  - Products = a product's uploaded `Variant`s. Drex sees `Variant.as_product()` (name + every attribute, as extracted/edited).
  - `drex_client.py`: general task + the 7 general skip reasons (§6.3). Drex `choice` questions require a fixed label set; it returns a probability per label. Plain: no retries, no cache, no mock; any non-200 raises with the body.
  - Outcomes: buy (`p_buy >= BUY_THRESHOLD`, 0.6) / consider (`>= CONSIDER_THRESHOLD`, 0.35) / reject. Non-buyers always get a real skip reason.
  - `panel.py`: `load_personas()`, `run_panel(personas, variants)` concurrently (`DREX_CONCURRENCY`); failed pairs logged and skipped.
  - `analysis.py`: propensity + bootstrap CI, preference share, paired lift vs A, segments (age, income, shopping style, price sensitivity, location, household, tech savviness), skip reasons, persona table.
  - Runs saved per product: `data/products/<id>/runs/<ts>.json` (`store.save_run`).
  - CLI: `python scripts/run_panel.py [product_id] [-n N]` (default: most recent product). Verified live: 3 personas × 2 variants, 6 decisions in 0.5 s.
- **Removed** (headphone-only / mock): MarketTwin data pack loader, `baseline.py` heuristic, `MOCK_DREX`, `drex_smoke.py`. The §6.6 Drex-vs-LLM benchmark is still the planned comparison.
- **Naming:** `Product` = a product under test (webapp/API) holding its `Variant`s; `Decision` = one persona × variant.
- **Interview personas (NDI audio):** `src/ndi/extract_persona.py` + `src/api/personas.py`. One persona per audio file. NDI Parse handles audio (transcript with speakers, `start_ms`/`end_ms` segments, waveform `peaks`; ~$0.0035 for 48 s), but **Extract rejects audio** (`unsupported_file_type:audio`, also via `parse_result`), so the transcript markdown is uploaded as a `.md` document and extracted with the Persona schema (enums for the categorical fields). Instructions: describe the interviewee only; fill a field only when stated or directly implied (city → region, "husband and two kids" → family_with_kids); never guess (gender only if stated, never from a name; income only if they mention earnings). `Persona` fields are now optional; `decision_view()` drops empty ones so Drex only sees what was said. Stored in `personas.json` (same compact format; generated personas unchanged) + `data/personas/<id>/` (audio + transcript.json, git-ignored). Every test runs generated + interview personas.
- **NDI job polling path:** console jobs are read at `GET /v1/documents/jobs/{id}` (not `/v1/jobs/{id}`, which 404s); fixed in `ndi_client._wait`.

## 13. Market intelligence (Keenable) — branch `kleenable`

Before predicting, ShelfTest researches the live market for the product's category.

- `app/src/market/keenable_client.py`: Keenable `POST /v1/search` and `GET /v1/fetch` (`X-API-Key` from `KEENABLE_API_KEY`; without one, the keyless `/public` endpoints with `X-Keenable-Title`). Responses are cached in `data/cache/keenable/`.
- `app/src/market/intel.py`: the LLM plans one query per topic (competitors, prices, complaints, standard features, claims, gaps). It then runs Keenable searches limited to the past year, reads the top 3 complaint pages in full, and the LLM synthesizes a `MarketIntel` (competitors with sourced prices, price range, complaints, standard features, claims, gaps, and each variant's position). About 9 Keenable requests and 30–60 s per product.
- Saved to `data/products/<id>/market.json`. API: `GET/POST /api/products/{pid}/market`; `POST /runs?market=true|false`.
- When a product has research, Drex's state gets a `market` block (`MarketIntel.decision_context(variant_id)`) and the task text tells the shopper to compare against it. Runs record `stats.market_context`.
- UI: a "Market intelligence" panel on the product page, a toggle on Run panel, and a badge on test results.
- Headphones demo (60 personas): without market context B wins by +19.6 pts. With it, A leads by 5.4 pts: competitors at $399–$749 make the $249 A look reasonable, and B lacks multipoint, which most competitors have.

## 14. Scenario lab (branch `dynamicMarket`)

What-if scenarios on top of the Keenable market research, at `#/scenarios/<pid>`.

- `app/src/market/scenario.py` takes a `Scenario`: competitor price % change, competitors add free shipping, own price % on a target variant, a new feature on the target variant, a competitor with poor reviews, and a new market pain point. It changes the target variant's attributes and each variant's market context (it rescales competitor prices and the price range, recomputes the price percentile from actual prices, and adds `recent_market_changes`). Then it runs all personas × variants through Drex. Answers are cached on disk by request hash (`data/cache/drex_scenarios/`), so a slider position you've tried before replays instantly.
- `POST /api/products/{pid}/scenario {scenario, group_by}` returns, for both the scenario and the baseline (today's market): mean propensity, the share of personas picking each variant, each persona's pick (the highest-P(buy) variant they don't reject, otherwise "none"), the recommendation and skip reasons. It also returns a template explanation of what changed, plus the market's Keenable sources grouped by topic.
- UI: sliders and selects, each with the market assumption and Keenable source chips. The dashboard shows a recommendation banner (it highlights when the pick flips), tweened conversion cards, a persona board where dots animate between the variant columns and "Walk away" (ringed if they moved vs today, colored by the chosen segment), the explanation, and a table of market assumptions.
- Demo: raising A's price by 40% flips the recommendation to B (A −17.5 pts; 11 personas move to B; price goes from 12% to 47% of A's skip reasons). Competitors at −10% plus free shipping sends 6 personas from A to walking away and makes shipping/returns 41% of A's skip reasons.
