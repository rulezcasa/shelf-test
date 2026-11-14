// Typed client for the backend in app/src/api (proxied at /api by vite.config.ts).
// Types mirror app/src/models.py.

export type Attribute = { name: string; value: string; page?: number | null; quote?: string | null }

// Dynamic: NDI decides which attributes a document has.
export type Variant = {
  variant_id: string
  source_file: string
  product_name: string | null
  attributes: Attribute[]
}

export type Product = { id: string; name: string; created_at: string; variants: Variant[] }

// Panel runs (Drex). Mirrors app/src/api/runs.py.
export type RunStats = {
  pairs: number
  ok: number
  failed: number
  failures: { persona_id: string; variant_id: string; error: string }[]
  wall_s: number
  median_latency_ms: number | null
  model: string
  buy_threshold: number
  consider_threshold: number
  market_context?: boolean
  market_created_at?: string | null
}

export type RunDecision = {
  persona_id: string
  variant_id: string
  p_buy: number
  buy_confidence: number
  outcome: 'buy' | 'consider' | 'reject'
  skip_reason: string
  skip_reason_probs: Record<string, number>
  skip_reason_confidence: number
  low_confidence: boolean
  request_id: string | null
  latency_ms: number | null
}

// A persona. Interview personas leave anything the interviewee didn't say empty (null / []).
export type RunPersona = {
  id: string
  label: string
  name?: string | null
  age_band: string | null
  gender: string | null
  location_type: string | null
  region: string | null
  household: string | null
  income_band: string | null
  occupation: string | null
  tech_savviness: string | null
  shopping_style: string | null
  price_sensitivity: string | null
  priorities: string[]
  dealbreakers: string[]
  bio: string | null
  weight: number
  source?: 'generated' | 'interview'
  source_file?: string | null
}
export type Persona = RunPersona
export type PersonaEdit = Partial<Omit<RunPersona, 'id' | 'weight' | 'source' | 'source_file'>>

// Streamed while an interview is analyzed (POST /personas/analyze/*, NDJSON).
export type AnalyzeEvent =
  | { type: 'stage'; stage: 'uploading' | 'transcribing' | 'extracting' }
  | { type: 'transcript'; segments: { speaker: string | null; start_ms: number; end_ms: number; text: string }[]; duration_ms: number | null; peaks: number[]; markdown: string }
  | { type: 'draft'; draft_id: string; persona: Persona }
  | { type: 'error'; message: string }

export type TranscriptSegment = { kind: 'speech' | 'silence'; start_ms: number; end_ms: number; speaker: string | null; transcript?: string }
export type Transcript = {
  transcript: { duration_ms?: number; speakers?: { id: string; label: string | null }[]; segments?: TranscriptSegment[]; peaks?: number[] }
  markdown: string
  has_audio?: boolean
}

export type Run = {
  id: string
  created_at: string | null
  stats: RunStats
  variants: Variant[] // snapshot at run time
  personas: RunPersona[]
  decisions: RunDecision[]
  analysis: {
    summary: {
      variant_id: string
      propensity: number
      ci_low: number
      ci_high: number
      buy_share: number
      consider_share: number
      reject_share: number
      mean_confidence: number
      low_confidence_count: number
      preference_share: number
    }[]
    lift: {
      variant_id: string
      control: string
      abs_lift: number
      rel_lift: number
      ci_low: number
      ci_high: number
      prob_better: number
    }[]
    segments: { segment: string; variant_id: string; propensity: number; n: number; dimension: string }[]
    skip_reasons: { variant_id: string; skip_reason: string; count: number; share: number }[]
    personas: Record<string, number | string | null>[]
  } | null
}

// Streamed while a run is in progress (POST /runs/stream, NDJSON).
export type RunEvent =
  | { type: 'start'; total: number; personas: string[]; variants: string[] }
  | {
      type: 'decision'
      done: number
      total: number
      persona_id: string
      variant_id: string
      p_buy: number
      outcome: 'buy' | 'consider' | 'reject'
      skip_reason: string
    }
  | { type: 'failed'; done: number; total: number }
  | { type: 'done'; run_id: string; stats: RunStats }
  | { type: 'error'; message: string }

export type RunListItem = {
  id: string
  created_at: string | null
  stats: RunStats
  personas: number
  propensity: Record<string, number> // mean P(buy) per variant
}

/** POST and read an NDJSON stream; calls onEvent per line. Throws on HTTP errors. */
async function streamNdjson<E>(path: string, body: BodyInit | undefined, headers: HeadersInit | undefined, onEvent: (e: E) => void, signal?: AbortSignal) {
  const r = await fetch(`/api${path}`, { method: 'POST', body, headers, signal })
  if (!r.ok || !r.body) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg)
  }
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) onEvent(JSON.parse(line) as E)
    }
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const r = await fetch(`/api${path}`, init)
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg)
  }
  return (r.status === 204 ? undefined : await r.json()) as T
}

