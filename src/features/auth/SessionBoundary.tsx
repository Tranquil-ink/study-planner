import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { AuthService } from '../../data/auth'
import { Login } from './Login'
import { messageOf } from '../../data/errors'
interface User { id: string; email: string }
export interface SessionProps { user: User; authorized: boolean; expire: () => void; logout: () => Promise<void>; login: ReactNode }
export function SessionBoundary({ auth, Content }: { auth: AuthService; Content: ComponentType<SessionProps> }) {
  const [user, setUser] = useState<User | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const [verificationError, setVerificationError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const verifiedUserId = useRef<string | null>(null)
  const generation = useRef(0)
  const verify = useCallback(async () => {
    const ticket = ++generation.current
    setVerifying(true)
    try {
      const result = await auth.verify()
      if (ticket !== generation.current) return
      if (result) { verifiedUserId.current = result.id; setUser(result) }
      setAuthorized(!!result)
      setVerificationError('')
    } catch (error) {
      if (ticket !== generation.current) return
      // Keep only the session that was already verified in this page. Initial
      // load and a different account remain gated; network failure grants nothing.
      setVerificationError(messageOf(error))
    } finally {
      if (ticket === generation.current) { setChecking(false); setVerifying(false) }
    }
  }, [auth])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const unsubscribe = auth.subscribe((signedOut, sessionUserId) => {
      if (signedOut) {
        // SDK may emit SIGNED_OUT when refresh credentials expire. Keep the
        // hidden, same-user draft until reauthentication; explicit logout below
        // destroys the workspace and all drafts.
        generation.current++; setAuthorized(false); setChecking(false); setVerifying(false); setVerificationError('')
      } else {
        if (sessionUserId && verifiedUserId.current && sessionUserId !== verifiedUserId.current) {
          generation.current++; verifiedUserId.current = null; setUser(null); setAuthorized(false)
        }
        clearTimeout(timer); timer = setTimeout(() => { void verify() }, 0)
      }
    })
    timer = setTimeout(() => { void verify() }, 0)
    const reconnect = () => { void verify() }
    window.addEventListener('online', reconnect)
    const generationRef = generation
    return () => { generationRef.current++; clearTimeout(timer); unsubscribe(); window.removeEventListener('online', reconnect) }
  }, [auth, verify])
  const expire = useCallback(() => { generation.current++; setAuthorized(false); setVerifying(false); setVerificationError('') }, [])
  const logout = useCallback(async () => {
    await auth.logout(); generation.current++; verifiedUserId.current = null; setUser(null); setAuthorized(false); setVerificationError('')
  }, [auth])
  const login = <Login auth={auth} onVerified={verify} />
  if (checking) return <p role="status">正在验证登录会话…</p>
  const connectionNotice = verificationError && <section className="notice" aria-label="登录连接状态">
    <p role="alert">{verificationError}{user && authorized ? ' 已加载内容可能过期；当前输入仍保留，恢复连接后请获取最新数据。' : ' 尚未完成会话验证，不显示个人数据。'}</p>
    <button disabled={verifying} onClick={() => { void verify() }}>{verifying ? '正在验证…' : '重试验证登录'}</button>
  </section>
  if (!user) return verificationError ? connectionNotice : login
  return <>{connectionNotice}<Content user={user} authorized={authorized} expire={expire} logout={logout} login={login} /></>
}
