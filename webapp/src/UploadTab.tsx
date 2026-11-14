import { useRef, useState } from 'react'
import { PERSONAS, VARIANTS, type Variant } from './mock'
import { Panel, VariantTag } from './ui'
import type { RunInfo } from './App'

type Doc = { id: string; name: string; size: string }
type Stage = 'documents' | 'extracted' | 'running'

const LETTERS = 'ABCDEFGH'

export default function UploadTab({ onRunComplete }: { onRunComplete: (r: RunInfo) => void }) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [stage, setStage] = useState<Stage>('documents')
  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const total = PERSONAS.length * VARIANTS.length
  const step = stage === 'documents' ? 1 : stage === 'extracted' ? 2 : 3

  function addFiles(files: FileList | null) {
    if (!files) return
    const next = [...docs, ...Array.from(files).map((f) => ({ id: '', name: f.name, size: `${Math.max(1, Math.round(f.size / 1024))} KB` }))]
    setDocs(next.slice(0, LETTERS.length).map((d, i) => ({ ...d, id: LETTERS[i] })))
    setStage('documents')
  }

  function extract() {
    setExtracting(true)
    setTimeout(() => {
      setExtracting(false)
      setStage('extracted')
    }, 900)
  }

  function runPanel() {
    setStage('running')
    setProgress(0)
    let done = 0
    const t = setInterval(() => {
      done = Math.min(total, done + 6)
      setProgress(done)
      if (done >= total) {
        clearInterval(t)
        setTimeout(
          () => onRunComplete({ finishedAt: new Date(), decisions: total, wallTime: '2.4 s', medianLatency: '152 ms' }),
          400,
        )
      }
    }, 35)
  }

  return (
    <div className="setup">
      <div className="page-head">
        <div>
          <h1>New test</h1>
          <p className="sub">Upload two or more variants of a product page. The first document is the control.</p>
        </div>
      </div>

      <ol className="stepper">
        {['Upload documents', 'Review extraction', 'Run panel'].map((s, i) => (
          <li key={s} className={step > i + 1 ? 'done' : step === i + 1 ? 'current' : ''}>
            <span className="step-num">{step > i + 1 ? '✓' : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {/* Step 1 */}
      <Panel
        title="Variant documents"
        subtitle="PDF spec sheets, landing pages or pricing sheets — one per variant."
        action={
          docs.length > 0 && (
            <button className="btn btn-link" onClick={() => { setDocs([]); setStage('documents') }}>
              Clear all
            </button>
          )
        }
      >
        <div
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
        >
          <input ref={fileRef} type="file" accept=".pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <div className="dz-icon">↑</div>
          <div><strong>Click to upload</strong> or drag and drop</div>
          <div className="muted small">PDF, up to 20 MB each</div>
        </div>

        {docs.length > 0 && (
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.id}>
                <VariantTag id={d.id} />
                <span className="doc-name">{d.name}</span>
                {d.id === 'A' && <span className="badge">Control</span>}
                <span className="muted small doc-size">{d.size}</span>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${d.name}`}
                  onClick={() => setDocs(docs.filter((x) => x.id !== d.id).map((x, i) => ({ ...x, id: LETTERS[i] })))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="panel-foot">
          <span className="muted small">
            {docs.length < 2 ? `Add at least ${2 - docs.length} more document${docs.length === 1 ? '' : 's'}.` : `${docs.length} variants ready.`}
          </span>
          <button className="btn btn-primary" disabled={docs.length < 2 || extracting} onClick={extract}>
            {extracting ? 'Extracting…' : stage === 'documents' ? 'Extract details' : 'Re-extract'}
          </button>
        </div>
      </Panel>

      {/* Step 2 */}
      {stage !== 'documents' && (
        <Panel title="Extracted details" subtitle="Fields extracted by NDI. Hover a marker to see the source passage.">
          <ComparisonTable variants={VARIANTS} />
        </Panel>
      )}

      {/* Step 3 */}
      {stage !== 'documents' && (
        <Panel title="Run panel" subtitle="Every synthetic shopper evaluates every variant.">
          <div className="run-grid">
            <div className="run-fact">
              <div className="muted small">Personas</div>
              <div className="fact-v">{PERSONAS.length}</div>
            </div>
            <div className="run-fact">
              <div className="muted small">Variants</div>
              <div className="fact-v">{VARIANTS.length}</div>
            </div>
            <div className="run-fact">
              <div className="muted small">Decisions</div>
              <div className="fact-v">{total}</div>
            </div>
            <div className="run-fact">
              <div className="muted small">Model</div>
              <div className="fact-v mono">drex-latest</div>
            </div>
          </div>


          {stage === 'running' && (
            <div className="run-progress">
              <div className="row">
                <span>{progress === total ? 'Complete' : 'Running decisions…'}</span>
                <span className="muted tabular">{progress} / {total}</span>
              </div>
              <div className="progress"><div style={{ width: `${(progress / total) * 100}%` }} /></div>
            </div>
          )}

          <div className="panel-foot">
            <span className="muted small">Cached decisions are reused; only new combinations call Drex.</span>
            <button className="btn btn-primary" disabled={stage === 'running'} onClick={runPanel}>
              {stage === 'running' ? 'Running…' : 'Run panel'}
            </button>
          </div>
        </Panel>
      )}
    </div>
  )
}

function ComparisonTable({ variants }: { variants: Variant[] }) {
  const rows: { name: string; key: string; render: (v: Variant) => React.ReactNode }[] = [
    { name: 'Product', key: 'product_name', render: (v) => v.product_name },
    { name: 'Price', key: 'price', render: (v) => <strong>${v.price}</strong> },
    { name: 'Pricing model', key: 'pricing_model', render: (v) => v.pricing_model },
    { name: 'Return policy', key: 'return_policy', render: (v) => v.return_policy },
    { name: 'Warranty', key: 'warranty', render: (v) => v.warranty },
    { name: 'Shipping', key: 'shipping', render: (v) => v.shipping },
    { name: 'Social proof', key: 'social_proof', render: (v) => v.social_proof },
    { name: 'Promotions', key: 'promotions', render: (v) => v.promotions ?? <span className="muted">—</span> },
    {
      name: 'Key features',
      key: 'key_features',
      render: (v) => <ul className="plain-list">{v.key_features.map((f) => <li key={f}>{f}</li>)}</ul>,
    },
  ]
  return (
    <div className="table-wrap">
      <table className="compare">
        <thead>
          <tr>
            <th>Field</th>
            {variants.map((v) => (
              <th key={v.variant_id}>
                <VariantTag id={v.variant_id} /> {v.source_file}
                {v.variant_id === 'A' && <span className="badge">Control</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.name}</th>
              {variants.map((v) => {
                const c = v.citations[r.key]
                return (
                  <td key={v.variant_id}>
                    {r.render(v)}
                    {c && (
                      <span className="cite" tabIndex={0}>
                        p.{c.page}
                        <span className="cite-pop">“{c.quote}”<br /><span className="muted">{v.source_file}, page {c.page}</span></span>
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
