import { useState, type FormEvent } from 'react'
import type { AuthService } from '../../data/auth'
import { messageOf } from '../../data/errors'
export function Login({ auth, onVerified }: { auth: AuthService; onVerified: () => Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true); setError('')
    try {
      await auth.login(String(values.get('email')), String(values.get('password')))
      form.reset()
      await onVerified()
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  return <section className="panel login-panel">
    <h1>登录学习日程规划器</h1>
    <p>手机和电脑使用同一个账号。学习数据保存在受保护的云端。</p>
    <form onSubmit={login}>
      <label>邮箱<input name="email" type="email" autoComplete="username" required /></label>
      <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
    <p className="muted">不开放注册。忘记密码时，请项目所有者通过 Supabase 管理端安全重设后重新登录。</p>
  </section>
}