export const api = {
  listProducts: () => req<Product[]>('GET', '/products'),
  getProduct: (pid: string) => req<Product>('GET', `/products/${pid}`),
  createProduct: (name: string) => req<Product>('POST', '/products', { name }),
  deleteProduct: (pid: string) => req<void>('DELETE', `/products/${pid}`),

  /** Uploads the PDF and runs NDI extraction; resolves when extraction is done (~10-30 s). */
  uploadVariant: (pid: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<Variant>('POST', `/products/${pid}/variants`, fd)
  },
  updateVariant: (pid: string, vid: string, v: Pick<Variant, 'product_name' | 'attributes'>) =>
    req<Variant>('PUT', `/products/${pid}/variants/${vid}`, v),
  deleteVariant: (pid: string, vid: string) => req<void>('DELETE', `/products/${pid}/variants/${vid}`),
  fileUrl: (pid: string, vid: string) => `/api/products/${pid}/variants/${vid}/file`,

  listPersonas: () => req<RunPersona[]>('GET', '/personas'),
  /** Analyze interview audio with NDI (streamed stages); nothing is saved until saveDraft. */
  analyzeAudio: (file: File, onEvent: (e: AnalyzeEvent) => void, signal?: AbortSignal) => {
    const fd = new FormData()
    fd.append('file', file)
    return streamNdjson<AnalyzeEvent>('/personas/analyze/audio', fd, undefined, onEvent, signal)
  },
  /** Analyze a pasted interview transcript (streamed); nothing is saved until saveDraft. */
  analyzeTranscript: (text: string, title: string | undefined, onEvent: (e: AnalyzeEvent) => void, signal?: AbortSignal) =>
    streamNdjson<AnalyzeEvent>('/personas/analyze/transcript', JSON.stringify({ text, title }), { 'Content-Type': 'application/json' }, onEvent, signal),
  saveDraft: (draftId: string) => req<Persona>('POST', `/personas/drafts/${draftId}`),
  discardDraft: (draftId: string) => req<void>('DELETE', `/personas/drafts/${draftId}`),
  updatePersona: (id: string, changes: PersonaEdit) => req<Persona>('PUT', `/personas/${id}`, changes),
  deletePersona: (id: string) => req<void>('DELETE', `/personas/${id}`),
  personaTranscript: (id: string) => req<Transcript>('GET', `/personas/${id}/transcript`),
  personaAudioUrl: (id: string) => `/api/personas/${id}/audio`,

  /** Runs every persona x variant through Drex (a few seconds for 60 x 2) and returns the saved run. */
  createRun: (pid: string, n?: number) => req<Run>('POST', `/products/${pid}/runs${n ? `?n=${n}` : ''}`),
  /** Starts a run and calls onEvent for every streamed event. Resolves with the saved run id. */
  streamRun: async (pid: string, onEvent: (e: RunEvent) => void, useMarket = true): Promise<string> => {
    let runId: string | null = null
    await streamNdjson<RunEvent>(`/products/${pid}/runs/stream?market=${useMarket}`, undefined, undefined, (ev) => {
      onEvent(ev)
      if (ev.type === 'error') throw new Error(ev.message)
      if (ev.type === 'done') runId = ev.run_id
    })
    if (!runId) throw new Error('run stream ended unexpectedly')
    return runId
  },
  listRuns: (pid: string) => req<RunListItem[]>('GET', `/products/${pid}/runs`),
  latestRun: (pid: string) => req<Run>('GET', `/products/${pid}/runs/latest`),
  getRun: (pid: string, runId: string) => req<Run>('GET', `/products/${pid}/runs/${runId}`),
}

// ---- Drex vs LLM benchmark. Mirrors app/src/api/benchmarks.py ----

export type BenchmarkModel = {
  summary: { variant_id: string; propensity: number; ci_low: number; ci_high: number; buy_share: number }[]
  lift: { variant_id: string; control: string; abs_lift: number; rel_lift: number; ci_low: number; ci_high: number; prob_better: number }[]
  latency_median_ms: number
  latency_p95_ms: number
  wall_s: number
  throughput_per_s: number
  calls: number
  failed: number
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  repeat_std: number | null
  skip_reasons: Record<string, number>
}

export type Benchmark = {
  id: string
  title: string
  llm_model: string
  drex_model: string
  metrics: {
    drex: BenchmarkModel
    llm: BenchmarkModel
    agreement: {
      p_buy_pearson: number
      p_buy_spearman: number
      mean_abs_diff: number
      outcome_agreement: number
      preferred_variant_agreement: number
    }
  }
  points: {
    persona_id: string
    variant_id: string
    price_sensitivity: string | null
    drex?: number
    llm?: number
  }[]
}

