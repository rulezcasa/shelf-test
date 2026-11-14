import { useEffect, useRef, useState } from 'react'
import { api, type Attribute, type Product, type Variant } from './api'
import { useLiveRun } from './LiveRun'
import ProductList from './ProductList'
import { Panel, VariantTag, label } from './ui'

type Pending = { key: string; name: string; error?: string }

/** #/products -> list; #/products/<id> -> that product's variants, extracted fields, and run button. */
export default function ProductsPage({ pid, go }: { pid: string | null; go: (hash: string) => void }) {
  if (!pid) return <ProductIndex onOpen={(p) => go(`#/products/${p.id}`)} />
  return <ProductDetail key={pid} pid={pid} go={go} />
}

function ProductIndex({ onOpen }: { onOpen: (p: Product) => void }) {
  return (
    <div className="setup">
      <div className="page-head">
        <h1>Products</h1>
      </div>
      <ProductPicker onOpen={onOpen} />
    </div>
  )
}

function ProductDetail({ pid, go }: { pid: string; go: (hash: string) => void }) {
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getProduct(pid).then(setProduct).catch((e) => setError(e.message))
  }, [pid])

  if (error)
    return (
      <div className="setup">
        <button className="btn-link back" onClick={() => go('#/products')}>← Products</button>
        <p className="error">{error}</p>
      </div>
    )
  if (!product) return <p className="muted">Loading…</p>

  const n = product.variants.length
  return (
    <div className="setup">
      <button className="btn-link back" onClick={() => go('#/products')}>← Products</button>
      <div className="page-head">
        <div>
          <h1>{product.name}</h1>
        </div>
        <button className="btn" onClick={() => go(`#/tests/${product.id}`)}>View tests</button>
      </div>
      <VariantsPanel product={product} onChange={setProduct} />
      {n > 0 && <CompareEditor product={product} onChange={setProduct} />}
      {n > 1 && <RunPanel product={product} onRunComplete={(runId) => go(`#/tests/${product.id}/${runId}`)} />}
    </div>
  )
}

/* ---------------- step 1: product ---------------- */

function ProductPicker({ onOpen }: { onOpen: (p: Product) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      onOpen(await api.createProduct(name.trim()))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Panel title="New product">
      <form className="inline-form" onSubmit={create}>
        <input
          className="input"
          placeholder="Product name, e.g. Lumen Pro Earbuds"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New product name"
        />
        <button className="btn btn-primary" disabled={!name.trim() || busy}>
          {busy ? 'Creating…' : 'Create product'}
        </button>
      </form>
      {error && <p className="error mt">{error}</p>}

      <div className="muted small mt">All products</div>
      <ProductList onOpen={onOpen} canDelete emptyText="No products yet." />
    </Panel>
  )
}

/* ---------------- step 2a: upload ---------------- */

