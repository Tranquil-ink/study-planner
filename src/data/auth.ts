import type { SupabaseClient } from '@supabase/supabase-js'
import { DataError } from './errors'
export function authService(client: SupabaseClient) {
  return {
    async verify() {
      let result
      try { result = await client.auth.getUser() }
      catch { throw new DataError('network', '暂时无法验证登录，请检查网络后重试。') }
      const { data, error } = result
      if (error) {
        // Missing/rejected credentials differ from an unreachable Auth service.
        // A timeout or 5xx must not discard an already verified session.
        if (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403 ||
          ['bad_jwt', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'user_not_found', 'user_banned'].includes(error.code ?? '')) return null
        throw new DataError('network', '暂时无法验证登录，请检查网络后重试。')
      }
      if (!data.user) throw new DataError('network', '未能确认登录信息，请重试验证。')
      return { id: data.user.id, email: data.user.email ?? '' }
    },
    async login(email: string, password: string) {
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw new Error('登录失败，请检查邮箱、密码和网络。账号需由项目所有者预先创建。')
    },
    async logout() {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw new Error('退出失败，请检查网络后重试。')
    },
    subscribe(callback: (signedOut: boolean, sessionUserId?: string) => void) {
      // Session identity is an invalidation hint only; getUser still verifies it.
      // No awaited SDK calls inside onAuthStateChange (SDK session lock).
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event === 'SIGNED_OUT', session?.user.id))
      return () => data.subscription.unsubscribe()
    },
  }
}
export type AuthService = ReturnType<typeof authService>
