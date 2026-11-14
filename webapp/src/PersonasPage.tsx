import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type AnalyzeEvent, type Persona } from './api'
import { label } from './ui'

const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.mp4,.mov,audio/*,video/mp4'
const income = (band: string) => band.replace(/(\d+)/, '$$$1').replace('-', '–')
const opt = (v: string | null | undefined, fmt: (s: string) => string = label) => (v ? fmt(v) : null)
const NotMentioned = () => <span className="not-mentioned">Not mentioned</span>

type Job = { kind: 'audio'; file: File } | { kind: 'text'; text: string; title?: string }

/** #/personas: the persona panel every test runs against; add personas from customer interviews. */
export default function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)

  const reload = () => api.listPersonas().then(setPersonas).catch((e) => setError(e.message))
  useEffect(() => {
    reload()
  }, [])

  async function remove(p: Persona) {
    if (!confirm(`Delete ${p.name ?? p.label}? It will no longer be part of new tests.`)) return
    try {
      await api.deletePersona(p.id)
      setPersonas((ps) => ps?.filter((x) => x.id !== p.id) ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const interviews = (personas ?? []).filter((p) => p.source === 'interview').length
  const shown = (personas ?? [])
    .filter(
      (p) =>
        !query ||
        `${p.id} ${p.label} ${p.name ?? ''} ${p.occupation ?? ''} ${p.shopping_style ?? ''} ${p.bio ?? ''} ${p.source === 'interview' ? 'interview' : ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    // newest interview personas first, then the generated panel
    .sort((a, b) => (a.source === 'interview' ? 0 : 1) - (b.source === 'interview' ? 0 : 1) || (a.source === 'interview' ? b.id.localeCompare(a.id) : 0))

  return (
    <div className="results">
      <div className="page-head">
        <div>
          <h1>Personas</h1>
          <p className="sub">
            {personas
              ? `${personas.length} shoppers${interviews ? ` · ${interviews} from interviews` : ''}`
              : 'Loading…'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + Add personas
        </button>
      </div>

      {adding && (
        <AddPersonasDialog
          onClose={() => setAdding(false)}
          onStart={(js) => {
            setAdding(false)
            setJobs(js)
          }}
        />
      )}
      {jobs && (
        <AnalyzeOverlay
          jobs={jobs}
          onSaved={(p) => {
            setFresh(p.id)
            reload()
          }}
          onClose={() => setJobs(null)}
        />
      )}

      {error && <p className="error">{error}</p>}

      {personas && (
        <>
          <div className="persona-tools">
            <input className="search" placeholder="Search personas…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="muted small push">{shown.length} of {personas.length}</span>
          </div>

          <div className="persona-grid">
            {shown.map((p) => {
              const isOpen = open === p.id
              const isInterview = p.source === 'interview'
              return (
                <article key={p.id} className={`persona-card ${isOpen ? 'open' : ''} ${isInterview ? 'interview' : ''} ${fresh === p.id ? 'fresh' : ''}`}>
                  <div className="persona-top">
                    <button className="persona-top-btn" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
                      <Avatar p={p} />
                      <span className="persona-title">
                        <span className="persona-name">{p.name ? `${p.name} · ` : ''}{p.label}</span>
                        <span className="mono muted">{p.id}{p.region ? ` · ${p.region}` : ''}</span>
                      </span>
                    </button>
                    {isInterview && (
                      <span className="interview-actions">
                        <span className="badge interview-badge">Interview</span>
                        <button className="icon-btn" aria-label={`Delete ${p.label}`} title="Delete persona" onClick={() => remove(p)}>×</button>
                      </span>
                    )}
                  </div>
                  <PersonaBody p={p} expanded={isOpen} />
                  <button className="btn-link small persona-more" onClick={() => setOpen(isOpen ? null : p.id)}>
                    {isOpen ? 'Show less' : 'Show more'}
                  </button>
                </article>
              )
            })}
          </div>
          {shown.length === 0 && <p className="muted">No personas match.</p>}
        </>
      )}
    </div>
  )
}

function Avatar({ p }: { p: Persona }) {
  const age = p.label.match(/^\d+/)?.[0] ?? p.age_band?.split('-')[0]
  return (
    <span className={`avatar ps-${p.price_sensitivity ?? 'none'}`} title={p.age_band ? `Age ${p.age_band}` : 'Age not mentioned'}>
      {age ?? (p.name ? p.name[0] : '?')}
    </span>
  )
}

function PersonaBody({ p, expanded }: { p: Persona; expanded: boolean }) {
  const isInterview = p.source === 'interview'
  return (
    <>
      <div className="chips">
        {p.shopping_style && <span className="chip">{label(p.shopping_style)}</span>}
        {p.income_band && <span className="chip">{income(p.income_band)} income</span>}
        {p.price_sensitivity && <span className={`chip ps ps-${p.price_sensitivity}`}>{label(p.price_sensitivity)} price sensitivity</span>}
      </div>
      <dl className="kv persona-kv">
        <dt>Cares about</dt>
        <dd>{p.priorities.length ? p.priorities.map(label).join(', ') : <NotMentioned />}</dd>
        <dt>Dealbreakers</dt>
        <dd>{p.dealbreakers.length ? p.dealbreakers.join(', ') : isInterview ? <NotMentioned /> : '—'}</dd>
      </dl>
      <p className={`persona-bio ${expanded ? '' : 'clamp'}`}>{p.bio ?? <NotMentioned />}</p>
      {expanded && (
        <dl className="kv persona-kv more">
          {detailRows(p).map(([k, v]) => (
            <KvRow key={k} k={k} v={v} />
          ))}
        </dl>
      )}
    </>
  )
}

const detailRows = (p: Persona): [string, string | null][] => [
  ['Age', opt(p.age_band, (s) => s)],
  ['Gender', opt(p.gender)],
  ['Occupation', opt(p.occupation, (s) => s)],
  ['Household', opt(p.household)],
  ['Location', [opt(p.location_type), p.region].filter(Boolean).join(', ') || null],
  ['Income', opt(p.income_band, income)],
  ['Tech savviness', opt(p.tech_savviness)],
]

function KvRow({ k, v }: { k: string; v: string | null }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v ?? <NotMentioned />}</dd>
    </>
  )
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

/* ---------------- add personas: upload audio or paste a transcript ---------------- */

function AddPersonasDialog(props: { onClose: () => void; onStart: (jobs: Job[]) => void }) {
  const [mode, setMode] = useState<'audio' | 'text'>('audio')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEscape(props.onClose)

  const pick = (files: FileList | null) => {
    if (files?.length) props.onStart(Array.from(files).map((file) => ({ kind: 'audio' as const, file })))
  }

  return createPortal(
    <div className="run-overlay" role="dialog" aria-modal="true" aria-label="Add personas" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="run-overlay-card add-card">
        <div className="run-overlay-head">
          <h2>Add personas</h2>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}>×</button>
        </div>

        <div className="seg-toggle" role="tablist">
          <button role="tab" aria-selected={mode === 'audio'} className={mode === 'audio' ? 'active' : ''} onClick={() => setMode('audio')}>Upload audio</button>
          <button role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>Paste transcript</button>
        </div>

        {mode === 'audio' ? (
          <div
            className={`dropzone big ${drag ? 'drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              pick(e.dataTransfer.files)
            }}
          >
            <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => pick(e.target.files)} />
            <div className="dz-icon">♪</div>
            <div><strong>Click to upload</strong> or drag and drop interview recordings</div>
          </div>
        ) : (
          <div className="paste-form">
            <label className="field">
              <span className="field-k">Title (optional)</span>
              <input className="input" placeholder="e.g. Interview 3, Jan 12" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-k">Transcript</span>
              <textarea
                className="input"
                rows={12}
                placeholder={'Interviewer: Could you tell me a bit about yourself?\nCustomer: Sure, I’m 42 and work as a nurse…'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="editor-foot">
              <span className="muted small">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ''}</span>
              <div className="head-actions">
                <button className="btn" onClick={props.onClose}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={text.trim().length < 40}
                  onClick={() => props.onStart([{ kind: 'text', text: text.trim(), title: title.trim() || undefined }])}
                >
                  Analyze transcript
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ---------------- analyze overlay: live NDI progress, then one Save ---------------- */

type Stage = 'uploading' | 'transcribing' | 'extracting' | 'ready'
type Seg = { speaker: string | null; start_ms: number; end_ms: number; text: string }

function AnalyzeOverlay(props: { jobs: Job[]; onSaved: (p: Persona) => void; onClose: () => void }) {
  const { jobs } = props
  const [i, setI] = useState(0)
  const [stage, setStage] = useState<Stage>('uploading')
  const [segs, setSegs] = useState<Seg[] | null>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const [text, setText] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ id: string; persona: Persona } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(0)
  const draftRef = useRef<string | null>(null)
  const job = jobs[i]

  useEffect(() => {
    const ctrl = new AbortController()
    setStage(job.kind === 'audio' ? 'uploading' : 'extracting')
    setSegs(null)
    setPeaks([])
    setText(null)
    setDraft(null)
    setError(null)
    const onEvent = (e: AnalyzeEvent) => {
      if (e.type === 'stage') setStage(e.stage)
      if (e.type === 'transcript') {
        setSegs(e.segments)
        setPeaks(e.peaks)
        setText(e.markdown)
      }
      if (e.type === 'draft') {
        draftRef.current = e.draft_id
        setDraft({ id: e.draft_id, persona: e.persona })
        setStage('ready')
      }
      if (e.type === 'error') setError(e.message)
    }
    const run = job.kind === 'audio' ? api.analyzeAudio(job.file, onEvent, ctrl.signal) : api.analyzeTranscript(job.text, job.title, onEvent, ctrl.signal)
    run.catch((e) => {
      if (!ctrl.signal.aborted) setError((e as Error).message)
    })
    return () => ctrl.abort()
  }, [job])

  function next() {
    draftRef.current = null
    if (i + 1 < jobs.length) setI(i + 1)
    else props.onClose()
  }

  function discard() {
    if (draftRef.current) api.discardDraft(draftRef.current).catch(() => {})
    next()
  }

  const close = () => {
    if (draftRef.current) api.discardDraft(draftRef.current).catch(() => {})
    props.onClose()
  }
  useEscape(close)

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const p = await api.saveDraft(draft.id)
      draftRef.current = null
      setSaved((n) => n + 1)
      props.onSaved(p)
      next()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const name = job.kind === 'audio' ? job.file.name : job.title ?? 'Pasted transcript'
  const steps: [Stage, string][] =
    job.kind === 'audio'
      ? [['uploading', 'Upload'], ['transcribing', 'Transcribe'], ['extracting', 'Extract persona']]
      : [['extracting', 'Extract persona']]
  const order: Stage[] = ['uploading', 'transcribing', 'extracting', 'ready']
  const stepState = (s: Stage) =>
    error && s === stage ? 'failed' : order.indexOf(stage) > order.indexOf(s) ? 'done' : stage === s ? 'active' : 'todo'
  const speakers = [...new Set((segs ?? []).map((s) => s.speaker).filter(Boolean))] as string[]
  const more = jobs.length > 1 && i + 1 < jobs.length

  return createPortal(
    <div className="run-overlay" role="dialog" aria-modal="true" aria-label={`Analyzing ${name}`}>
      <div className="run-overlay-card analyze-card">
        <div className="run-overlay-head">
          <div>
            <h2>{error ? 'Couldn’t analyze interview' : draft ? 'Persona ready' : 'Analyzing interview'}</h2>
            <p className="sub">
              {name}
              {jobs.length > 1 && ` · ${i + 1} of ${jobs.length}`}
              {saved > 0 && ` · ${saved} saved`}
            </p>
          </div>
          <div className="analyze-steps">
            {steps.map(([s, l], n) => (
              <span key={s} className={`astep ${stepState(s)}`}>
                <span className="astep-dot">{stepState(s) === 'done' ? '✓' : stepState(s) === 'failed' ? '!' : n + 1}</span>
                {l}
              </span>
            ))}
          </div>
        </div>

        <div className="analyze-grid">
          <section className="analyze-pane">
            <div className="pane-k">{job.kind === 'audio' ? 'Transcript' : 'Transcript (pasted)'}</div>
            {!segs && !text ? (
              <div className="listening">
                <div className="wave-loading big" aria-hidden>
                  {Array.from({ length: 36 }, (_, k) => <span key={k} style={{ animationDelay: `${k * 40}ms` }} />)}
                </div>
              </div>
            ) : (
              <>
                {peaks.length > 0 && <StaticWave peaks={peaks} />}
                <div className="transcript">
                  {segs && segs.length > 0 ? (
                    segs.map((s, k) => (
                      <div key={k} className={`seg spk-${speakers.indexOf(s.speaker ?? '') % 4}`} style={{ animationDelay: `${k * 70}ms` }}>
                        <span className="seg-meta">
                          <span className="seg-speaker">Speaker {speakers.indexOf(s.speaker ?? '') + 1}</span>
                          <span className="mono muted">{fmtMs(s.start_ms)}</span>
                        </span>
                        <span className="seg-text">{s.text}</span>
                      </div>
                    ))
                  ) : (
                    <div className="pasted-transcript">{text}</div>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="analyze-pane">
            <div className="pane-k">Persona</div>
            {draft ? (
              <article className="persona-card interview reveal">
                <div className="persona-top">
                  <span className="persona-top-btn">
                    <Avatar p={draft.persona} />
                    <span className="persona-title">
                      <span className="persona-name">{draft.persona.name ? `${draft.persona.name} · ` : ''}{draft.persona.label}</span>
                      <span className="mono muted">New persona{draft.persona.region ? ` · ${draft.persona.region}` : ''}</span>
                    </span>
                  </span>
                </div>
                <PersonaBody p={draft.persona} expanded />
              </article>
            ) : error ? (
              <p className="error small error-clamp" title={error}>{error}</p>
            ) : (
              <div className="skeleton-card" aria-hidden>
                <div className="sk-row"><span className="sk sk-avatar" /><span className="sk sk-line w60" /></div>
                <span className="sk sk-line w40" />
                {Array.from({ length: 7 }, (_, k) => <span key={k} className={`sk sk-line ${k % 2 ? 'w80' : 'w70'}`} />)}
              </div>
            )}
          </section>
        </div>

        <div className="analyze-foot">
          <div className="head-actions">
            {draft ? (
              <>
                <button className="btn" onClick={discard}>{more ? 'Skip' : 'Discard'}</button>
                <button className="btn btn-primary" disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save persona'}
                </button>
              </>
            ) : error ? (
              <button className="btn" onClick={next}>{more ? 'Next interview' : 'Close'}</button>
            ) : (
              <button className="btn" onClick={close}>Cancel</button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function StaticWave({ peaks }: { peaks: number[] }) {
  const bars = 120
  const step = peaks.length / bars
  const max = Math.max(...peaks, 0.0001)
  return (
    <svg className="waveform static" viewBox={`0 0 ${bars * 4} 40`} preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: bars }, (_, k) => {
        const slice = peaks.slice(Math.floor(k * step), Math.max(Math.floor((k + 1) * step), Math.floor(k * step) + 1))
        const h = Math.max(2, (Math.max(...slice) / max) * 36)
        return <rect key={k} x={k * 4} y={20 - h / 2} width={2.6} height={h} rx={1.3} style={{ animationDelay: `${k * 6}ms` }} />
      })}
    </svg>
  )
}

const fmtMs = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
