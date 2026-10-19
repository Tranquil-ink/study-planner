import { useEffect } from 'react'
import { configuration, makeClient, makeRepository } from './data/supabase'
import { authService } from './data/auth'
import { SessionBoundary, type SessionProps } from './features/auth/SessionBoundary'
import { Workspace } from './features/Workspace'
const config = configuration(import.meta.env)
const client = config ? makeClient(config.url, config.key) : null
const auth = client ? authService(client) : null
const repository = client ? makeRepository(client) : null
import { pages } from './navigation'
import { useCurrentPage } from './useCurrentPage'

function AuthenticatedContent({ user, authorized, expire, logout, login }: SessionProps) {
  const page = useCurrentPage()
  return repository && <Workspace key={user.id} repository={repository} page={page} email={user.email} authorized={authorized} expire={expire} logout={logout} login={login} />
}

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
          {auth && repository ? <SessionBoundary auth={auth} Content={AuthenticatedContent} /> : <section className="panel">
            <h1>尚未配置云端连接</h1>
            <p>请按 README 配置 Supabase 项目后再登录。当前不能读取或保存学习数据。</p>
            <p>阶段 2 提供任务池、日历排程和完整备份；周期计划、实际记录与复盘将在后续阶段开放。</p>
          </section>}
          <footer>按自己的节奏规划，按真实的投入记录。</footer>
        </div>
      </main>
    </div>
  )
}