function VariantsPanel({ product, onChange }: { product: Product; onChange: (p: Product) => void }) {
  const [pending, setPending] = useState<Pending[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files)
    const items = list.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name }))
    setPending((p) => [...p, ...items])
    // One at a time, in order: each extraction reuses the attribute names of earlier variants.
    for (let i = 0; i < list.length; i++) {
      const key = items[i].key
      try {
        await api.uploadVariant(product.id, list[i])
        setPending((p) => p.filter((x) => x.key !== key))
        onChange(await api.getProduct(product.id))
      } catch (e) {
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x)))
      }
    }
  }

  return (
    <Panel title="Variant documents">
      <div
        className="dropzone"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="dz-icon">↑</div>
        <div>
          <strong>Click to upload</strong> or drag and drop
        </div>
      </div>

      {pending.length > 0 && (
        <ul className="doc-list">
          {pending.map((p) => (
            <li key={p.key}>
              {p.error ? <span className="vtag vErr">!</span> : <span className="spinner" aria-hidden />}
              <span className="doc-name">{p.name}</span>
              {p.error ? (
                <span className="error small doc-size" title={p.error}>
                  Extraction failed: {p.error.slice(0, 120)}
                </span>
              ) : (
                <span className="muted small doc-size">Extracting with NDI…</span>
              )}
              {p.error && (
                <button className="icon-btn" aria-label="Dismiss" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

    </Panel>
  )
}

/* ---------------- step 2b: compare + edit in place ---------------- */

const toEdit = (v: string) => v.split('; ').join('\n') // list values edit one item per line
const fromEdit = (v: string) =>
  v
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .join('; ')

function Editable(props: {
  value: string
  onSave: (v: string) => void
  display: React.ReactNode
  multiline?: boolean
  placeholder?: string
  label: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function start() {
    setDraft(props.multiline ? toEdit(props.value) : props.value)
    setEditing(true)
  }
  function commit() {
    setEditing(false)
    const next = props.multiline ? fromEdit(draft) : draft.trim()
    if (next !== props.value) props.onSave(next)
  }

  if (!editing)
    return (
      <div className="editable" role="button" tabIndex={0} title="Click to edit" aria-label={`Edit ${props.label}`}
        onClick={start} onKeyDown={(e) => e.key === 'Enter' && start()}>
        {props.display}
      </div>
    )
  const common = {
    className: 'input',
    autoFocus: true,
    value: draft,
    placeholder: props.placeholder,
    'aria-label': props.label,
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(false)
      if (e.key === 'Enter' && (!props.multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        commit()
      }
    },
  }
  return props.multiline ? (
    <div>
      <textarea {...common} rows={Math.min(8, Math.max(2, draft.split('\n').length + 1))} />
      <div className="muted small edit-hint">One item per line · ⌘↵ to save · Esc to cancel</div>
    </div>
  ) : (
    <input {...common} />
  )
}

function CompareEditor({ product, onChange }: { product: Product; onChange: (p: Product) => void }) {
  const [drafts, setDrafts] = useState<string[]>([]) // new rows that don't hold a value yet
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)

  const variants = product.variants
  const names = [...new Set([...variants.flatMap((v) => v.attributes.map((a) => a.name)), ...drafts])]

  async function save(changed: Variant[]) {
    if (!changed.length) return
    setSaving(true)
    setError(null)
    try {
      for (const v of changed)
        await api.updateVariant(product.id, v.variant_id, { product_name: v.product_name, attributes: v.attributes })
      setSavedOnce(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      onChange(await api.getProduct(product.id))
      setSaving(false)
    }
  }

  function setCell(v: Variant, name: string, value: string) {
    const has = v.attributes.some((a) => a.name === name)
    const attributes: Attribute[] = !value
      ? v.attributes.filter((a) => a.name !== name)
      : has
        ? v.attributes.map((a) => (a.name === name ? { ...a, value } : a))
        : [...v.attributes, { name, value }]
    save([{ ...v, attributes }])
  }

  function renameRow(from: string, to: string) {
    to = to.trim()
    if (!to || to === from) return
    const clash = variants.find((v) => v.attributes.some((a) => a.name === from) && v.attributes.some((a) => a.name === to))
    if (clash) return setError(`Variant ${clash.variant_id} already has a field named "${to}". Clear one of them first.`)
    setDrafts((d) => d.map((x) => (x === from ? to : x)))
    save(
      variants
        .filter((v) => v.attributes.some((a) => a.name === from))
        .map((v) => ({ ...v, attributes: v.attributes.map((a) => (a.name === from ? { ...a, name: to } : a)) })),
    )
  }

  function deleteRow(name: string) {
    if (!confirm(`Delete "${label(name)}" from all variants?`)) return
    setDrafts((d) => d.filter((x) => x !== name))
    save(
      variants
        .filter((v) => v.attributes.some((a) => a.name === name))
        .map((v) => ({ ...v, attributes: v.attributes.filter((a) => a.name !== name) })),
    )
  }

  async function removeVariant(v: Variant) {
    if (!confirm(`Remove variant ${v.variant_id} (${v.source_file})? Your edits to it will be lost.`)) return
    try {
      await api.deleteVariant(product.id, v.variant_id)
    } catch (e) {
      setError((e as Error).message)
    }
    onChange(await api.getProduct(product.id))
  }

  function addRow(e: React.FormEvent) {
    e.preventDefault()
    const n = newName.trim()
    if (!n) return
    if (names.includes(n)) return setError(`A field named "${n}" already exists.`)
    setDrafts((d) => [...d, n])
    setNewName('')
    setError(null)
  }

  return (
    <Panel
      title="Extracted details"
      action={
        <span className={error ? 'error small' : 'muted small'}>
          {saving ? 'Saving…' : error ?? (savedOnce ? 'All changes saved' : '')}
        </span>
      }
    >
      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th>Field</th>
              {variants.map((v, i) => (
                <th key={v.variant_id}>
                  <div className="col-head">
                    <VariantTag id={v.variant_id} />
                    <a href={api.fileUrl(product.id, v.variant_id)} target="_blank" rel="noreferrer" title="Open original PDF">
                      {v.source_file} ↗
                    </a>
                    {i === 0 && <span className="badge">Control</span>}
                    <button className="icon-btn push" aria-label={`Remove variant ${v.variant_id}`} title="Remove variant" onClick={() => removeVariant(v)}>
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Product</th>
              {variants.map((v) => (
                <td key={v.variant_id}>
                  <Editable
                    label={`product name of variant ${v.variant_id}`}
                    value={v.product_name ?? ''}
                    display={v.product_name ?? <span className="muted">—</span>}
                    onSave={(val) => save([{ ...v, product_name: val || null }])}
                  />
                </td>
              ))}
            </tr>
            {names.map((n) => (
              <tr key={n}>
                <th scope="row">
                  <div className="row-head">
                    <Editable label={`field name ${n}`} value={n} display={label(n)} onSave={(to) => renameRow(n, to)} />
                    <button className="icon-btn row-del" aria-label={`Delete ${n}`} title="Delete field from all variants" onClick={() => deleteRow(n)}>
                      ×
                    </button>
                  </div>
                </th>
                {variants.map((v) => {
                  const a = v.attributes.find((x) => x.name === n)
                  const parts = a ? a.value.split('; ') : []
                  return (
                    <td key={v.variant_id}>
                      <Editable
                        multiline
                        label={`${n} of variant ${v.variant_id}`}
                        value={a?.value ?? ''}
                        placeholder="Empty: not in this variant"
                        display={
                          !a ? (
                            <span className="muted">—</span>
                          ) : parts.length > 1 ? (
                            <ul className="plain-list">{parts.map((f, i) => <li key={i}>{f}</li>)}</ul>
                          ) : (
                            a.value
                          )
                        }
                        onSave={(val) => setCell(v, n, val)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="inline-form add-field" onSubmit={addRow}>
        <input className="input" placeholder="New field name, e.g. color_options" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New field name" />
        <button className="btn" disabled={!newName.trim()}>+ Add field</button>
      </form>
    </Panel>
  )
}

/* ---------------- step 3: run the panel through Drex ---------------- */

function RunPanel({ product, onRunComplete }: { product: Product; onRunComplete: (runId: string) => void }) {
  const [useMarket, setUseMarket] = useState(true)
  const { personas, running, error, start, overlay, canStart } = useLiveRun(product, onRunComplete, useMarket)
  const variants = product.variants.map((v) => v.variant_id)
  const planned = personas ? personas.length * variants.length : null

  return (
    <Panel title="Run a test">
      {overlay}
      <div className="run-grid">
        <div className="run-fact">
          <div className="muted small">Personas</div>
          <div className="fact-v">{personas?.length ?? '—'}</div>
        </div>
        <div className="run-fact">
          <div className="muted small">Variants</div>
          <div className="fact-v">{variants.length}</div>
        </div>
        <div className="run-fact">
          <div className="muted small">Decisions</div>
          <div className="fact-v">{planned ?? '—'}</div>
        </div>
        <div className="run-fact">
          <div className="muted small">Model</div>
          <div className="fact-v mono">drex-latest</div>
        </div>
      </div>
      {error && <p className="error mt">{error}</p>}
      <div className="panel-foot">
        <label className="switch small">
          <input type="checkbox" checked={useMarket} onChange={(e) => setUseMarket(e.target.checked)} />
          Give Drex the live market context (if researched)
        </label>
        <button className="btn btn-primary" disabled={!canStart} onClick={start}>
          {running ? 'Running…' : 'Run test'}
        </button>
      </div>
    </Panel>
  )
}
