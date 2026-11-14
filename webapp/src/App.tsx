import { useEffect, useState } from 'react'
import ProductsPage from './ProductsPage'
import TestsPage from './TestsPage'
import BenchmarkPage from './BenchmarkPage'
import ScenarioPage from './ScenarioPage'
import PersonasPage from './PersonasPage'

// Hash routes: #/products, #/products/<pid>, #/tests, #/tests/<pid>, #/tests/<pid>/<runId>, #/personas, #/scenarios, #/scenarios/<pid>
// Not in the nav (open manually): #/benchmark, #/benchmark/<id>
function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

const go = (hash: string) => {
  window.location.hash = hash
  window.scrollTo(0, 0)
}

export default function App() {
  const [section = 'products', a = null, b = null] = useHash().replace(/^#\/?/, '').split('/').filter(Boolean)
  const tab = ['tests', 'personas', 'scenarios', 'benchmark'].includes(section) ? section : 'products'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="logo" href="#/products">
            <svg className="logo-mark" viewBox="0 0 28 28" aria-hidden>
              <circle cx="14" cy="14" r="5" />
              <circle cx="4.5" cy="6" r="2.4" />
              <circle cx="23.5" cy="6" r="2.4" />
              <circle cx="4.5" cy="22" r="2.4" />
              <circle cx="23.5" cy="22" r="2.4" />
              <path d="M6.5 7.3 10 11M21.5 7.3 18 11M6.5 20.7 10 17M21.5 20.7 18 17" />
            </svg>
            <span className="wordmark">
              Shelf<span>Test</span>
            </span>
          </a>
          <nav className="tabs">
            <button className={tab === 'products' ? 'active' : ''} onClick={() => go('#/products')}>
              Products
            </button>
            <button className={tab === 'tests' ? 'active' : ''} onClick={() => go('#/tests')}>
              Tests
            </button>
            <button className={tab === 'personas' ? 'active' : ''} onClick={() => go('#/personas')}>
              Personas
            </button>
            <button className={tab === 'scenarios' ? 'active' : ''} onClick={() => go('#/scenarios')}>
              Scenarios
            </button>
          </nav>
        </div>
      </header>

      <main className="page">
        {tab === 'products' && <ProductsPage pid={a} go={go} />}
        {tab === 'tests' && <TestsPage pid={a} runId={b} go={go} />}
        {tab === 'personas' && <PersonasPage />}
        {tab === 'scenarios' && <ScenarioPage pid={a} go={go} />}
        {tab === 'benchmark' && <BenchmarkPage id={a} go={go} />}
      </main>
    </div>
  )
}
