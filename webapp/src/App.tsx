import { useState } from 'react'
import UploadTab from './UploadTab'
import ResultsTab from './ResultsTab'

type Tab = 'setup' | 'results'

export type RunInfo = { finishedAt: Date; decisions: number; wallTime: string; medianLatency: string }

export default function App() {
  const [tab, setTab] = useState<Tab>('setup')
  const [run, setRun] = useState<RunInfo | null>(null)

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">ShelfTest</div>
          <nav className="tabs">
            <button className={tab === 'setup' ? 'active' : ''} onClick={() => setTab('setup')}>
              New test
            </button>
            <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>
              Results
              {run && <span className="tab-dot" />}
            </button>
          </nav>
        </div>
      </header>

      <main className="page">
        {tab === 'setup' ? (
          <UploadTab
            onRunComplete={(info) => {
              setRun(info)
              setTab('results')
            }}
          />
        ) : (
          <ResultsTab run={run} onNewTest={() => setTab('setup')} />
        )}
      </main>
    </div>
  )
}
