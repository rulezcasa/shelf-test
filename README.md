# ShelfTest

### Know which product variant wins *before* it gets a single visitor.

ShelfTest runs an A/B test with **synthetic shoppers who know today's market**. Upload two or
more versions of a product page. Within a minute you know which one sells better, by how much,
for which customers, and **why the others walk away**. Then drag a slider ("a competitor
just cut prices 10%") and watch every shopper re-decide live.

Built for the **Nace AI Drexathon** (Nov 14, 2026) on **Drex** · **NDI** · **Keenable** · **DeepInfra**.

---

## Highlights

 Highlight | Proof from our live runs |
---|---|
 **Predictions grounded in the live market.** Keenable searches the web for competitors, current prices, complaints and standard features before any shopper decides. | The **winner flipped**: alone, the $149 variant won by **+19.6 pts**. With live market context, the $249 variant won by **+5.4 pts**. Competitors sell at $399–$749, and the cheap one lacked a feature most rivals have. |
 **Scenario lab with shoppers you can watch.** Sliders for competitor price cuts, free shipping, bad competitor reviews, new pain points, your own price and features. Persona dots animate between variants. | Raising variant A's price by 40% **flipped the recommendation** to B: **11 shoppers switched** and "price" went from **12% → 47%** of A's skip reasons. |
 **A decision model, not a chatbot.** Drex answers exactly the two questions that matter, *will they buy?* and *what stops them?*, for every shopper × variant. | **35× faster** than Llama 3.3 70B (141 ms vs 4.9 s per decision), **6× more consistent** on repeat calls, and a **more decisive lift** (+19.6 vs +12.3 pts), with the same winner. |
 **Real customer voices in the panel.** Upload an interview recording, and NDI turns it into a shopper persona built only from what the customer said. No guessing of gender, income or anything unsaid. | Interview personas join every test alongside 60 generated shoppers. |
 **Every claim is traceable.** Product fields carry the PDF page they came from. Market facts link to the web page Keenable found them on. | 37 sources from ~9 Keenable requests per product, shown beside each assumption. |
 **Statistics, not vibes.** Paired design (every shopper sees every variant), bootstrap 95% CIs, P(better), segment breakdowns and skip-reason mix. | 120 decisions (60 shoppers × 2 variants) in **~5 s**. Results stream in live. |

---

##  Why this matters

**The problem.** Picking which page, price or bundle to ship is a guess that real A/B tests settle
slowly and expensively:

- **Weeks of traffic per test**, and every visitor sent to the losing variant is a lost sale.
  Most teams can afford to test only a handful of ideas, so most ideas are never tested.
- **Tests ignore the market.** A $249 product is "expensive" or "a bargain" depending on what
  competitors charge *this week*. A missing feature only hurts if everyone else has it.
- **Averages hide who you lose.** A variant can win overall and still drive away your
  price-sensitive or most loyal buyers, and the test never tells you *why*.

**The value ShelfTest delivers:**

| Impact | How |
|---|---|
| **Test far more ideas** | Pre-screen every variant in seconds and send real traffic only to the finalists. |
| **Fewer lost conversions** | Losing variants get weeded out *before* they burn live visitors. |
| **Decisions that hold up in the real market** | Each prediction is conditioned on today's competitors, prices and complaints, and refreshes as the market moves. |
| **Know *who* and *why*, not just *which*** | Segment winners/losers plus the dominant skip reason (price, missing feature, trust, shipping/returns...) point straight to the fix. |
| **De-risk launches and pricing moves** | Stress-test a price change or a competitor's move in the scenario lab before it happens. |
| **Trustworthy enough to act on** | Confidence intervals, P(better), and a source link behind every product field and market fact. |

---

##  Why a decision model (Drex) and not just an LLM?

Purchase decisions need a **calibrated, repeatable judgment** for thousands of shopper ×
variant pairs, not a paragraph of text. That's what a decision model is for:

- **Built for the question.** Drex returns a probability of "yes" (P(buy)) with a confidence, and a
  choice over a fixed label set (the skip reason) with a probability for every label. There's
  nothing to parse and no free text to hallucinate, so it plugs straight into statistics.
- **Fast enough to be interactive.** About 140 ms per decision makes a live scenario lab
  possible. With an LLM, every slider move would mean minutes of waiting.
- **Consistent.** Ask Drex about the same shopper and product twice and you get nearly the same
  answer (spread 0.001 vs 0.006 for the LLM). Without that, A/B lift is just noise.
- **Sharper signal.** In our benchmark the LLM bunched answers at round numbers (0.2, 0.6,
  0.8) and blamed price for every skip. Drex separated shoppers more sharply and spread skip
  reasons across price, quality, features and shipping, which is what makes the "why" actionable.
- **LLMs where they shine.** We use an LLM (Llama 3.3 70B on DeepInfra) for what it's good at:
  planning web searches and summarizing Keenable sources into structured market facts. Every
  *purchase decision* goes through Drex.

| Same 60 shoppers × 2 variants | **Drex** | Llama 3.3 70B (DeepInfra) |
|---|---|---|
| Median latency per decision | **141 ms** | 4,937 ms |
| Throughput | **24.7 decisions/s** | 0.8 decisions/s |
| Repeat-call spread (lower = more consistent) | **0.001** | 0.006 |
| Lift of the winner (95% CI) | **+19.6 pts** (+13.1 to +26.0) | +12.3 pts (+7.8 to +17.2) |
| Picks the same winner | ✓ | ✓ |

---

##  How the tools fit together

| Tool | Role in ShelfTest |
|---|---|
| **Drex** (Nace) | The decision engine: P(buy) + skip reason for every shopper × variant, with live market context in its state. |
| **NDI** (Nace Document Intelligence) | Reads variant PDFs into structured fields with page citations, and turns interview audio into personas. |
| **Keenable** | Live web search + clean page retrieval: competitors, current prices, reviews/complaints, standard features, claims and market gaps. |
| **DeepInfra** | Hosts the LLM that plans Keenable searches and synthesizes sources into market facts, and serves as the baseline Drex is benchmarked against. |

> Results are **simulated purchase intent** from synthetic personas. They show direction, not
> calibrated conversion rates. Use ShelfTest to decide which variants deserve real traffic, then
> confirm with a real test.

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


---

## Limitations

- Personas are synthetic, so results are directional, not calibrated conversion rates.
- Market synthesis is only as good as the web sources Keenable finds. Price positions and
  feature lists come from an LLM summary, so check the linked sources.
