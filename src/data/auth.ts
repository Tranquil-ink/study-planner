import type { SupabaseClient } from '@supabase/supabase-js'
export function authService(client: SupabaseClient) {
  return {
    async verify() {
      const { data, error } = await client.auth.getUser()
      if (error || !data.user) return null
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
    subscribe(callback: (signedOut: boolean) => void) {
      // No awaited SDK calls inside onAuthStateChange (SDK session lock).
      const { data } = client.auth.onAuthStateChange(event => callback(event === 'SIGNED_OUT'))
      return () => data.subscription.unsubscribe()
    },
  }
}
export type AuthService = ReturnType<typeof authService>
