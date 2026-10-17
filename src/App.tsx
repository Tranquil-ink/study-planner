import { useEffect } from 'react'
import { FeaturePlaceholder } from './components/FeaturePlaceholder'
import { pages } from './navigation'
import { useCurrentPage } from './useCurrentPage'

export default function App() {
  const currentPage = useCurrentPage()

  useEffect(() => {
    document.title = `${currentPage.label} · 学习日程规划器`
  }, [currentPage])

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        跳到主要内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">学</span>
          <div>
            <p className="brand-name">学习日程规划器</p>
            <p className="brand-caption">有计划，也有真实的进步</p>
          </div>
        </div>
        <nav aria-label="主导航">
          {pages.map((page, index) => (
            <a
              key={page.id}
              href={`#${page.id}`}
              aria-current={currentPage.id === page.id ? 'page' : undefined}
              className="nav-link"
            >
              <span className="nav-number" aria-hidden="true">0{index + 1}</span>
              {page.label}
            </a>
          ))}
        </nav>
        <p className="sidebar-note">一步一步，建立自己的学习节奏。</p>
      </aside>

      <main id="main-content" tabIndex={-1}>
        <div className="content">
          <p className="version-notice">当前版本仅提供页面导航与基础布局，暂不能记录或保存学习数据。</p>
          <header className="page-header" aria-live="polite" aria-atomic="true">
            <p className="eyebrow">我的学习空间</p>
            <h1>{currentPage.label}</h1>
            <p>{currentPage.description}</p>
          </header>
          <FeaturePlaceholder page={currentPage} />
          <footer>按自己的节奏规划，按真实的投入记录。</footer>
        </div>
      </main>
    </div>
  )
}
