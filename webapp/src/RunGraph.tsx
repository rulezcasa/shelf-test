import { useMemo } from 'react'
import type { RunPersona } from './api'
import { VariantTag, label } from './ui'

export type Outcome = 'buy' | 'consider' | 'reject'
export type LiveEdge = { seq: number; persona_id: string; variant_id: string; outcome: Outcome; skip_reason: string; p_buy: number }

const W = 1000
const H = 520
const CX = W / 2
const CY = H / 2
const FRESH = 14 // newest edges drawn bright + animated

/**
 * Live view of a running test: variants in the middle, personas on a ring around them.
 * Every Drex decision draws an edge persona -> variant, coloured by outcome.
 */
export default function RunGraph(props: {
  personas: RunPersona[]
  variants: string[]
  edges: LiveEdge[]
  total: number
  finished: boolean
}) {
  const { personas, variants, edges, total, finished } = props

  const layout = useMemo(() => {
    const vpos = Object.fromEntries(
      variants.map((v, i) => [v, { x: CX + (i - (variants.length - 1) / 2) * 170, y: CY }]),
    )
    const ppos = Object.fromEntries(
      personas.map((p, i) => {
        const a = (i / personas.length) * Math.PI * 2 - Math.PI / 2
        return [p.id, { x: CX + Math.cos(a) * 450, y: CY + Math.sin(a) * 222, a }]
      }),
    )
    return { vpos, ppos }
  }, [personas, variants])

  // Latest outcome + edge seq per persona (seq re-keys the pulse so it replays).
  const last: Record<string, LiveEdge> = {}
  const tally: Record<string, Record<Outcome, number>> = Object.fromEntries(
    variants.map((v) => [v, { buy: 0, consider: 0, reject: 0 }]),
  )
  for (const e of edges) {
    last[e.persona_id] = e
    tally[e.variant_id][e.outcome]++
  }
  const freshFrom = edges.length - FRESH
  const byId = Object.fromEntries(personas.map((p) => [p.id, p]))
  const ticker = edges.slice(-6).reverse()
  const done = edges.length

  return (
    <div className={`run-live ${finished ? 'finished' : ''}`}>
      <svg className="run-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${done} of ${total} decisions`}>
        <defs>
          <radialGradient id="rg-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={CX} cy={CY} rx={330} ry={200} fill="url(#rg-core)" />
        <ellipse className="orbit" cx={CX} cy={CY} rx={450} ry={222} />

        {edges.map((e, i) => {
          const p = layout.ppos[e.persona_id]
          const v = layout.vpos[e.variant_id]
          if (!p || !v) return null
          const mx = (p.x + v.x) / 2
          const my = (p.y + v.y) / 2
          const qx = mx + (CX - mx) * 0.35
          const qy = my + (CY - my) * 0.35
          return (
            <path
              key={e.seq}
              className={`edge ${e.outcome} ${i >= freshFrom ? 'fresh' : ''}`}
              d={`M${p.x},${p.y} Q${qx},${qy} ${v.x},${v.y}`}
              pathLength={1}
            />
          )
        })}

        {personas.map((p) => {
          const pos = layout.ppos[p.id]
          const l = last[p.id]
          return (
            <g key={p.id} className={`pnode ${l ? l.outcome : 'pending'}`} transform={`translate(${pos.x},${pos.y})`}>
              <title>{`${p.id} · ${p.label}${l ? ` · last: ${l.variant_id} ${l.outcome}` : ''}`}</title>
              {l && <circle key={l.seq} className="pulse" r={7} />}
              <circle className="dot" r={6.5} />
            </g>
          )
        })}

        {variants.map((v) => {
          const pos = layout.vpos[v]
          const t = tally[v]
          const n = t.buy + t.consider + t.reject
          return (
            <g key={v} className={`vnode v${v}`} transform={`translate(${pos.x},${pos.y})`}>
              <circle className="halo" r={52} />
              <circle className="core" r={38} />
              <text className="vletter" dy="0.35em">{v}</text>
              <text className="vstat" y={76}>{n ? `${Math.round((t.buy / n) * 100)}% buy` : '—'}</text>
            </g>
          )
        })}
      </svg>

      <aside className="run-side">
        <div className="run-count">
          <span className="tabular">{done}</span>
          <span className="muted"> / {total} decisions</span>
        </div>
        <div className="progress">
          <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>

        <div className="run-tallies">
          {variants.map((v) => {
            const t = tally[v]
            const n = t.buy + t.consider + t.reject || 1
            return (
              <div key={v} className="run-tally">
                <VariantTag id={v} />
                <div className="stack" aria-label={`Variant ${v}: ${t.buy} buy, ${t.consider} consider, ${t.reject} reject`}>
                  <span className="buy" style={{ width: `${(t.buy / n) * 100}%` }} />
                  <span className="consider" style={{ width: `${(t.consider / n) * 100}%` }} />
                  <span className="reject" style={{ width: `${(t.reject / n) * 100}%` }} />
                </div>
                <span className="tabular small">{t.buy}·{t.consider}·{t.reject}</span>
              </div>
            )
          })}
          <div className="legend-row small muted">
            <span><i className="dotkey buy" />Buy</span>
            <span><i className="dotkey consider" />Consider</span>
            <span><i className="dotkey reject" />Reject</span>
          </div>
        </div>

        <ul className="ticker" aria-live="polite">
          {ticker.map((e) => (
            <li key={e.seq} className={e.outcome}>
              <span className="mono muted">{e.persona_id}</span>
              <span className="ticker-label">{byId[e.persona_id]?.label ?? ''}</span>
              <span className="ticker-out">
                <VariantTag id={e.variant_id} /> {e.outcome === 'buy' ? 'Buys' : `${e.outcome === 'consider' ? 'Considers' : 'Rejects'} · ${label(e.skip_reason)}`}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
