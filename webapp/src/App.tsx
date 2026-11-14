import { useEffect, useState } from 'react'
import ProductsPage from './ProductsPage'
import TestsPage from './TestsPage'
import BenchmarkPage from './BenchmarkPage'
import ScenarioPage from './ScenarioPage'

// Hash routes: #/benchmark, #/benchmark/<id>, #/products, #/products/<pid>, #/tests, #/tests/<pid>, #/tests/<pid>/<runId>
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
  const tab = section === 'tests' ? 'tests' : section === 'benchmark' ? 'benchmark' : section === 'scenarios' ? 'scenarios' : 'products'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">ShelfTest</div>
          <nav className="tabs">
            <button className={tab === 'products' ? 'active' : ''} onClick={() => go('#/products')}>
              Products
            </button>
            <button className={tab === 'tests' ? 'active' : ''} onClick={() => go('#/tests')}>
              Tests
            </button>
            <button className={tab === 'scenarios' ? 'active' : ''} onClick={() => go('#/scenarios')}>
              Scenarios
            </button>
            <button className={tab === 'benchmark' ? 'active' : ''} onClick={() => go('#/benchmark')}>
              Benchmark
            </button>
          </nav>
        </div>
      </header>

      <main className="page">
        {tab === 'products' ? (
          <ProductsPage pid={a} go={go} />
        ) : tab === 'tests' ? (
          <TestsPage pid={a} runId={b} go={go} />
        ) : tab === 'scenarios' ? (
          <ScenarioPage pid={a} go={go} />
        ) : (
          <BenchmarkPage id={a} go={go} />
        )}
      </main>
    </div>
  )
}