export type BenchmarkListItem = { id: string; title: string; llm_model: string; drex_model: string; personas: number }

export type BenchModelName = 'drex' | 'llm'

// Streamed while a benchmark runs (POST /benchmarks/stream, NDJSON). Drex runs first, then the LLM.
export type BenchmarkEvent =
  | { type: 'start'; personas: number; variants: string[]; calls: number }
  | { type: 'progress'; model: BenchModelName; done: number; total: number; failed: number }
  | { type: 'model_done'; model: BenchModelName; wall_s: number; failed: number }
  | { type: 'done'; id: string }
  | { type: 'error'; message: string }

export const benchApi = {
  listBenchmarks: () => req<BenchmarkListItem[]>('GET', '/benchmarks'),
  getBenchmark: (id: string) => req<Benchmark>('GET', `/benchmarks/${id}`),
  /** Runs Drex and the LLM on the persona panel x this product's variants. Resolves with the benchmark id. */
  runBenchmark: async (productId: string, n: number | null, onEvent: (e: BenchmarkEvent) => void, signal?: AbortSignal): Promise<string> => {
    let id: string | null = null
    let err: string | null = null
    const q = new URLSearchParams({ product: productId, ...(n ? { n: String(n) } : {}) })
    await streamNdjson<BenchmarkEvent>(`/benchmarks/stream?${q}`, undefined, undefined, (ev) => {
      if (ev.type === 'done') id = ev.id
      if (ev.type === 'error') err = ev.message
      onEvent(ev)
    }, signal)
    if (err) throw new Error(err)
    if (!id) throw new Error('benchmark stream ended unexpectedly')
    return id
  },
}

// ---- market intelligence (Keenable) ----

export type MarketIntel = {
  product_id: string
  created_at: string
  category: string
  summary: string
  competitors: { name: string; price: number | null; currency: string | null; key_points: string[]; source_url: string | null }[]
  price_range: { low?: number; median?: number; high?: number; currency?: string }
  complaints: string[]
  common_features: string[]
  common_claims: string[]
  gaps: string[]
  positions: {
    variant_id: string
    price_position: string
    price_percentile: number | null
    missing_common_features: string[]
    advantages: string[]
    exposed_to_complaints: string[]
    verdict: string
  }[]
  queries: Record<string, string>
  sources: { id: number; title: string; url: string; topic: string; published_at: string | null }[]
  requests_used: number
}

export type MarketJob = {
  status: 'idle' | 'running' | 'done' | 'error'
  step: string | null
  steps: string[]
  error?: string | null
  started_at?: string
  finished_at?: string | null
}

export const marketApi = {
  getMarket: (pid: string) => req<MarketIntel>('GET', `/products/${pid}/market`),
  /** Background research started by each test run. */
  getStatus: (pid: string) => req<MarketJob>('GET', `/products/${pid}/market/status`),
  /** Live Keenable research + LLM synthesis (~30-60 s). */
  buildMarket: (pid: string) => req<MarketIntel>('POST', `/products/${pid}/market`),
  createRun: (pid: string, useMarket: boolean) =>
    req<Run>('POST', `/products/${pid}/runs?market=${useMarket}`),
}

// ---- what-if scenarios (market intel + Drex) ----

export type Scenario = {
  competitor_price_pct: number
  competitor_free_shipping: boolean
  own_price_pct: number
  target_variant: string | null
  new_feature: string | null
  poor_reviews_competitor: string | null
  pain_point: string | null
}

export type ScenarioSummary = {
  conversion: Record<string, number>
  buy_share: Record<string, number>
  pick_share: Record<string, number>
  recommended: string
  picks: Record<string, string>
  skip_reasons: Record<string, Record<string, number>>
}

export type MarketSource = { id: number; title: string; url: string; topic: string; published_at: string | null }

export type ScenarioResult = {
  scenario: Scenario
  variants: { variant_id: string; name: string | null; price: number | null }[]
  current: ScenarioSummary
  baseline: ScenarioSummary
  explanation: string[]
  personas: { id: string; label: string; group: string }[]
  market: {
    category: string
    created_at: string
    competitors: MarketIntel['competitors']
    price_range: MarketIntel['price_range']
    complaints: string[]
    common_features: string[]
    gaps: string[]
    sources: Record<string, MarketSource[]>
  }
}

export const scenarioApi = {
  run: (pid: string, scenario: Partial<Scenario>, groupBy: string) =>
    req<ScenarioResult>('POST', `/products/${pid}/scenario`, { scenario, group_by: groupBy }),
}
