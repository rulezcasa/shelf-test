import { useEffect, useMemo, useRef, useState } from 'react'
import { api, scenarioApi, type MarketSource, type Product, type Scenario, type ScenarioResult } from './api'
import { Panel, VariantTag, label } from './ui'

const DEFAULT: Scenario = {
  competitor_price_pct: 0,
  competitor_free_shipping: false,
  own_price_pct: 0,
  target_variant: null,
  new_feature: null,
  poor_reviews_competitor: null,
  pain_point: null,
}
const GROUPS = ['shopping_style', 'price_sensitivity', 'age_band', 'income_band', 'household']
const PALETTE = ['#2a6fdb', '#e07a1f', '#13897f', '#b42318', '#6941c6', '#c4a000', '#0e7490', '#9e1068']
const WALK = 'none'

/** Scenario lab: route #/scenarios or #/scenarios/<pid>. */
export default function ScenarioPage({ pid, go }: { pid: string | null; go: (h: string) => void }) {
  if (!pid) return <ProductChooser go={go} />
  return <Lab pid={pid} go={go} />
}

function ProductChooser({ go }: { go: (h: string) => void }) {
  const [products, setProducts] = useState<Product[] | null>(null)
  useEffect(() => {
    api.listProducts().then(setProducts).catch(() => setProducts([]))
  }, [])
  const ok = (products ?? []).filter((p) => p.variants.length > 1)
  return (
    <div className="setup">
      <div className="page-head">
        <div>
          <h1>Scenario lab</h1>
          <p className="sub">Change the market and your product, and watch the synthetic panel react through Drex.</p>
        </div>
      </div>
      <Panel title="Choose a product" subtitle="Needs 2+ variants and Keenable market research (Products → Market intelligence).">
        {products == null ? (
          <p className="muted">Loading…</p>
        ) : ok.length ? (
          <ul className="doc-list">
            {ok.map((p) => (
              <li key={p.id}>
                <button className="row-btn" onClick={() => go(`#/scenarios/${p.id}`)}>
                  <span className="doc-name">{p.name}</span>
                  <span className="muted small">{p.variants.length} variants</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No product with two variants yet.</p>
        )}
      </Panel>
    </div>
  )
}

function Lab({ pid, go }: { pid: string; go: (h: string) => void }) {
  const [product, setProduct] = useState<Product | null>(null)
  const [sc, setSc] = useState<Scenario>(DEFAULT)
  const [groupBy, setGroupBy] = useState('shopping_style')
  const [res, setRes] = useState<ScenarioResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  useEffect(() => {
    api.getProduct(pid).then((p) => {
      setProduct(p)
      setSc((s) => ({ ...s, target_variant: s.target_variant ?? p.variants[p.variants.length - 1]?.variant_id ?? null }))
    }).catch((e) => setError(e.message))
  }, [pid])

  // Debounced re-run whenever the scenario changes.
  useEffect(() => {
    if (!sc.target_variant) return
    const id = ++reqId.current
    const t = setTimeout(async () => {
      setBusy(true)
      setError(null)
      try {
        const r = await scenarioApi.run(pid, sc, groupBy)
        if (id === reqId.current) setRes(r)
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message)
      } finally {
        if (id === reqId.current) setBusy(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [pid, sc, groupBy])

  const set = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setSc((s) => ({ ...s, [k]: v }))

  if (error && !res)
    return (
      <div className="setup">
        <button className="btn-link back" onClick={() => go('#/scenarios')}>← Scenario lab</button>
        <p className="error">{error}</p>
        {error.includes('research') && (
          <button className="btn" onClick={() => go(`#/products/${pid}`)}>Open product to research the market</button>
        )}
      </div>
    )
  if (!product || !res) return <p className="muted">Running today's market through Drex…</p>

  const m = res.market
  const target = sc.target_variant ?? ''
  const targetVar = res.variants.find((v) => v.variant_id === target)
  const featureOptions = [...new Set([...m.common_features])]
  const painOptions = [...new Set([...m.complaints, ...m.gaps])]

  return (
    <div className="results">
      <button className="btn-link back" onClick={() => go('#/scenarios')}>← Scenario lab</button>
      <div className="page-head">
        <div>
          <h1>{product.name}</h1>
          <p className="sub">What if the market changes? {res.personas.length} synthetic shoppers re-decide through Drex.</p>
        </div>
        <div className="head-actions">
          {busy && <span className="spinner" aria-label="updating" />}
          <button className="btn-link" onClick={() => setSc({ ...DEFAULT, target_variant: sc.target_variant })}>Reset</button>
        </div>
      </div>

      <div className="lab">
        <div className="lab-controls panel">
          <div className="lab-section">Market</div>
          <Control title="Competitor prices" value={pctLabel(sc.competitor_price_pct)} sources={m.sources.prices ?? m.sources.competitors}>
            <input type="range" min={-30} max={30} step={5} value={sc.competitor_price_pct}
              onChange={(e) => set('competitor_price_pct', Number(e.target.value))} />
          </Control>
          <Control title="Free shipping at competitors" sources={m.sources.prices ?? m.sources.competitors}
            inline={<Toggle on={sc.competitor_free_shipping} onChange={(v) => set('competitor_free_shipping', v)} />} />
          <Control title="Competitor gets poor reviews" sources={m.sources.complaints}>
            <select className="input" value={sc.poor_reviews_competitor ?? ''}
              onChange={(e) => set('poor_reviews_competitor', e.target.value || null)}>
              <option value="">None</option>
              {m.competitors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </Control>
          <Control title="New pain point" sources={m.sources.gaps ?? m.sources.complaints}>
            <select className="input" value={sc.pain_point ?? ''} onChange={(e) => set('pain_point', e.target.value || null)}>
              <option value="">None</option>
              {painOptions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Control>

          <div className="lab-section">
            Your product
            <select className="input select-sm" value={target} onChange={(e) => set('target_variant', e.target.value)}>
              {product.variants.map((v) => <option key={v.variant_id} value={v.variant_id}>Variant {v.variant_id}</option>)}
            </select>
          </div>
          <Control title="Price" sources={m.sources.prices}
            value={sc.own_price_pct ? `${pctLabel(sc.own_price_pct)} · ${money(targetVar?.price)}` : money(targetVar?.price)}>
            <input type="range" min={-30} max={50} step={5} value={sc.own_price_pct}
              onChange={(e) => set('own_price_pct', Number(e.target.value))} />
          </Control>
          <Control title="Add a feature" sources={m.sources.features}>
            <select className="input" value={sc.new_feature ?? ''} onChange={(e) => set('new_feature', e.target.value || null)}>
              <option value="">None</option>
              {featureOptions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Control>
        </div>

        <div className="lab-dash">
          <div className="lab-cards">
            {res.variants.map((v) => (
              <VariantCard key={v.variant_id} res={res} vid={v.variant_id} />
            ))}
          </div>
          <div className="panel flow-panel">
            <div className="flow-top">
              <span className="control-title">Where shoppers go</span>
              <select className="input select-sm" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                {GROUPS.map((g) => <option key={g} value={g}>{label(g)}</option>)}
              </select>
            </div>
            <FlowBoard res={res} />
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/* ---------------- pieces ---------------- */

const money = (x: number | null | undefined) => (x == null ? '—' : `$${Math.round(x).toLocaleString()}`)
const pctLabel = (x: number) => (x === 0 ? 'No change' : `${x > 0 ? '+' : ''}${x}%`)

function Control(props: { title: string; value?: string; sources?: MarketSource[]; inline?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="control">
      <div className="control-head">
        <span className="control-title">
          {props.title}
          {props.sources && props.sources.length > 0 && (
            <span className="src-dot" tabIndex={0} aria-label="Keenable sources">
              i
              <span className="src-pop">
                <span className="src-pop-h">Keenable sources</span>
                {props.sources.slice(0, 4).map((s) => (
                  <a key={s.id} href={s.url} target="_blank" rel="noreferrer">{host(s.url)} · {s.title}</a>
                ))}
              </span>
            </span>
          )}
        </span>
        {props.value && <span className="control-value tabular">{props.value}</span>}
        {props.inline}
      </div>
      {props.children}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

/** Smoothly tweens a number toward its target. */
function useTween(target: number, ms = 700) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      const x = a + (target - a) * e
      setV(x)
      from.current = x
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function VariantCard({ res, vid }: { res: ScenarioResult; vid: string }) {
  const c = useTween(res.current.conversion[vid] ?? 0)
  const pick = useTween(res.current.pick_share[vid] ?? 0)
  const d = (res.current.conversion[vid] ?? 0) - (res.baseline.conversion[vid] ?? 0)
  const v = res.variants.find((x) => x.variant_id === vid)
  const best = res.current.recommended === vid
  const flipped = best && res.baseline.recommended !== vid
  return (
    <div className={`lab-card ${best ? 'best' : ''}`}>
      <div className="lab-card-head">
        <VariantTag id={vid} /> <span className="doc-name">{v?.name}</span>
        {best && <span key={String(flipped)} className={`rec-pill ${flipped ? 'flip' : ''}`}>{flipped ? 'New winner' : 'Recommended'}</span>}
      </div>
      <div className="lab-big tabular">{(c * 100).toFixed(1)}<span className="lab-unit">%</span></div>
      <div className="lab-meta">
        <span className={`tabular ${d > 0.0005 ? 'pos' : d < -0.0005 ? 'neg' : 'muted'}`}>
          {Math.abs(d) < 0.0005 ? 'No change' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(1)} pts`}
        </span>
        <span className="muted">{money(v?.price)}</span>
      </div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${pick * 100}%` }} /></div>
      <div className="small muted">{Math.round(pick * 100)}% of shoppers pick it</div>
    </div>
  )
}

const DOT = 14
const GAP = 4

function FlowBoard({ res }: { res: ScenarioResult }) {
  const cols = [...res.variants.map((v) => v.variant_id), WALK]
  const groups = useMemo(() => [...new Set(res.personas.map((p) => p.group))].sort(), [res.personas])
  const color = (g: string) => PALETTE[groups.indexOf(g) % PALETTE.length]
  const boardRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const colW = w / cols.length
  const perRow = Math.max(1, Math.floor((colW - 16) / (DOT + GAP)))
  // Stable order inside a column: by group, then id, so dots of a group cluster together.
  const placed: Record<string, { x: number; y: number }> = {}
  let maxRows = 1
  cols.forEach((c, ci) => {
    const members = res.personas
      .filter((p) => (res.current.picks[p.id] ?? WALK) === c)
      .sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id))
    const rowW = Math.min(members.length, perRow) * (DOT + GAP)
    members.forEach((p, i) => {
      const r = Math.floor(i / perRow)
      maxRows = Math.max(maxRows, r + 1)
      placed[p.id] = { x: ci * colW + (colW - rowW) / 2 + (i % perRow) * (DOT + GAP), y: 30 + r * (DOT + GAP) }
    })
  })
  const h = 40 + maxRows * (DOT + GAP)

  return (
    <div>
      <div ref={boardRef} className="flow-board" style={{ height: h }}>
        {cols.map((c, ci) => (
          <div key={c} className="flow-col" style={{ left: ci * colW, width: colW }}>
            <div className="flow-col-head">
              {c === WALK ? <span className="muted">Walk away</span> : <><VariantTag id={c} /> Variant {c}</>}
              <span className="muted small tabular"> · {Math.round((res.current.pick_share[c] ?? 0) * 100)}%</span>
            </div>
          </div>
        ))}
        {res.personas.map((p) => {
          const pos = placed[p.id]
          if (!pos) return null
          const moved = (res.baseline.picks[p.id] ?? WALK) !== (res.current.picks[p.id] ?? WALK)
          return (
            <div key={p.id} className={`flow-dot ${moved ? 'moved' : ''}`}
              style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, background: color(p.group) }}
              title={`${p.label} — picks ${res.current.picks[p.id] === WALK ? 'nothing' : res.current.picks[p.id]}${moved ? ` (was ${res.baseline.picks[p.id] === WALK ? 'nothing' : res.baseline.picks[p.id]})` : ''}`} />
          )
        })}
      </div>
      <div className="chart-legend">
        {groups.map((g) => (
          <span key={g}><span className="legend-dot" style={{ background: color(g) }} /> {label(g)}</span>
        ))}
        <span className="muted"><span className="legend-dot ring" /> moved vs today</span>
      </div>
    </div>
  )
}
