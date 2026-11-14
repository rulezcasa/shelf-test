import { Fragment, useMemo, useState } from 'react'
import { type Product, type Run, type RunDecision, type RunPersona } from './api'
import { useLiveRun } from './LiveRun'
import MarketPanel from './MarketPanel'
import { Panel, VariantTag, label, pct } from './ui'

type View = 'overview' | 'segments' | 'personas' | 'competitors'

// Display order for segment groups (anything not listed sorts alphabetically).
const GROUP_ORDER: Record<string, string[]> = {
  age_band: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
  income_band: ['<35k', '35-75k', '75-150k', '150k+'],
  price_sensitivity: ['high', 'medium', 'low'],
  tech_savviness: ['low', 'medium', 'high'],
  location_type: ['urban', 'suburban', 'rural'],
}

// "<35k" -> "<$35k income", "35-75k" -> "$35–75k income" (annual household income, USD)
const income = (band: string | null) => (band ? `${band.replace(/(\d+)/, '$$$1').replace('-', '–')} income` : null)
const opt = (s: string | null | undefined) => (s ? label(s) : '—')

const pts = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)} pts`

/** Results of one test (panel run) for a product. */
export default function TestResults(props: {
  product: Product
  run: Run
  title: string
  date: string
  onBack: () => void
  onNewRun: (runId: string) => void
}) {
  const { product, run, title, date, onBack, onNewRun } = props
  const [view, setView] = useState<View>('overview')
  const live = useLiveRun(product, onNewRun, run.stats.market_context ?? true)

  if (!run.analysis) {
    return (
      <div className="empty-state">
        <h2>This test has no decisions</h2>
        <p className="muted">Every Drex call failed: {run.stats.failures[0]?.error ?? 'unknown error'}</p>
        <button className="btn" onClick={onBack}>← Tests</button>
      </div>
    )
  }

  const s = run.stats

  return (
    <div className="results">
      <button className="btn-link back" onClick={onBack}>← Tests</button>
      <div className="page-head">
        <div>
          <h1>
            {product.name} · {title}
          </h1>
          <p className="sub">
            {date && `${date} · `}
            {run.variants.length} variants · {run.personas.length} personas · {s.ok} decisions
            {s.failed > 0 && ` (${s.failed} failed)`}{' '}
            {s.market_context ? (
              <span className="badge market-on">with live market context</span>
            ) : (
              <span className="badge">no market context</span>
            )}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => exportCsv(product, run)}>Export CSV</button>
          <button className="btn" onClick={() => exportJson(product, run)}>Export JSON</button>
          <button
            className="btn btn-primary"
            disabled={!live.canStart}
            title={product.variants.length < 2 ? 'The product needs at least two variants' : undefined}
            onClick={live.start}
          >
            {live.running ? 'Running…' : 'Run again'}
          </button>
        </div>
      </div>
      {live.overlay}
      {live.error && <p className="error">{live.error}</p>}

      <div className="toolbar">
        <nav className="subtabs">
          {(['overview', 'segments', 'personas', 'competitors'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{label(v)}</button>
          ))}
        </nav>
        <span className="muted small toolbar-note">
          Buy ≥ {s.buy_threshold} · consider ≥ {s.consider_threshold} · otherwise reject
        </span>
      </div>

      {view === 'overview' && <Overview run={run} />}
      {view === 'segments' && <Segments run={run} />}
      {view === 'personas' && <Personas run={run} />}
      {view === 'competitors' && <MarketPanel product={product} />}
    </div>
  )
}

/* ---------------- export ---------------- */

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
const slug = (p: Product, r: Run) => `${p.name.replace(/[^\w-]+/g, '_')}-${r.id}`

function exportJson(p: Product, r: Run) {
  download(`${slug(p, r)}.json`, JSON.stringify(r, null, 2), 'application/json')
}

function exportCsv(p: Product, r: Run) {
  const cols = ['persona_id', 'variant_id', 'p_buy', 'buy_confidence', 'outcome', 'skip_reason', 'skip_reason_confidence', 'low_confidence'] as const
  const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const rows = r.decisions.map((d) => cols.map((c) => esc(d[c])).join(','))
  download(`${slug(p, r)}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv')
}

/* ---------------- Overview ---------------- */

