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

export type RunPersona = {
  id: string
  label: string
  age_band: string
  gender: string
  location_type: string
  region: string
  household: string
  income_band: string
  occupation: string
  tech_savviness: string
  shopping_style: string
  price_sensitivity: string
  priorities: string[]
  dealbreakers: string[]
  bio: string
  weight: number
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

export type RunListItem = {
  id: string
  created_at: string | null
  stats: RunStats
  personas: number
  propensity: Record<string, number> // mean P(buy) per variant
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

  /** Runs every persona x variant through Drex (a few seconds for 60 x 2) and returns the saved run. */
  createRun: (pid: string, n?: number) => req<Run>('POST', `/products/${pid}/runs${n ? `?n=${n}` : ''}`),
  listRuns: (pid: string) => req<RunListItem[]>('GET', `/products/${pid}/runs`),
  latestRun: (pid: string) => req<Run>('GET', `/products/${pid}/runs/latest`),
  getRun: (pid: string, runId: string) => req<Run>('GET', `/products/${pid}/runs/${runId}`),
}

// ---- Drex vs LLM benchmark (scripts/benchmark.py) ----

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

export const benchApi = {
  listBenchmarks: () => req<BenchmarkListItem[]>('GET', '/benchmarks'),
  getBenchmark: (id: string) => req<Benchmark>('GET', `/benchmarks/${id}`),
}
