import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, type Product, type RunPersona } from './api'
import RunGraph, { type LiveEdge } from './RunGraph'

/**
 * Run a test (persona panel through Drex) with the live graph shown as a full-screen overlay.
 * Render `overlay` anywhere; call `start()` to run. `onComplete(runId)` fires after the last edge lands.
 */
export function useLiveRun(product: Product, onComplete: (runId: string) => void, useMarket = true) {
  const [personas, setPersonas] = useState<RunPersona[] | null>(null)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edges, setEdges] = useState<LiveEdge[]>([])
  const [total, setTotal] = useState(0)
  const variants = product.variants.map((v) => v.variant_id)

  useEffect(() => {
    api.listPersonas().then(setPersonas).catch((e) => setError(e.message))
  }, [])

  async function start() {
    setRunning(true)
    setFinished(false)
    setError(null)
    setEdges([])
    setTotal(0)
    let seq = 0
    try {
      const runId = await api.streamRun(product.id, (ev) => {
        if (ev.type === 'start') setTotal(ev.total)
        if (ev.type === 'decision') {
          const e: LiveEdge = {
            seq: seq++,
            persona_id: ev.persona_id,
            variant_id: ev.variant_id,
            outcome: ev.outcome,
            skip_reason: ev.skip_reason,
            p_buy: ev.p_buy,
          }
          setEdges((x) => [...x, e])
        }
      }, useMarket)
      setFinished(true)
      setTimeout(() => {
        setRunning(false)
        onComplete(runId)
      }, 900) // let the last edges land
    } catch (e) {
      setError((e as Error).message)
      setRunning(false)
    }
  }

  const overlay: ReactNode =
    running && personas
      ? createPortal(
          <div className="run-overlay" role="dialog" aria-modal="true" aria-label={`Running test for ${product.name}`}>
            <div className="run-overlay-card">
              <div className="run-overlay-head">
                <div>
                  <h2>{finished ? 'Test complete' : 'Running test'}</h2>
                  <p className="sub">
                    {product.name} · {personas.length} personas × {variants.length} variants
                  </p>
                </div>
                {!finished && <span className="spinner" aria-hidden />}
              </div>
              <RunGraph
                personas={personas}
                variants={variants}
                edges={edges}
                total={total || personas.length * variants.length}
                finished={finished}
              />
            </div>
          </div>,
          document.body,
        )
      : null

  return { personas, running, error, start, overlay, canStart: !!personas && !running && variants.length > 1 }
}
