import type { ReactNode } from 'react'

export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
export const label = (s: string) => {
  const t = s.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function Panel(props: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={`panel ${props.flush ? 'flush' : ''}`}>
      {(props.title || props.action) && (
        <div className="panel-head">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.subtitle && <p className="sub">{props.subtitle}</p>}
          </div>
          {props.action}
        </div>
      )}
      <div className="panel-body">{props.children}</div>
    </section>
  )
}

export function VariantTag({ id }: { id: string }) {
  return <span className={`vtag v${id}`}>{id}</span>
}
