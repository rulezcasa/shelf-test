import { useEffect, useRef, useState } from 'react'
import { api as productsApi, benchApi as api, type Product, type Benchmark, type BenchmarkListItem, type BenchmarkModel } from './api'
import { Panel, VariantTag, pct } from './ui'

const MODELS = ['drex', 'llm'] as const
type M = (typeof MODELS)[number]
const COLOR: Record<M, string> = { drex: 'var(--bench-drex)', llm: 'var(--bench-llm)' }

const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)} s`)
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`)

/** Drex vs LLM benchmark: route #/benchmark or #/benchmark/<id> (not in the nav). */
export default function BenchmarkPage({ id, go }: { id: string | null; go: (h: string) => void }) {
  const [list, setList] = useState<BenchmarkListItem[]>([])
  const [b, setB] = useState<Benchmark | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api.listBenchmarks().then(setList).catch(() => setList([]))
  }, [reload])
  useEffect(() => {
    setError(null)
    api.getBenchmark(id ?? 'latest').then(setB).catch((e) => {
      setB(null)
      setError((e as Error).message)
    })
  }, [id, reload])

  const onDone = (newId: string) => {
    setReload((r) => r + 1)
    go(`#/benchmark/${newId}`)
  }

  return (
    <div className="results">
      <RunBenchmark onDone={onDone} />
      {error ? (
        <div className="empty-state">
          <h2>No benchmark yet</h2>
          <p className="muted">Pick a product above and hit Run test to compare Drex with the LLM.</p>
        </div>
      ) : !b ? (
        <div className="muted">Loading…</div>
      ) : (
        <BenchmarkResults b={b} list={list} go={go} />
      )}
    </div>
  )
}

const MODEL_NAME: Record<M, string> = { drex: 'Drex', llm: 'LLM' }
type Prog = { done: number; total: number; failed: number; finished?: boolean }

