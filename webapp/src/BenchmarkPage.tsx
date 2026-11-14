import { useEffect, useState } from 'react'
import { benchApi as api, type Benchmark, type BenchmarkListItem, type BenchmarkModel } from './api'
import { Panel, VariantTag, label, pct } from './ui'

const MODELS = ['drex', 'llm'] as const
type M = (typeof MODELS)[number]
const COLOR: Record<M, string> = { drex: 'var(--bench-drex)', llm: 'var(--bench-llm)' }

const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`)

/** Drex vs LLM benchmark: route #/benchmark or #/benchmark/<id>. */
export default function BenchmarkPage({ id, go }: { id: string | null; go: (h: string) => void }) {
  const [list, setList] = useState<BenchmarkListItem[]>([])
  const [b, setB] = useState<Benchmark | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listBenchmarks().then(setList).catch(() => setList([]))
  }, [])
  useEffect(() => {
    setError(null)
    api.getBenchmark(id ?? 'latest').then(setB).catch((e) => {
      setB(null)
      setError((e as Error).message)
    })
  }, [id])

  if (error)
    return (
      <div className="empty-state">
        <h2>No benchmark yet</h2>
        <p className="muted">
          Run <code className="mono">python app/scripts/benchmark.py</code> to compare Drex with the LLM. ({error})
        </p>
      </div>
    )
  if (!b) return <div className="muted">Loading…</div>

  const m = b.metrics
  const name: Record<M, string> = { drex: `Drex · ${b.drex_model}`, llm: `LLM · ${b.llm_model.split('/').pop()}` }
  const nPersonas = new Set(b.points.map((p) => p.persona_id)).size
  const speedup = m.llm.latency_median_ms / m.drex.latency_median_ms

  return (
    <div className="results">
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
        <Fact k="P(buy) correlation" v={m.agreement.p_buy_pearson.toFixed(2)} />
        <Fact k="Same outcome" v={pct(m.agreement.outcome_agreement, 0)} />
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
              <Row label="Wall time" vals={MODELS.map((k) => `${m[k].wall_s.toFixed(1)} s for ${m[k].calls} calls`)} />
              <Row label="Failed calls" vals={MODELS.map((k) => String(m[k].failed))} />
              <Row label="Repeat std (lower = more consistent)"
                vals={MODELS.map((k) => (m[k].repeat_std == null ? 'n/a' : m[k].repeat_std!.toFixed(4)))}
                best="min" raw={MODELS.map((k) => m[k].repeat_std ?? Infinity)} />
              <Row label="Cost" vals={MODELS.map((k) => (m[k].cost_usd == null ? 'n/a' : `$${m[k].cost_usd!.toFixed(4)}`))} />
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="bench-grid">
        <Panel title="Mean P(buy) per variant" subtitle="Bars show the 95% bootstrap CI">
          <PropensityChart m={m} />
        </Panel>
        <Panel title="Latency per decision" subtitle="Median, log scale">
          <LatencyChart m={m} />
        </Panel>
        <Panel title="Per-persona agreement" subtitle={`Each dot is one persona × variant · r = ${m.agreement.p_buy_pearson.toFixed(2)}`}>
          <Scatter points={b.points} />
        </Panel>
        <Panel title="Skip reasons among non-buyers">
          <SkipReasons m={m} />
        </Panel>
        <Panel title="Mean P(buy) by price sensitivity">
          <SegmentChart points={b.points} variants={m.drex.summary.map((s) => s.variant_id)} />
        </Panel>
        <Panel title="Agreement">
          <table className="compare tabular">
            <tbody>
              <Row label="Pearson r (P(buy))" vals={[m.agreement.p_buy_pearson.toFixed(3)]} />
              <Row label="Spearman ρ" vals={[m.agreement.p_buy_spearman.toFixed(3)]} />
              <Row label="Mean |Δ P(buy)|" vals={[m.agreement.mean_abs_diff.toFixed(3)]} />
              <Row label="Same buy/consider/reject" vals={[pct(m.agreement.outcome_agreement)]} />
              <Row label="Same preferred variant" vals={[pct(m.agreement.preferred_variant_agreement)]} />
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
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

const W = 420
const H = 240
const PAD = { l: 40, r: 12, t: 12, b: 28 }
const iw = W - PAD.l - PAD.r
const ih = H - PAD.t - PAD.b
const yScale = (v: number) => PAD.t + ih * (1 - v)

function Axis01() {
  return (
    <g>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={yScale(t)} y2={yScale(t)} className="grid" />
          <text x={PAD.l - 6} y={yScale(t) + 4} textAnchor="end" className="tick">{Math.round(t * 100)}%</text>
        </g>
      ))}
    </g>
  )
}

function Legend() {
  return (
    <div className="chart-legend">
      {MODELS.map((k) => (
        <span key={k}><span className="legend-dot" style={{ background: COLOR[k] }} /> {k === 'drex' ? 'Drex' : 'LLM'}</span>
      ))}
    </div>
  )
}

function PropensityChart({ m }: { m: Benchmark['metrics'] }) {
  const vs = m.drex.summary.map((s) => s.variant_id)
  const gw = iw / vs.length
  const bw = Math.min(48, gw / 3)
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        <Axis01 />
        {vs.map((v, i) =>
          MODELS.map((k, j) => {
            const s = m[k].summary[i]
            const x = PAD.l + gw * i + gw / 2 + (j - 1) * bw + 2
            return (
              <g key={v + k}>
                <rect x={x} y={yScale(s.propensity)} width={bw - 4} height={ih - (yScale(s.propensity) - PAD.t)}
                  fill={COLOR[k]} rx={3}><title>{`${k} ${v}: ${pct(s.propensity)}`}</title></rect>
                <line x1={x + (bw - 4) / 2} x2={x + (bw - 4) / 2} y1={yScale(s.ci_low)} y2={yScale(s.ci_high)} className="whisker" />
                <text x={x + (bw - 4) / 2} y={yScale(s.ci_high) - 4} textAnchor="middle" className="tick">{pct(s.propensity, 0)}</text>
              </g>
            )
          }),
        )}
        {vs.map((v, i) => (
          <text key={v} x={PAD.l + gw * i + gw / 2} y={H - 8} textAnchor="middle" className="tick strong">Variant {v}</text>
        ))}
      </svg>
      <Legend />
    </>
  )
}

function LatencyChart({ m }: { m: Benchmark['metrics'] }) {
  const max = Math.log10(Math.max(m.drex.latency_p95_ms, m.llm.latency_p95_ms) * 1.5)
  const min = 1 // 10 ms
  const x = (v: number) => PAD.l + 50 + ((Math.log10(v) - min) / (max - min)) * (iw - 60)
  return (
    <svg viewBox={`0 0 ${W} 160`} className="chart">
      {[10, 100, 1000, 10000].filter((t) => Math.log10(t) <= max).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={10} y2={130} className="grid" />
          <text x={x(t)} y={148} textAnchor="middle" className="tick">{ms(t)}</text>
        </g>
      ))}
      {MODELS.map((k, i) => {
        const y = 30 + i * 55
        return (
          <g key={k}>
            <text x={PAD.l + 44} y={y + 14} textAnchor="end" className="tick strong">{k === 'drex' ? 'Drex' : 'LLM'}</text>
            <rect x={x(10)} y={y} width={x(m[k].latency_median_ms) - x(10)} height={22} fill={COLOR[k]} rx={3} />
            <line x1={x(m[k].latency_p95_ms)} x2={x(m[k].latency_p95_ms)} y1={y - 3} y2={y + 25} className="whisker" />
            <text x={x(m[k].latency_p95_ms) + 6} y={y + 15} className="tick">{ms(m[k].latency_median_ms)} (p95 {ms(m[k].latency_p95_ms)})</text>
          </g>
        )
      })}
    </svg>
  )
}

function Scatter({ points }: { points: Benchmark['points'] }) {
  const S = 260
  const p = 44
  const sc = (v: number) => p + v * (S - p - 8)
  return (
    <>
      <svg viewBox={`0 0 ${S} ${S}`} className="chart square">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={sc(t)} x2={sc(t)} y1={S - sc(0)} y2={S - sc(1)} className="grid" />
            <line x1={sc(0)} x2={sc(1)} y1={S - sc(t)} y2={S - sc(t)} className="grid" />
            <text x={sc(t)} y={S - 14} textAnchor="middle" className="tick">{t * 100}%</text>
            <text x={p - 4} y={S - sc(t) + 4} textAnchor="end" className="tick">{t * 100}%</text>
          </g>
        ))}
        <line x1={sc(0)} y1={S - sc(0)} x2={sc(1)} y2={S - sc(1)} className="diag" />
        {points.filter((q) => q.drex != null && q.llm != null).map((q) => (
          <circle key={q.persona_id + q.variant_id} cx={sc(q.drex!)} cy={S - sc(q.llm!)} r={3.5}
            className={`dot v${q.variant_id}`}>
            <title>{`${q.persona_id} · ${q.variant_id}: Drex ${pct(q.drex!)}, LLM ${pct(q.llm!)}`}</title>
          </circle>
        ))}
        <text x={S / 2} y={S - 1} textAnchor="middle" className="tick strong">Drex P(buy) →</text>
        <text x={8} y={S / 2} textAnchor="middle" className="tick strong" transform={`rotate(-90 8 ${S / 2})`}>LLM P(buy) →</text>
      </svg>
      <div className="chart-legend">
        {[...new Set(points.map((q) => q.variant_id))].map((v) => (
          <span key={v}><span className={`legend-dot dot v${v}`} /> Variant {v}</span>
        ))}
      </div>
    </>
  )
}

function SkipReasons({ m }: { m: Benchmark['metrics'] }) {
  const reasons = [...new Set(MODELS.flatMap((k) => Object.keys(m[k].skip_reasons)))].sort(
    (a, b) => (m.drex.skip_reasons[b] ?? 0) + (m.llm.skip_reasons[b] ?? 0) - (m.drex.skip_reasons[a] ?? 0) - (m.llm.skip_reasons[a] ?? 0),
  )
  return (
    <>
      <div className="hbars">
        {reasons.map((r) => (
          <div key={r} className="hbar-row">
            <div className="hbar-label">{label(r)}</div>
            <div className="hbar-tracks">
              {MODELS.map((k) => {
                const v = m[k].skip_reasons[r] ?? 0
                return (
                  <div key={k} className="hbar-track">
                    <div className="hbar" style={{ width: `${v * 100}%`, background: COLOR[k] }} />
                    <span className="small tabular">{pct(v, 0)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <Legend />
    </>
  )
}

function SegmentChart({ points, variants }: { points: Benchmark['points']; variants: string[] }) {
  const order = ['low', 'medium', 'high'].filter((s) => points.some((p) => p.price_sensitivity === s))
  const avg = (k: M, v: string, s: string) => {
    const xs = points.filter((p) => p.variant_id === v && p.price_sensitivity === s && p[k] != null).map((p) => p[k]!)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  }
  const x = (i: number) => PAD.l + 30 + (i * (iw - 60)) / Math.max(1, order.length - 1)
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        <Axis01 />
        {order.map((s, i) => (
          <text key={s} x={x(i)} y={H - 8} textAnchor="middle" className="tick strong">{label(s)}</text>
        ))}
        {MODELS.map((k) =>
          variants.map((v, vi) => {
            const ys = order.map((s) => yScale(avg(k, v, s)))
            return (
              <g key={k + v}>
                <polyline points={ys.map((y, i) => `${x(i)},${y}`).join(' ')} fill="none" stroke={COLOR[k]}
                  strokeWidth={2} strokeDasharray={vi ? '5 4' : undefined} />
                {ys.map((y, i) => (
                  <circle key={i} cx={x(i)} cy={y} r={3.5} fill={COLOR[k]}>
                    <title>{`${k} · ${v} · ${order[i]}: ${pct(avg(k, v, order[i]))}`}</title>
                  </circle>
                ))}
              </g>
            )
          }),
        )}
      </svg>
      <div className="chart-legend">
        {MODELS.map((k) => (
          <span key={k}><span className="legend-dot" style={{ background: COLOR[k] }} /> {k === 'drex' ? 'Drex' : 'LLM'}</span>
        ))}
        {variants.map((v, i) => <span key={v} className="muted">{i ? '- - -' : '———'} Variant {v}</span>)}
      </div>
    </>
  )
}
