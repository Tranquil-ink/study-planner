import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { AuthService } from '../../data/auth'
import { Login } from './Login'
interface User { id: string; email: string }
export interface SessionProps { user: User; authorized: boolean; expire: () => void; logout: () => Promise<void>; login: ReactNode }
export function SessionBoundary({ auth, Content }: { auth: AuthService; Content: ComponentType<SessionProps> }) {
  const [user, setUser] = useState<User | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const generation = useRef(0)
  const verify = useCallback(async () => {
    const ticket = ++generation.current
    const result = await auth.verify().catch(() => null)
    if (ticket !== generation.current) return
    if (result) setUser(result)
    setAuthorized(!!result)
    setChecking(false)
  }, [auth])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const unsubscribe = auth.subscribe(signedOut => {
      if (signedOut) {
        // SDK may emit SIGNED_OUT when refresh credentials expire. Keep the
        // hidden, same-user draft until reauthentication; explicit logout below
        // destroys the workspace and all drafts.
        generation.current++; setAuthorized(false); setChecking(false)
      } else { clearTimeout(timer); timer = setTimeout(() => { void verify() }, 0) }
    })
    timer = setTimeout(() => { void verify() }, 0)
    const generationRef = generation
    return () => { generationRef.current++; clearTimeout(timer); unsubscribe() }
  }, [auth, verify])
  const expire = useCallback(() => { generation.current++; setAuthorized(false) }, [])
  const logout = useCallback(async () => {
    await auth.logout(); generation.current++; setUser(null); setAuthorized(false)
  }, [auth])
  const login = <Login auth={auth} onVerified={verify} />
  if (checking) return <p role="status">正在验证登录会话…</p>
  if (!user) return login
  return <Content user={user} authorized={authorized} expire={expire} logout={logout} login={login} />
}