/** Pick one of the user's products + persona count, run both models, stream progress. */
function RunBenchmark({ onDone }: { onDone: (id: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [pid, setPid] = useState('')
  const [n, setN] = useState('')
  const [running, setRunning] = useState(false)
  const [start, setStart] = useState<{ personas: number; variants: string[] } | null>(null)
  const [prog, setProg] = useState<Partial<Record<M, Prog>>>({})
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    productsApi.listProducts().then((ps) => {
      const ok = ps.filter((p) => p.variants.length >= 2)
      setProducts(ok)
      setPid((cur) => cur || ok[0]?.id || '')
    }).catch((e) => setError((e as Error).message))
    return () => abort.current?.abort()
  }, [])

  const run = async () => {
    setRunning(true)
    setError(null)
    setStart(null)
    setProg({})
    abort.current = new AbortController()
    try {
      const id = await api.runBenchmark(pid, n ? Number(n) : null, (ev) => {
        if (ev.type === 'start') setStart({ personas: ev.personas, variants: ev.variants })
        if (ev.type === 'progress') setProg((p) => ({ ...p, [ev.model]: { done: ev.done, total: ev.total, failed: ev.failed } }))
        if (ev.type === 'model_done') setProg((p) => ({ ...p, [ev.model]: { ...p[ev.model]!, finished: true } }))
      }, abort.current.signal)
      onDone(id)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Panel title="Run Drex vs LLM" subtitle="Both models score every persona × variant of the product. Drex runs first, then the LLM.">
      <div className="bench-run">
        <label className="field">
          <span className="field-k">Product</span>
          <select className="input" value={pid} onChange={(e) => setPid(e.target.value)} disabled={running}>
            {products.length === 0 && <option value="">No product with 2+ variants</option>}
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.variants.length} variants</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-k">Personas</span>
          <input className="input bench-n" type="number" min={1} placeholder="All" value={n}
            onChange={(e) => setN(e.target.value)} disabled={running} />
        </label>
        <button className="btn btn-primary" onClick={run} disabled={running || !pid}>
          {running ? 'Running…' : 'Run test'}
        </button>
        {running && <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>}
      </div>
      {start && (
        <div className="bench-progress">
          <div className="muted small">{start.personas} personas × {start.variants.length} variants ({start.variants.join(', ')})</div>
          {MODELS.map((k) => {
            const p = prog[k]
            const frac = p ? p.done / p.total : 0
            return (
              <div key={k} className="bench-prog-row">
                <span className="hbar-label"><span className="legend-dot" style={{ background: COLOR[k] }} /> {MODEL_NAME[k]}</span>
                <div className="bench-track"><div style={{ width: `${frac * 100}%`, background: COLOR[k] }} /></div>
                <span className="small tabular muted">
                  {!p ? 'waiting' : p.finished ? 'done' : `${p.done}/${p.total}`}
                  {p?.failed ? ` · ${p.failed} failed` : ''}
                </span>
              </div>
            )
          })}
          {running && prog.llm?.finished && <div className="muted small">Computing metrics…</div>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Panel>
  )
}

function BenchmarkResults({ b, list, go }: { b: Benchmark; list: BenchmarkListItem[]; go: (h: string) => void }) {
  const m = b.metrics
  const name: Record<M, string> = { drex: `Drex · ${b.drex_model}`, llm: `LLM · ${b.llm_model.split('/').pop()}` }
  const nPersonas = new Set(b.points.map((p) => p.persona_id)).size
  const speedup = m.llm.latency_median_ms / m.drex.latency_median_ms

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Drex vs LLM benchmark</h1>
          <p className="sub">
            {b.title} · {nPersonas} personas × {m.drex.summary.length} variants · same personas, products and
            questions for both models. Simulated purchase intent, not real conversion.
          </p>
        </div>
        {list.length > 1 && (
          <select className="input bench-select" value={b.id} onChange={(e) => go(`#/benchmark/${e.target.value}`)}>
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} · {x.personas} personas
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="run-grid">
        <Fact k="Drex speed-up" v={`${speedup.toFixed(0)}× faster`} />
        <Fact k="Same winner" v={sameWinner(m) ? 'Yes' : 'No'} />
        <Fact k="Drex total time" v={dur(m.drex.wall_s)} />
        <Fact k="LLM total time" v={dur(m.llm.wall_s)} />
      </div>

      <Panel title="Head to head" flush>
        <div className="table-wrap">
          <table className="compare tabular">
            <thead>
              <tr>
                <th>Metric</th>
                {MODELS.map((k) => (
                  <th key={k}>
                    <span className="legend-dot" style={{ background: COLOR[k] }} /> {name[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.drex.summary.map((s, i) => (
                <Row key={s.variant_id} label={<>Mean P(buy) <VariantTag id={s.variant_id} /></>}
                  vals={MODELS.map((k) => {
                    const x = m[k].summary[i]
                    return `${pct(x.propensity)}  (${pct(x.ci_low, 0)}–${pct(x.ci_high, 0)})`
                  })} />
              ))}
              {m.drex.lift.map((l, i) => (
                <Row key={l.variant_id} label={`Lift ${l.variant_id} vs ${l.control}`}
                  vals={MODELS.map((k) => {
                    const x = m[k].lift[i]
                    return `${pts(x.abs_lift)}  [${pts(x.ci_low)}, ${pts(x.ci_high)}] · P(better) ${pct(x.prob_better, 0)}`
                  })} />
              ))}
              <Row label="Median latency" vals={MODELS.map((k) => ms(m[k].latency_median_ms))} best="min"
                raw={MODELS.map((k) => m[k].latency_median_ms)} />
              <Row label="p95 latency" vals={MODELS.map((k) => ms(m[k].latency_p95_ms))} best="min"
                raw={MODELS.map((k) => m[k].latency_p95_ms)} />
              <Row label="Throughput" vals={MODELS.map((k) => `${m[k].throughput_per_s.toFixed(1)} decisions/s`)}
                best="max" raw={MODELS.map((k) => m[k].throughput_per_s)} />
              <Row label="Total time" vals={MODELS.map((k) => `${dur(m[k].wall_s)} for ${m[k].calls} calls`)} best="min"
                raw={MODELS.map((k) => m[k].wall_s)} />
              <Row label="Cost" vals={MODELS.map((k) => (m[k].cost_usd == null ? 'n/a' : `$${m[k].cost_usd!.toFixed(4)}`))} />
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Latency per decision" subtitle="Median, log scale · whisker = p95">
        <LatencyChart m={m} />
      </Panel>
    </>
  )
}

function sameWinner(m: Benchmark['metrics']) {
  const top = (x: BenchmarkModel) => [...x.summary].sort((a, b) => b.propensity - a.propensity)[0].variant_id
  return top(m.drex) === top(m.llm)
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="run-fact">
      <div className="muted small">{k}</div>
      <div className="fact-v">{v}</div>
    </div>
  )
}

function Row(props: { label: React.ReactNode; vals: string[]; best?: 'min' | 'max'; raw?: number[] }) {
  const bi = props.raw && props.best
    ? props.raw.indexOf(props.best === 'min' ? Math.min(...props.raw) : Math.max(...props.raw))
    : -1
  return (
    <tr>
      <th>{props.label}</th>
      {props.vals.map((v, i) => (
        <td key={i} className={i === bi ? 'best-cell' : ''}>{v}</td>
      ))}
    </tr>
  )
}

/* ---------- charts (plain SVG) ---------- */

/** Horizontal log-scale bars: median latency per model, p95 whisker, values in their own right-hand column. */
function LatencyChart({ m }: { m: Benchmark['metrics'] }) {
  const W = 1100
  const H = 130
  const L = 60 // model labels
  const R = 230 // value column
  const max = Math.max(2, Math.ceil(Math.log10(Math.max(m.drex.latency_p95_ms, m.llm.latency_p95_ms))))
  const min = 1 // 10 ms
  const x = (v: number) => L + ((Math.log10(Math.max(v, 10)) - min) / (max - min)) * (W - L - R)
  const ticks = Array.from({ length: max - min + 1 }, (_, i) => 10 ** (min + i))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={6} y2={H - 26} className="grid" />
          <text x={x(t)} y={H - 8} textAnchor="middle" className="tick">{ms(t)}</text>
        </g>
      ))}
      {MODELS.map((k, i) => {
        const y = 16 + i * 44
        return (
          <g key={k}>
            <text x={L - 10} y={y + 14} textAnchor="end" className="tick strong">{k === 'drex' ? 'Drex' : 'LLM'}</text>
            <rect x={x(10)} y={y} width={x(m[k].latency_median_ms) - x(10)} height={20} fill={COLOR[k]} rx={3} />
            <line x1={x(m[k].latency_p95_ms)} x2={x(m[k].latency_p95_ms)} y1={y - 3} y2={y + 23} className="whisker" />
            <text x={W - R + 16} y={y + 14} className="tick">
              <tspan className="strong">{ms(m[k].latency_median_ms)}</tspan> median · p95 {ms(m[k].latency_p95_ms)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
