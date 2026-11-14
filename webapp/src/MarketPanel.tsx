import { useEffect, useState } from 'react'
import { marketApi, type MarketIntel, type MarketJob, type Product } from './api'
import { Panel, VariantTag, label } from './ui'

const money = (x: number | null | undefined, c = 'USD') =>
  x == null ? '—' : `${c === 'USD' ? '$' : ''}${Math.round(x).toLocaleString()}${c !== 'USD' ? ` ${c}` : ''}`

const POS_CLASS: Record<string, string> = { 'below market': 'pos', 'above market': 'neg' }

const STEP_LABEL: Record<string, string> = {
  plan: 'Planning searches',
  search: 'Searching the web',
  read: 'Reading reviews',
  analyze: 'Analyzing competitors',
}

/** Live market research for a product (Keenable web search + page retrieval, LLM synthesis).
 *  Research starts automatically with each test run; while it runs this shows its progress. */
export default function MarketPanel({ product }: { product: Product }) {
  const [m, setM] = useState<MarketIntel | null>(null)
  const [job, setJob] = useState<MarketJob | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showSources, setShowSources] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const loadMarket = () => marketApi.getMarket(product.id).then((x) => alive && setM(x)).catch(() => alive && setM(null))
    const poll = async () => {
      const j = await marketApi.getStatus(product.id).catch(() => null)
      if (!alive) return
      setJob(j)
      if (j?.status === 'running') timer = window.setTimeout(poll, 2000)
      else await loadMarket()
      if (alive) setLoaded(true)
    }
    setLoaded(false)
    loadMarket().then(poll)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [product.id])

  const busy = job?.status === 'running'
  const stepIdx = busy && job?.step ? job.steps.indexOf(job.step) : -1

  return (
    <Panel title="Market intelligence">
      {busy && job && (
        <div className="market-progress">
          <div className="analyze-steps">
            {job.steps.map((st, i) => (
              <span key={st} className={`astep ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}`}>
                <span className="astep-dot">{i < stepIdx ? '✓' : i + 1}</span>
                {STEP_LABEL[st] ?? label(st)}
              </span>
            ))}
          </div>
          <div className="progress indeterminate"><div /></div>
        </div>
      )}
      {job?.status === 'error' && <p className="error">Market research failed: {job.error}</p>}
      {loaded && !m && !busy && job?.status !== 'error' && (
        <p className="muted">No research yet. It runs automatically the next time you run a test.</p>
      )}
      {m && (
        <div className="market">
          <div className="run-grid">
            <div className="run-fact"><div className="muted small">Market low</div><div className="fact-v">{money(m.price_range.low, m.price_range.currency)}</div></div>
            <div className="run-fact"><div className="muted small">Median</div><div className="fact-v">{money(m.price_range.median, m.price_range.currency)}</div></div>
            <div className="run-fact"><div className="muted small">High</div><div className="fact-v">{money(m.price_range.high, m.price_range.currency)}</div></div>
            <div className="run-fact"><div className="muted small">Sources</div><div className="fact-v">{m.sources.length} <span className="muted small">· {m.requests_used} requests</span></div></div>
          </div>

          <h3 className="market-h">How each variant compares</h3>
          <div className="table-wrap">
            <table className="compare">
              <thead>
                <tr>
                  <th>Variant</th><th>Price</th><th>Missing vs market</th><th>Advantages</th><th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {m.positions.map((p) => (
                  <tr key={p.variant_id}>
                    <td><VariantTag id={p.variant_id} /></td>
                    <td className={POS_CLASS[p.price_position] ?? ''}>
                      {label(p.price_position)}
                      {p.price_percentile != null && <div className="muted small">{Math.round(p.price_percentile * 100)}th pct</div>}
                    </td>
                    <td>{p.missing_common_features.length ? p.missing_common_features.join(', ') : <span className="muted">—</span>}</td>
                    <td>{p.advantages.join(', ') || <span className="muted">—</span>}</td>
                    <td className="small">{p.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="market-grid">
            <div>
              <h3 className="market-h">Competitors</h3>
              <ul className="plain-list market-list">
                {m.competitors.map((c) => (
                  <li key={c.name}>
                    {c.source_url ? <a href={c.source_url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
                    <span className="tabular"> · {money(c.price, c.currency ?? 'USD')}</span>
                  </li>
                ))}
              </ul>
            </div>
            <List title="Customer complaints" items={m.complaints} />
            <List title="Standard features" items={m.common_features} />
            <List title="Common claims" items={m.common_claims} />
            <List title="Market gaps" items={m.gaps} />
          </div>

          <div className="panel-foot">
            <button className="btn-link" onClick={() => setShowSources(!showSources)}>
              {showSources ? 'Hide' : 'Show'} {m.sources.length} sources
            </button>
            <span className="muted small">Researched {new Date(m.created_at).toLocaleString()}</span>
          </div>
          {showSources && (
            <ol className="market-sources small">
              {m.sources.map((s) => (
                <li key={s.id}>
                  <span className="badge">{s.topic}</span>{' '}
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Panel>
  )
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="market-h">{title}</h3>
      {items.length ? (
        <ul className="plain-list market-list">{items.map((x) => <li key={x}>{x}</li>)}</ul>
      ) : (
        <p className="muted small">None found</p>
      )}
    </div>
  )
}
