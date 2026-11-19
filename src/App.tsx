import { useEffect } from 'react'
import { configuration, makeClient, makeRepository } from './data/supabase'
import { authService } from './data/auth'
import { SessionBoundary, type SessionProps } from './features/auth/SessionBoundary'
import { Workspace } from './features/Workspace'
import { pages } from './navigation'
import { useCurrentPage } from './useCurrentPage'

const config = configuration(import.meta.env)
const client = config ? makeClient(config.url, config.key) : null
const auth = client ? authService(client) : null
const repository = client ? makeRepository(client) : null

function AuthenticatedContent({ user, authorized, expire, logout, login }: SessionProps) {
  const page = useCurrentPage()
  return repository && <Workspace key={user.id} repository={repository} page={page} email={user.email}
    authorized={authorized} expire={expire} logout={logout} login={login} />
}

export default function App() {
  const currentPage = useCurrentPage()
  useEffect(() => { document.title = `${currentPage.label} · 学习日程规划器` }, [currentPage])

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>
      跳到主要内容
    </a>
    <aside className="sidebar">
      <a className="brand" href="#today"><span className="brand-mark" aria-hidden="true">学</span><strong>学习日程规划器</strong></a>
      <nav aria-label="主导航">
        {pages.map(page => <a key={page.id} href={`#${page.id}`} aria-current={currentPage.id === page.id ? 'page' : undefined} className="nav-link">{page.label}</a>)}
      </nav>
    </aside>
    <main id="main-content" tabIndex={-1}>
      <div className="content">
        {auth && repository ? <SessionBoundary auth={auth} Content={AuthenticatedContent} /> : <section className="panel">
          <h1>尚未配置云端连接</h1>
          <p>按 README 配置 Supabase 项目后登录。</p>
        </section>}
      </div>
    </main>
  </div>
}
