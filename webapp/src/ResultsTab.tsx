import { Fragment, useMemo, useState } from 'react'
import { DECISIONS, GROUP_ORDER, PERSONAS, SEGMENT_DIMENSIONS, SKIP_REASONS, VARIANTS, type Decision, type Persona } from './mock'
import { Panel, VariantTag, label, mean, pct } from './ui'
import type { RunInfo } from './App'

type View = 'overview' | 'segments' | 'personas'
type Dim = (typeof SEGMENT_DIMENSIONS)[number]

const byVariant = (id: string) => DECISIONS.filter((d) => d.variant_id === id)

export default function ResultsTab({ run, onNewTest }: { run: RunInfo | null; onNewTest: () => void }) {
  const [view, setView] = useState<View>('overview')
  const [threshold, setThreshold] = useState(0.5)
  const [lowConf, setLowConf] = useState(0.6)

  if (!run) {
    return (
      <div className="empty-state">
        <div className="empty-icon">▤</div>
        <h2>No results yet</h2>
        <p className="muted">Upload variant documents and run the persona panel to see predicted conversion.</p>
        <button className="btn btn-primary" onClick={onNewTest}>Start a new test</button>
      </div>
    )
  }

  return (
    <div className="results">
      <div className="page-head">
        <div>
          <h1>{VARIANTS[0].product_name}</h1>
          <p className="sub">
            {VARIANTS.length} variants · {PERSONAS.length} personas · {run.decisions} decisions · {run.wallTime} wall time ·
            median latency {run.medianLatency} · {run.finishedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn">Export CSV</button>
          <button className="btn">Export JSON</button>
        </div>
      </div>

      <div className="toolbar">
        <nav className="subtabs">
          {(['overview', 'segments', 'personas'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{label(v)}</button>
          ))}
        </nav>
        <div className="toolbar-controls">
          <Range name="Buy threshold" value={threshold} min={0.3} max={0.8} onChange={setThreshold} />
          {view === 'personas' && <Range name="Low confidence" value={lowConf} min={0.3} max={0.9} onChange={setLowConf} />}
        </div>
      </div>

      {view === 'overview' && <Overview threshold={threshold} />}
      {view === 'segments' && <Segments />}
      {view === 'personas' && <Personas threshold={threshold} lowConf={lowConf} />}
    </div>
  )
}

function Range(p: { name: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="range">
      <span className="muted small">{p.name}</span>
      <input type="range" min={p.min} max={p.max} step={0.05} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <span className="tabular small range-v">{p.value.toFixed(2)}</span>
    </label>
  )
}

/* ---------------- Overview ---------------- */

function Overview({ threshold }: { threshold: number }) {
  const conv = Object.fromEntries(VARIANTS.map((v) => [v.variant_id, mean(byVariant(v.variant_id).map((d) => d.p_buy))]))
  const hard = Object.fromEntries(
    VARIANTS.map((v) => [v.variant_id, mean(byVariant(v.variant_id).map((d) => (d.p_buy >= threshold ? 1 : 0)))]),
  )
  const lift = conv.B - conv.A
  const winner = lift >= 0 ? 'B' : 'A'

  return (
    <>
      <div className="callout">
        <strong>Variant {winner} is predicted to convert better</strong> by {Math.abs(lift * 100).toFixed(1)} points
        ({Math.abs((lift / conv.A) * 100).toFixed(0)}% relative), with a 91% probability of being the better variant.
        Synthetic panels indicate direction, not exact real-world rates.
      </div>

      <div className="kpis">
        {VARIANTS.map((v) => (
          <div key={v.variant_id} className="kpi">
            <div className="kpi-k"><VariantTag id={v.variant_id} /> Expected conversion {v.variant_id === 'A' && <span className="badge">Control</span>}</div>
            <div className="kpi-v tabular">{pct(conv[v.variant_id])}</div>
            <div className="kpi-sub">95% CI {pct(conv[v.variant_id] - 0.06)} – {pct(conv[v.variant_id] + 0.06)}</div>
            <div className="kpi-sub">Would buy at ≥{threshold.toFixed(2)}: {pct(hard[v.variant_id], 0)}</div>
          </div>
        ))}
        <div className="kpi">
          <div className="kpi-k">Lift, B vs A</div>
          <div className={`kpi-v tabular ${lift >= 0 ? 'pos' : 'neg'}`}>{lift >= 0 ? '+' : '−'}{Math.abs(lift * 100).toFixed(1)} pts</div>
          <div className="kpi-sub">95% CI −0.4 to +6.6 pts</div>
          <div className="kpi-sub">{lift >= 0 ? '+' : '−'}{Math.abs((lift / conv.A) * 100).toFixed(0)}% relative</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">P(B better than A)</div>
          <div className="kpi-v tabular">91%</div>
          <div className="kpi-sub">Paired bootstrap, 1,000 draws</div>
          <div className="kpi-sub">&nbsp;</div>
        </div>
      </div>

      <div className="grid-2">
        <Panel title="Why shoppers skip" subtitle={`Top reason among personas below the ${threshold.toFixed(2)} buy threshold`}>
          <SkipReasons threshold={threshold} />
        </Panel>
        <Panel title="Conversion by price sensitivity" subtitle="Where each variant wins and loses">
          <SegmentBars dim="price_sensitivity" />
        </Panel>
      </div>
    </>
  )
}

/* ---------------- Segments ---------------- */

function Segments() {
  const [dim, setDim] = useState<Dim>('age_band')
  return (
    <Panel
      title="Conversion by segment"
      subtitle="Expected conversion per variant within each group"
      action={
        <select className="select" value={dim} onChange={(e) => setDim(e.target.value as Dim)}>
          {SEGMENT_DIMENSIONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
        </select>
      }
    >
      <SegmentBars dim={dim} />
      <SegmentTable dim={dim} />
    </Panel>
  )
}

function groupsFor(dim: keyof Persona) {
  const order = GROUP_ORDER[dim] ?? []
  const rank = (g: string) => (order.includes(g) ? order.indexOf(g) : order.length)
  return [...new Set(PERSONAS.map((p) => String(p[dim])))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
function segConv(dim: keyof Persona, g: string, vid: string) {
  const ids = new Set(PERSONAS.filter((p) => String(p[dim]) === g).map((p) => p.id))
  return { n: ids.size, conv: mean(DECISIONS.filter((d) => d.variant_id === vid && ids.has(d.persona_id)).map((d) => d.p_buy)) }
}

function Legend() {
  return (
    <div className="legend">
      {VARIANTS.map((v) => <span key={v.variant_id}><i className={`swatch v${v.variant_id}`} />Variant {v.variant_id}</span>)}
    </div>
  )
}

function SegmentBars({ dim }: { dim: keyof Persona }) {
  const groups = groupsFor(dim)
  return (
    <div className="chart">
      <Legend />
      <div className="vchart">
        <div className="y-axis">{[100, 75, 50, 25, 0].map((t) => <span key={t}>{t}%</span>)}</div>
        <div className="plot">
          {[0, 25, 50, 75, 100].map((t) => <div key={t} className="gridline" style={{ bottom: `${t}%` }} />)}
          {groups.map((g) => (
            <div key={g} className="bar-group">
              <div className="bar-pair">
                {VARIANTS.map((v) => {
                  const { conv, n } = segConv(dim, g, v.variant_id)
                  return <div key={v.variant_id} className={`bar v${v.variant_id}`} style={{ height: `${conv * 100}%` }} title={`${label(g)} · ${v.variant_id}: ${pct(conv)} (n=${n})`} />
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

function SegmentTable({ dim }: { dim: keyof Persona }) {
  return (
    <div className="table-wrap mt">
      <table className="data">
        <thead>
          <tr>
            <th>{label(String(dim))}</th>
            <th className="num">n</th>
            {VARIANTS.map((v) => <th key={v.variant_id} className="num">Variant {v.variant_id}</th>)}
            <th className="num">Lift B vs A</th>
          </tr>
        </thead>
        <tbody>
          {groupsFor(dim).map((g) => {
            const a = segConv(dim, g, 'A')
            const b = segConv(dim, g, 'B')
            const d = b.conv - a.conv
            return (
              <tr key={g}>
                <td>{label(g)}</td>
                <td className="num muted">{a.n}</td>
                <td className="num">{pct(a.conv)}</td>
                <td className="num">{pct(b.conv)}</td>
                <td className={`num ${d >= 0 ? 'pos' : 'neg'}`}>{d >= 0 ? '+' : '−'}{Math.abs(d * 100).toFixed(1)} pts</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SkipReasons({ threshold }: { threshold: number }) {
  const share = (vid: string) => {
    const s = DECISIONS.filter((d) => d.variant_id === vid && d.p_buy < threshold)
    return { n: s.length, by: Object.fromEntries(SKIP_REASONS.map((r) => [r, s.filter((d) => d.skip_reason === r).length / (s.length || 1)])) }
  }
  const s = Object.fromEntries(VARIANTS.map((v) => [v.variant_id, share(v.variant_id)]))
  return (
    <div className="chart">
      <Legend />
      <div className="hchart">
        {SKIP_REASONS.map((r) => (
          <div key={r} className="hrow">
            <div className="hlabel">{label(r)}</div>
            <div className="hbars">
              {VARIANTS.map((v) => (
                <div key={v.variant_id} className="htrack">
                  <div className={`hbar v${v.variant_id}`} style={{ width: `${s[v.variant_id].by[r] * 100}%` }} />
                  <span className="hval tabular">{pct(s[v.variant_id].by[r], 0)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="muted small mt">Skippers: {VARIANTS.map((v) => `${v.variant_id} ${s[v.variant_id].n}`).join(' · ')}</div>
    </div>
  )
}

/* ---------------- Personas ---------------- */

function Personas({ threshold, lowConf }: { threshold: number; lowConf: number }) {
  const [onlyLow, setOnlyLow] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      PERSONAS.map((p) => {
        const ds = Object.fromEntries(DECISIONS.filter((d) => d.persona_id === p.id).map((d) => [d.variant_id, d])) as Record<string, Decision>
        return { p, ds, delta: ds.B.p_buy - ds.A.p_buy, low: Object.values(ds).some((d) => d.buy_confidence < lowConf) }
      })
        .filter((r) => !onlyLow || r.low)
        .filter((r) => !query || `${r.p.id} ${r.p.label} ${r.p.shopping_style}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    [onlyLow, lowConf, query],
  )

  return (
    <Panel
      title="Persona decisions"
      subtitle="Sorted by largest change between variants. Click a row for the persona's profile and Drex probabilities."
      flush
    >
      <div className="table-tools">
        <input className="search" placeholder="Search personas…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="switch">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          <span>Low confidence only</span>
        </label>
        <span className="muted small push">{rows.length} of {PERSONAS.length}</span>
      </div>
      <div className="table-wrap tall">
        <table className="data">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Segment</th>
              <th className="num">P(buy) A</th>
              <th className="num">P(buy) B</th>
              <th className="num">Change</th>
              <th>Outcome A</th>
              <th>Outcome B</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, ds, delta, low }) => (
              <Fragment key={p.id}>
                <tr className={`clickable ${open === p.id ? 'is-open' : ''}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <td>
                    <span className="chev">{open === p.id ? '▾' : '▸'}</span>
                    <span className="mono muted">{p.id}</span> {p.label}
                    {low && <span className="badge warn">Low confidence</span>}
                  </td>
                  <td className="muted">{label(p.shopping_style)} · {p.income_band}</td>
                  <td className="num"><Prob x={ds.A.p_buy} /></td>
                  <td className="num"><Prob x={ds.B.p_buy} /></td>
                  <td className={`num ${delta >= 0 ? 'pos' : 'neg'}`}>{delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(2)}</td>
                  <td><Outcome d={ds.A} threshold={threshold} /></td>
                  <td><Outcome d={ds.B} threshold={threshold} /></td>
                </tr>
                {open === p.id && (
                  <tr className="detail">
                    <td colSpan={7}>
                      <div className="detail-grid">
                        <div>
                          <div className="detail-k">Profile</div>
                          <p>{p.bio}</p>
                          <dl className="kv">
                            <dt>Age</dt><dd>{p.age_band}</dd>
                            <dt>Income</dt><dd>{p.income_band}</dd>
                            <dt>Household</dt><dd>{label(p.household)}</dd>
                            <dt>Price sensitivity</dt><dd>{label(p.price_sensitivity)}</dd>
                          </dl>
                        </div>
                        {VARIANTS.map((v) => (
                          <div key={v.variant_id}>
                            <div className="detail-k"><VariantTag id={v.variant_id} /> Skip-reason probabilities</div>
                            {Object.entries(ds[v.variant_id].skip_reason_probs)
                              .sort((a, b) => b[1] - a[1])
                              .map(([k, x]) => (
                                <div key={k} className="mini-row">
                                  <span>{label(k)}</span>
                                  <span className="mini-track"><span style={{ width: `${x * 100}%` }} /></span>
                                  <span className="tabular muted">{x.toFixed(2)}</span>
                                </div>
                              ))}
                            <div className="muted small mt">Buy confidence {ds[v.variant_id].buy_confidence.toFixed(2)}</div>
                          </div>
                        ))}
                      </div>
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

function Prob({ x }: { x: number }) {
  return (
    <span className="prob">
      <span className="prob-track"><span style={{ width: `${x * 100}%` }} /></span>
      <span className="tabular">{x.toFixed(2)}</span>
    </span>
  )
}

function Outcome({ d, threshold }: { d: Decision; threshold: number }) {
  return d.p_buy >= threshold ? <span className="status buy">Buys</span> : <span className="status skip">{label(d.skip_reason)}</span>
}
