import { useEffect, useState } from 'react'
import { api, type Product, type Run, type RunListItem } from './api'
import { Panel, VariantTag, pct } from './ui'
import TestResults from './TestResults'

/** #/tests -> every test grouped by product; #/tests/<pid> -> one product's tests; #/tests/<pid>/<run> -> results. */
export default function TestsPage(props: { pid: string | null; runId: string | null; go: (hash: string) => void }) {
  const { pid, runId, go } = props
  if (pid && runId) return <TestDetail key={`${pid}/${runId}`} pid={pid} runId={runId} go={go} />
  return <TestIndex onlyPid={pid} go={go} />
}

type Group = { product: Product; runs: RunListItem[] }

/** Runs come newest first; tests are numbered per product in the order they ran (oldest = Test 1). */
const testNo = (runs: RunListItem[], i: number) => runs.length - i

const fmtDate = (r: { created_at: string | null; id: string }) => {
  const d = r.created_at ? new Date(r.created_at) : runIdDate(r.id)
  return d ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''
}
// Run ids are local timestamps: YYYYMMDD-HHMMSS
const runIdDate = (id: string) => {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

function TestIndex({ onlyPid, go }: { onlyPid: string | null; go: (hash: string) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const products = onlyPid ? [await api.getProduct(onlyPid)] : await api.listProducts()
      return Promise.all(products.map(async (product) => ({ product, runs: await api.listRuns(product.id) })))
    })()
      .then(setGroups)
      .catch((e) => setError(e.message))
  }, [onlyPid])

  const total = groups?.reduce((t, g) => t + g.runs.length, 0) ?? 0
  return (
    <div className="setup">
      {onlyPid && <button className="btn-link back" onClick={() => go('#/tests')}>← All tests</button>}
      <div className="page-head">
        <div>
          <h1>{onlyPid && groups?.[0] ? `Tests · ${groups[0].product.name}` : 'Tests'}</h1>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!groups && !error && <p className="muted">Loading tests…</p>}
      {groups && total === 0 && (
        <div className="empty-state">
          <div className="empty-icon">▤</div>
          <h2>No tests yet</h2>
          <button className="btn btn-primary" onClick={() => go(onlyPid ? `#/products/${onlyPid}` : '#/products')}>
            {onlyPid ? 'Open product' : 'Go to products'}
          </button>
        </div>
      )}

      {groups
        ?.filter((g) => g.runs.length > 0)
        .map(({ product, runs }) => (
          <Panel
            key={product.id}
            title={product.name}
            subtitle={`${runs.length} test${runs.length === 1 ? '' : 's'}`}
            action={<button className="btn-link" onClick={() => go(`#/products/${product.id}`)}>Open product</button>}
          >
            <ul className="doc-list test-list">
              {runs.map((r, i) => (
                <li key={r.id}>
                  <button className="row-btn" onClick={() => go(`#/tests/${product.id}/${r.id}`)}>
                    <span className="doc-name">Test {testNo(runs, i)}</span>
                    <span className="muted small">
                      {fmtDate(r)} · {r.personas} personas · {r.stats.ok} decisions
                      {r.stats.failed > 0 && ` · ${r.stats.failed} failed`}
                    </span>
                    <span className="test-props">
                      {Object.entries(r.propensity).map(([vid, x], _, all) => {
                        const best = Math.max(...all.map(([, y]) => y))
                        return (
                          <span key={vid} className={`test-prop ${x === best ? 'best' : ''}`}>
                            <VariantTag id={vid} /> {pct(x, 0)}
                          </span>
                        )
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
    </div>
  )
}

function TestDetail({ pid, runId, go }: { pid: string; runId: string; go: (hash: string) => void }) {
  const [product, setProduct] = useState<Product | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [no, setNo] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getProduct(pid), api.getRun(pid, runId), api.listRuns(pid)])
      .then(([p, r, runs]) => {
        setProduct(p)
        setRun(r)
        const i = runs.findIndex((x) => x.id === runId)
        setNo(i >= 0 ? testNo(runs, i) : null)
      })
      .catch((e) => setError(e.message))
  }, [pid, runId])

  if (error)
    return (
      <div className="setup">
        <button className="btn-link back" onClick={() => go('#/tests')}>← Tests</button>
        <p className="error">{error}</p>
      </div>
    )
  if (!product || !run) return <p className="muted">Loading results…</p>
  return (
    <TestResults
      product={product}
      run={run}
      title={no != null ? `Test ${no}` : 'Test'}
      date={fmtDate(run)}
      onBack={() => go('#/tests')}
      onNewRun={(runId) => go(`#/tests/${pid}/${runId}`)}
    />
  )
}
