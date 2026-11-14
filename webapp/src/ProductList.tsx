import { useEffect, useState } from 'react'
import { api, type Product } from './api'

/** Rows of products from the API. Used by the setup picker and the Results tab. */
export default function ProductList(props: { onOpen: (p: Product) => void; canDelete?: boolean; emptyText?: string }) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listProducts().then(setProducts).catch((e) => setError(e.message))
  }, [])

  async function remove(p: Product) {
    if (!confirm(`Delete "${p.name}" and its ${p.variants.length} variant(s)?`)) return
    try {
      await api.deleteProduct(p.id)
      setProducts((ps) => ps?.filter((x) => x.id !== p.id) ?? null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!products) return <p className="muted small">Loading products…</p>
  if (!products.length) return props.emptyText ? <p className="muted">{props.emptyText}</p> : null

  return (
    <ul className="doc-list">
      {products.map((p) => (
        <li key={p.id}>
          <button className="row-btn" onClick={() => props.onOpen(p)}>
            <span className="doc-name">{p.name}</span>
            <span className="muted small">
              {p.variants.length} variant{p.variants.length === 1 ? '' : 's'} · created{' '}
              {new Date(p.created_at).toLocaleDateString()}
            </span>
          </button>
          {props.canDelete && (
            <button className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
