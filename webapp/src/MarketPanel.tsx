import { useEffect, useState } from 'react'
import { marketApi, type MarketIntel, type Product } from './api'
import { Panel, VariantTag, label } from './ui'

const money = (x: number | null | undefined, c = 'USD') =>
  x == null ? '—' : `${c === 'USD' ? '$' : ''}${Math.round(x).toLocaleString()}${c !== 'USD' ? ` ${c}` : ''}`

const POS_CLASS: Record<string, string> = { 'below market': 'pos', 'above market': 'neg' }

/** Live market research for a product (Keenable web search + page retrieval, LLM synthesis). */
export default function MarketPanel({ product }: { product: Product }) {
  const [m, setM] = useState<MarketIntel | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)

  useEffect(() => {
    setLoaded(false)
    marketApi.getMarket(product.id).then(setM).catch(() => setM(null)).finally(() => setLoaded(true))
  }, [product.id])

  async function research() {
    setBusy(true)
    setError(null)
    try {
      setM(await marketApi.buildMarket(product.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const action = (
    <button className={`btn ${m ? '' : 'btn-primary'}`} disabled={busy || !product.variants.length} onClick={research}>
      {busy ? 'Researching…' : m ? 'Refresh' : 'Research market'}
    </button>
  )

  return (
    <Panel
      title="Market intelligence"
      subtitle="Live web research with Keenable: competitors, current prices, complaints, standard features and gaps. Drex sees this context when the panel runs."
      action={action}
    >
      {busy && (
        <div className="run-progress">
          <div className="row"><span>Searching the web and reading reviews… (~30–60 s)</span></div>
          <div className="progress indeterminate"><div /></div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {loaded && !m && !busy && <p className="muted">No research yet. Run it to ground the panel in today's market.</p>}
      {m && !busy && (
        <div className="market">
          <p className="market-summary">
            <span className="badge">{m.category}</span> {m.summary}
          </p>

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