function Overview({ run }: { run: Run }) {
  const a = run.analysis!
  const control = run.variants[0].variant_id
  const byId = Object.fromEntries(a.summary.map((x) => [x.variant_id, x]))
  const best = [...a.summary].sort((x, y) => y.propensity - x.propensity)[0]
  const bestLift = a.lift.find((l) => l.variant_id === best.variant_id)
  const topChallenger = [...a.lift].sort((x, y) => y.abs_lift - x.abs_lift)[0]

  return (
    <>
      <div className="callout">
        {best.variant_id !== control && bestLift ? (
          <>
            <strong>Variant {best.variant_id} is predicted to do better than control {control}</strong> by{' '}
            {pts(bestLift.abs_lift)} ({(bestLift.rel_lift * 100).toFixed(0)}% relative, 95% CI {pts(bestLift.ci_low)} to{' '}
            {pts(bestLift.ci_high)}), with a {pct(bestLift.prob_better, 0)} probability of being better.
          </>
        ) : topChallenger ? (
          <>
            <strong>Control {control} is predicted to do best.</strong> The closest challenger, {topChallenger.variant_id}, is{' '}
            {pts(topChallenger.abs_lift)} (95% CI {pts(topChallenger.ci_low)} to {pts(topChallenger.ci_high)}), with a{' '}
            {pct(topChallenger.prob_better, 0)} probability of being better.
          </>
        ) : null}
      </div>

      <div className="kpis">
        {run.variants.map((v) => {
          const x = byId[v.variant_id]
          if (!x) return null
          return (
            <div key={v.variant_id} className="kpi">
              <div className="kpi-k">
                <VariantTag id={v.variant_id} /> Purchase propensity {v.variant_id === control && <span className="badge">Control</span>}
              </div>
              <div className="kpi-v tabular">{pct(x.propensity)}</div>
              <div className="kpi-sub">95% CI {pct(x.ci_low)} – {pct(x.ci_high)}</div>
              <div className="kpi-sub">
                Buy {pct(x.buy_share, 0)} · consider {pct(x.consider_share, 0)} · reject {pct(x.reject_share, 0)}
              </div>
            </div>
          )
        })}
        {a.lift.map((l) => (
          <div key={l.variant_id} className="kpi">
            <div className="kpi-k">Lift, {l.variant_id} vs {l.control}</div>
            <div className={`kpi-v tabular ${l.abs_lift >= 0 ? 'pos' : 'neg'}`}>{pts(l.abs_lift)}</div>
            <div className="kpi-sub">95% CI {pts(l.ci_low)} to {pts(l.ci_high)}</div>
            <div className="kpi-sub">P({l.variant_id} better) {pct(l.prob_better, 0)} · paired bootstrap</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <Panel title="Why shoppers don't buy">
          <SkipReasons run={run} />
        </Panel>
        <Panel title="Propensity by price sensitivity">
          <SegmentBars run={run} dim="price_sensitivity" />
        </Panel>
      </div>
    </>
  )
}

/* ---------------- Segments ---------------- */

function segmentRows(run: Run, dim: string) {
  const rows = run.analysis!.segments.filter((x) => x.dimension === dim)
  const order = GROUP_ORDER[dim] ?? []
  const rank = (g: string) => (order.includes(g) ? order.indexOf(g) : order.length)
  const groups = [...new Set(rows.map((r) => r.segment))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  const get = (g: string, vid: string) => rows.find((r) => r.segment === g && r.variant_id === vid)
  return { groups, get }
}

function Segments({ run }: { run: Run }) {
  const dims = [...new Set(run.analysis!.segments.map((x) => x.dimension))]
  const [dim, setDim] = useState(dims[0])
  return (
    <Panel
      title="Propensity by segment"
      action={
        <select className="select" value={dim} onChange={(e) => setDim(e.target.value)}>
          {dims.map((d) => <option key={d} value={d}>{label(d)}</option>)}
        </select>
      }
    >
      <SegmentBars run={run} dim={dim} />
      <SegmentTable run={run} dim={dim} />
    </Panel>
  )
}

function Legend({ run }: { run: Run }) {
  return (
    <div className="legend">
      {run.variants.map((v) => <span key={v.variant_id}><i className={`swatch v${v.variant_id}`} />Variant {v.variant_id}</span>)}
    </div>
  )
}

function SegmentBars({ run, dim }: { run: Run; dim: string }) {
  const { groups, get } = segmentRows(run, dim)
  return (
    <div className="chart">
      <Legend run={run} />
      <div className="vchart">
        <div className="y-axis">{[100, 75, 50, 25, 0].map((t) => <span key={t}>{t}%</span>)}</div>
        <div className="plot">
          {[0, 25, 50, 75, 100].map((t) => <div key={t} className="gridline" style={{ bottom: `${t}%` }} />)}
          {groups.map((g) => (
            <div key={g} className="bar-group">
              <div className="bar-pair">
                {run.variants.map((v) => {
                  const r = get(g, v.variant_id)
                  const x = r?.propensity ?? 0
                  return <div key={v.variant_id} className={`bar v${v.variant_id}`} style={{ height: `${x * 100}%` }} title={`${label(g)} · ${v.variant_id}: ${pct(x)} (n=${r?.n ?? 0})`} />
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="x-axis">
        <span />
        {groups.map((g) => <span key={g}>{label(g)}</span>)}
      </div>
    </div>
  )
}

function SegmentTable({ run, dim }: { run: Run; dim: string }) {
  const { groups, get } = segmentRows(run, dim)
  const [control, ...others] = run.variants.map((v) => v.variant_id)
  return (
    <div className="table-wrap mt">
      <table className="data">
        <thead>
          <tr>
            <th>{label(dim)}</th>
            <th className="num">n</th>
            {run.variants.map((v) => <th key={v.variant_id} className="num">Variant {v.variant_id}</th>)}
            {others.map((o) => <th key={o} className="num">Lift {o} vs {control}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const c = get(g, control)?.propensity ?? 0
            return (
              <tr key={g}>
                <td>{label(g)}</td>
                <td className="num muted">{get(g, control)?.n ?? '—'}</td>
                {run.variants.map((v) => {
                  const r = get(g, v.variant_id)
                  return <td key={v.variant_id} className="num">{r ? pct(r.propensity) : '—'}</td>
                })}
                {others.map((o) => {
                  const d = (get(g, o)?.propensity ?? 0) - c
                  return <td key={o} className={`num ${d >= 0 ? 'pos' : 'neg'}`}>{pts(d)}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SkipReasons({ run }: { run: Run }) {
  const rows = run.analysis!.skip_reasons
  if (!rows.length) return <p className="muted">Every persona would buy every variant.</p>
  const total = (r: string) => rows.filter((x) => x.skip_reason === r).reduce((t, x) => t + x.share, 0)
  const reasons = [...new Set(rows.map((x) => x.skip_reason))].sort((a, b) => total(b) - total(a))
  const get = (vid: string, r: string) => rows.find((x) => x.variant_id === vid && x.skip_reason === r)?.share ?? 0
  const n = (vid: string) => rows.filter((x) => x.variant_id === vid).reduce((t, x) => t + x.count, 0)
  return (
    <div className="chart">
      <Legend run={run} />
      <div className="hchart">
        {reasons.map((r) => (
          <div key={r} className="hrow">
            <div className="hlabel">{label(r)}</div>
            <div className="hbars">
              {run.variants.map((v) => (
                <div key={v.variant_id} className="htrack">
                  <div className={`hbar v${v.variant_id}`} style={{ width: `${get(v.variant_id, r) * 100}%` }} />
                  <span className="hval tabular">{pct(get(v.variant_id, r), 0)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="muted small mt">Non-buyers: {run.variants.map((v) => `${v.variant_id} ${n(v.variant_id)}`).join(' · ')}</div>
    </div>
  )
}

/* ---------------- Personas ---------------- */

function Personas({ run }: { run: Run }) {
  const [onlyLow, setOnlyLow] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const vids = run.variants.map((v) => v.variant_id)

  const all = useMemo(() => {
    const ids = run.variants.map((v) => v.variant_id)
    const control = ids[0]
    return run.personas
        .map((p) => {
          const ds = Object.fromEntries(run.decisions.filter((d) => d.persona_id === p.id).map((d) => [d.variant_id, d])) as Record<string, RunDecision>
          // Largest change vs control across the other variants.
          const deltas = ids.slice(1).map((v) => (ds[v] && ds[control] ? ds[v].p_buy - ds[control].p_buy : 0))
          const delta = deltas.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0)
          return { p, ds, delta, low: Object.values(ds).some((d) => d.low_confidence) }
        })
        .filter((r) => Object.keys(r.ds).length > 0)
  }, [run])
  const rows = all
    .filter((r) => !onlyLow || r.low)
    .filter((r) => !query || `${r.p.id} ${r.p.label} ${r.p.shopping_style ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return (
    <Panel
      title="Persona decisions"
      flush
    >
      <div className="table-tools">
        <input className="search" placeholder="Search personas…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="switch">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          <span>Low confidence only</span>
        </label>
        <span className="muted small push">{rows.length} of {all.length}</span>
      </div>
      <div className="table-wrap">
        <table className="data persona-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Segment</th>
              {vids.map((v) => <th key={v} className="num">P(buy) {v}</th>)}
              <th className="num">Change</th>
              {vids.map((v) => <th key={v}>Outcome {v}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, ds, delta, low }) => (
              <Fragment key={p.id}>
                <tr className={`clickable ${open === p.id ? 'is-open' : ''}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <td className="wrap persona-cell">
                    <span className="chev">{open === p.id ? '▾' : '▸'}</span>
                    <span className="mono muted">{p.id}</span> {p.label}
                    {low && <span className="badge warn">Low confidence</span>}
                  </td>
                  <td className="wrap muted">{[p.shopping_style && label(p.shopping_style), income(p.income_band)].filter(Boolean).join(' · ') || '—'}</td>
                  {vids.map((v) => <td key={v} className="num">{ds[v] ? <Prob x={ds[v].p_buy} /> : '—'}</td>)}
                  <td className={`num ${delta >= 0 ? 'pos' : 'neg'}`}>{delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(2)}</td>
                  {vids.map((v) => <td key={v}>{ds[v] ? <Outcome d={ds[v]} /> : '—'}</td>)}
                </tr>
                {open === p.id && (
                  <tr className="detail">
                    <td colSpan={3 + vids.length * 2}>
                      <PersonaDetail p={p} ds={ds} vids={vids} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function PersonaDetail({ p, ds, vids }: { p: RunPersona; ds: Record<string, RunDecision>; vids: string[] }) {
  return (
    <div className="detail-grid" style={{ gridTemplateColumns: `1.3fr repeat(${vids.length}, 1fr)` }}>
      <div>
        <div className="detail-k">Profile</div>
        <p>{p.bio ?? <span className="muted">No bio.</span>}</p>
        <dl className="kv">
          <dt>Age</dt><dd>{p.age_band ?? '—'}</dd>
          <dt>Household income</dt><dd>{p.income_band ? `${income(p.income_band)!.replace(' income', '')} a year` : '—'}</dd>
          <dt>Household</dt><dd>{opt(p.household)}</dd>
          <dt>Price sensitivity</dt><dd>{opt(p.price_sensitivity)}</dd>
          <dt>Priorities</dt><dd>{p.priorities.length ? p.priorities.map(label).join(', ') : '—'}</dd>
          <dt>Dealbreakers</dt><dd>{p.dealbreakers.length ? p.dealbreakers.join(', ') : '—'}</dd>
        </dl>
      </div>
      {vids.map((v) =>
        ds[v] ? (
          <div key={v}>
            <div className="detail-k"><VariantTag id={v} /> Skip-reason probabilities</div>
            {Object.entries(ds[v].skip_reason_probs)
              .sort((a, b) => b[1] - a[1])
              .map(([k, x]) => (
                <div key={k} className="mini-row">
                  <span>{label(k)}</span>
                  <span className="mini-track"><span style={{ width: `${x * 100}%` }} /></span>
                  <span className="tabular muted">{x.toFixed(2)}</span>
                </div>
              ))}
            <div className="muted small mt">Buy confidence {ds[v].buy_confidence.toFixed(2)}</div>
          </div>
        ) : null,
      )}
    </div>
  )
}

function Prob({ x }: { x: number }) {
  return (
    <span className="prob">
      <span className="prob-track"><span style={{ width: `${x * 100}%` }} /></span>
      <span className="tabular">{x.toFixed(2)}</span>
    </span>
  )
}

function Outcome({ d }: { d: RunDecision }) {
  if (d.outcome === 'buy') return <span className="status buy">Buys</span>
  return (
    <span className={`status ${d.outcome === 'consider' ? 'consider' : 'skip'}`} title={`Top reason: ${label(d.skip_reason)}`}>
      {d.outcome === 'consider' ? 'Considers' : 'Rejects'} · {label(d.skip_reason)}
    </span>
  )
}
