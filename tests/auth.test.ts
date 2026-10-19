import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { authService } from '../src/data/auth'
function service(result: unknown, throws = false) {
  const getUser = throws ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result)
  return authService({ auth: { getUser } } as unknown as SupabaseClient)
}
describe('Auth 验证将连接失败与身份拒绝分开', () => {
  it.each([
    { name: 'AuthRetryableFetchError', status: 0 },
    { name: 'AuthRetryableFetchError', status: 503 },
    { name: 'AuthApiError', status: 429 },
  ])('连接或暂时服务错误不得返回未登录：%j', async error => {
    await expect(service({ data: { user: null }, error }).verify()).rejects.toHaveProperty('kind', 'network')
  })
  it('抛出的 fetch 错误和缺失用户的异常响应也不能冒充登录失效', async () => {
    await expect(service(new TypeError('offline'), true).verify()).rejects.toHaveProperty('kind', 'network')
    await expect(service({ data: { user: null }, error: null }).verify()).rejects.toHaveProperty('kind', 'network')
  })
  it.each([
    { name: 'AuthSessionMissingError', status: 400 },
    { name: 'AuthApiError', status: 401 },
    { name: 'AuthApiError', status: 403 },
    { name: 'AuthApiError', status: 400, code: 'bad_jwt' },
  ])('明确的身份拒绝仍要求登录：%j', async error => {
    await expect(service({ data: { user: null }, error }).verify()).resolves.toBeNull()
  })
  it('只有成功验证响应返回用户身份', async () => {
    await expect(service({ data: { user: { id: 'verified-user', email: 'fixture@example.invalid' } }, error: null }).verify()).resolves.toEqual({ id: 'verified-user', email: 'fixture@example.invalid' })
  })
})
