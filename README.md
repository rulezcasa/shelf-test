# ShelfTest

**Predict which product variant will win before it gets real traffic.**

ShelfTest is a A/B testing tool. You upload two or more versions of a product page,
spec sheet or pricing sheet. A panel of synthetic shoppers "reads" each one and decides whether
to buy, grounded in what the live market looks like today. You get predicted purchase
propensity per variant, the lift over control with confidence intervals, which shopper
segments each variant wins or loses, and why shoppers skip. A scenario lab then lets you ask
"what if a competitor cuts prices by 10%?" and watch the panel react.

Built for the Nace AI Drexathon (Nov 14, 2026).

---
## Why

- **Real A/B tests are slow and expensive.** They need weeks of traffic, and every losing
  variant costs real conversions while it runs. Most teams can only test a handful of ideas.
- **Variants are judged in a vacuum.** A $249 product looks expensive or cheap depending on
  what competitors charge this week, and a missing feature only matters if everyone else has it.
- **Averages hide who you lose.** A variant that wins overall can still lose your
  price-sensitive or retiree customers, and you rarely learn *why* people didn't buy.

ShelfTest pre-screens variants in seconds, ties each prediction to current market evidence,
breaks results down by segment with skip reasons, and lets you stress-test the decision against
market changes before you commit traffic.

---

## How it works

```
 Variant PDFs ──► NDI extract ──► structured variant fields (with page citations)
                                            │
 Keenable web search + page fetch ──► LLM synthesis ──► market context
   (competitors, prices, complaints,             (competitor prices, standard features,
    standard features, claims, gaps)              complaints, each variant's position)
                                            │
 Persona panel (generated + from customer   │
 interview audio via NDI) ──────────────────┤
                                            ▼
                     Drex: every persona × every variant
                     ├─ buy?        (P(buy) + confidence)
                     └─ skip reason (price, missing feature, quality/trust, ...)
                                            │
                                            ▼
     Analysis: propensity + bootstrap CI, paired lift vs control, segments, skip reasons
                                            │
                                            ▼
     Webapp: Products · Tests · Personas · Scenario lab · Benchmark (Drex vs LLM)
```

1. **Extract.** Each uploaded variant document is parsed by **NDI** (Nace Document
   Intelligence) into named attributes (price, warranty, return policy, features, claims...),
   each with the page and quote it came from. Extracted fields can be edited in the UI.
2. **Research the market.** **Keenable** searches the live web for the product's category
   (competitors, current prices, complaints and reviews, standard features, advertised claims,
   market gaps) and reads the top review pages in full. An LLM turns those sources into a
   structured market summary and places each variant against it (below / in line / above
   market price, missing common features, advantages).
