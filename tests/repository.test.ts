import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { makeRepository, configuration } from '../src/data/supabase'
import { SnapshotGuard } from '../src/data/session-store'
import { category, fixtureData } from './fixtures'
const operation = { requestId: '40000000-0000-4000-8000-000000000001', expectedRevision: 0, command: { type: 'saveCategory', value: category } } as const
function repository(fetcher: typeof fetch) { return makeRepository(createClient('https://test.invalid','test-public-key',{ auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } })) }
describe('客户端失败与迟到响应处理（模拟传输）', () => {
  it('失败读数不能变成空库或空备份', async () => {
    const repo = repository(vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(repo.snapshot()).rejects.toHaveProperty('kind','network')
    await expect(repo.exportBackup()).rejects.toHaveProperty('kind','network')
  })
  it('提交响应丢失标记未知；按原请求重试不换 ID 或参数', async () => {
    const calls: unknown[] = []
    let lost = true
    const repo = repository(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      if (lost) { lost = false; throw new TypeError('response lost after commit') }
      return new Response(JSON.stringify({ requestId: operation.requestId, revision: 1 }))
    })
    await expect(repo.submit(operation)).rejects.toHaveProperty('kind','unknown')
    await expect(repo.submit(operation)).resolves.toEqual({ requestId: operation.requestId, revision: 1 })
    expect(calls[0]).toEqual(calls[1])
  })
  it.each([['PGRST301','JWT expired','auth'],['P0001','REVISION_CONFLICT','conflict'],['P0001','PROGRESS_LIMIT','validation'],['23505','duplicate key violates planner_schedules_occupied','conflict'],['P0001','SCHEDULE_MISSING','conflict']])('映射 %s / %s',async (code,message,kind) => {
    const repo = repository(async () => new Response(JSON.stringify({ code,message }),{ status: 400 }))
    await expect(repo.submit(operation)).rejects.toHaveProperty('kind',kind)
  })
  it('同会话忽略旧版本，会话切换作废在途请求', () => {
    const guard = new SnapshotGuard(); const ticket = guard.ticket()
    expect(guard.accept(ticket,{ ...fixtureData(), revision: 2 })).toBe(true)
    expect(guard.accept(ticket,{ ...fixtureData(), revision: 1 })).toBe(false)
    guard.invalidate()
    expect(guard.accept(ticket,{ ...fixtureData(), revision: 9 })).toBe(false)
    expect(guard.accept(guard.ticket(),{ ...fixtureData(), revision: 0 })).toBe(true)
  })
  it('拒绝缺失配置与前端特权 key', () => {
    expect(configuration({})).toBeNull()
    expect(configuration({ VITE_SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_no' })).toBeNull()
  })
})