3. **Decide.** **Drex** (Nace's decision model) evaluates every persona × variant pair. Each
   call gets the persona, the variant's fields and that variant's market context, and answers
   two questions: would this shopper buy (P(buy)), and what is the single biggest reason they
   might not (a fixed set of skip reasons).
4. **Analyze.** Decisions become buy / consider / reject outcomes. Per variant: mean
   propensity with a bootstrap 95% CI, buy/consider/reject shares and preference share. Each
   challenger gets a paired lift vs control with CI and P(better). Results are broken down by
   segment (age, income, shopping style, price sensitivity, location, household, tech
   savviness), along with skip-reason distributions and a per-persona table.
5. **Explore.** The scenario lab applies what-if changes to the market and your product and
   re-runs the panel, animating which variant each persona now picks.

---

## Features

| Area | What it does |
|---|---|
| **Products** | Create a product, upload one PDF per variant (A = control), review and edit NDI-extracted fields with source citations, run the panel. |
| **Market intelligence** | Keenable research per product: competitors with sourced prices, price range, complaints, standard features, common claims, gaps, each variant's market position, all sources listed. Research runs in the background with each test, and Drex uses the saved research as context. |
| **Tests** | Every panel run is saved. Results show propensity and CI per variant, lift vs control, skip reasons, segment breakdowns and a persona table, with CSV/JSON export. A live view streams decisions as they arrive. |
| **Personas** | The synthetic panel: generated personas spanning a wide demographic range, plus personas built from **customer interview audio**. NDI transcribes the interview and extracts only what the interviewee actually said, without guessing. |
| **Scenario lab** | Sliders and selects for: competitor prices ±%, competitors add free shipping, your price ±%, your product gains a feature, a competitor gets poor reviews, a new pain point becomes important. Conversion numbers animate, persona dots move between variants and "walk away", and the recommended variant updates (highlighted when it flips). Keenable sources are behind each control. |
| **Benchmark** (`#/benchmark`) | Drex vs a general-purpose LLM (Llama 3.3 70B on DeepInfra) on the same panel: propensity, lift, latency, throughput, consistency, cost and agreement. |

### Example (headphones demo, 60 personas)

- **Market context changes the answer.** Without it, the $149 variant B beats the $249 control
  A by about 20 pts. With live market context, A leads: competitors sell at $399–$749, which
  makes A look reasonable, and B lacks multipoint Bluetooth, which most competitors have.
- **Scenario:** raising A's price by 40% flips the recommendation to B. 11 personas move to B,
  and price goes from 12% to 47% of A's skip reasons.
- **Drex vs LLM:** both models pick the same winner. Drex was about 35× faster (141 ms vs
  4.9 s median per decision), more consistent on repeated calls, and found a larger, more
  decisive lift (+19.6 vs +12.3 pts).


### External services

| Service | Used for | Auth |
|---|---|---|
| **Drex** (`console.nace.ai`, `POST /v1/systemone`) | Purchase decision + skip reason per persona × variant | `NACE_API_KEY` (Bearer) |
| **NDI** (via the Nace console) | Variant document extraction with citations; interview audio transcription + persona extraction | same `NACE_API_KEY` |
| **Keenable** (`api.keenable.ai`) | Live web search + clean page retrieval for market research | `KEENABLE_API_KEY` (optional; falls back to the keyless public tier) |
| **DeepInfra** (OpenAI-compatible) | LLM that synthesizes market research, and the LLM baseline in the benchmark | `DEEPINFRA_API_KEY` |

Data is stored as JSON files under `app/data/`. There is no database.

### Main API routes

| Route | Purpose |
|---|---|
| `GET/POST /api/products`, `GET/PATCH/DELETE /api/products/{pid}` | Products |
| `POST /api/products/{pid}/variants` | Upload a variant PDF (NDI extraction) |
| `PUT/DELETE /api/products/{pid}/variants/{vid}` | Edit/remove extracted fields |
| `GET/POST /api/products/{pid}/market`, `.../market/status` | Keenable market research |
| `POST /api/products/{pid}/runs`, `.../runs/stream` | Run the panel (streamed for the live view) |
| `GET /api/products/{pid}/runs[/latest\|/{run_id}]` | Saved tests + analysis |
| `POST /api/products/{pid}/scenario` | What-if scenario vs today's market |
| `GET /api/personas`, `POST /api/personas/analyze/audio\|transcript` | Persona panel, interview personas |
| `GET /api/benchmarks[/{id}]`, `POST /api/benchmarks/stream` | Drex vs LLM benchmark |

---

## Getting started

**Requirements:** Python 3.11+, Node 18+, a Nace console key. Keenable and DeepInfra keys are
needed for market research and the benchmark.

1. **Configure keys.** Create `shelf-test/.env`:

   ```bash
   NACE_API_KEY=nace_sk_...
   DREX_BASE_URL=https://console.nace.ai
   DREX_MODEL=drex-latest
   NACE_BASE_URL=https://console.nace.ai

   KEENABLE_API_KEY=keen_...          # optional: keyless works at lower limits
   DEEPINFRA_API_KEY=...
   LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo

   BUY_THRESHOLD=0.6                  # p_buy >= this -> buy
   CONSIDER_THRESHOLD=0.35            # >= this -> consider, else reject
   LOW_CONFIDENCE=0.6
   DREX_CONCURRENCY=8
   ```

2. **Install and start the backend:**

   ```bash
   python -m venv .venv && source .venv/bin/activate
   pip install -r app/requirements.txt
   cd app && uvicorn src.main:app --reload --port 8000
   ```

3. **Start the webapp** (in another terminal, from `shelf-test/`):

   ```bash
   npm --prefix webapp install
   npm --prefix webapp run dev
   ```

   Open the URL Vite prints (usually http://localhost:5173). If the backend runs on a port
   other than 8000, start the webapp with `API_URL=http://127.0.0.1:<port>`.

4. **Try it:** Products → New product → upload `app/data/variants/sample_A.pdf` and
   `sample_B.pdf` (or `kestrel_glide_A/B.pdf`) → Run panel → open the test. Then open
   **Scenarios** and pick the product.

```

--nds on what the web sources say. The LLM's price positions and
  feature lists can be imperfect; check the linked sources.
