import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { snapshotSchema, receiptSchema, validateCommand, type Operation } from '../domain/model'
import { backupSchema, createBackup, parseBackup } from './backup'
import { DataError, dataError } from './errors'
import type { Repository } from './repository'

export function configuration(env: Record<string, unknown>) {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (typeof url !== 'string' || typeof key !== 'string' || !url || !key) return null
  try { if (new URL(url).protocol !== 'https:') return null } catch { return null }
  if (key.startsWith('sb_secret_')) return null
  // Reject legacy service_role keys accidentally placed in a public variable.
  if (!key.startsWith('sb_publishable_')) {
    try { if (JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'anon') return null } catch { return null }
  }
  return { url, key }
}
export function makeClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }) },
  })
}
export function makeRepository(client: SupabaseClient): Repository {
  async function call(name: string, args: Record<string, unknown> = {}, writing = false) {
    try {
      const { data, error } = await client.rpc(name, args)
      if (error) throw dataError(error, writing)
      return data as unknown
    } catch (error) { throw dataError(error, writing) }
  }
  async function submit(operation: Operation) {
    let command
    try { command = validateCommand(operation.command) } catch { throw new DataError('validation', '输入未通过校验，请检查字段、数量和引用。') }
    const raw = await call('planner_mutate', { p_request_id: operation.requestId, p_expected_revision: operation.expectedRevision, p_command: command }, true)
    const parsed = receiptSchema.safeParse(raw)
    if (!parsed.success || parsed.data.requestId !== operation.requestId) throw new DataError('unknown', '服务器回执无法确认，请确认并重试原请求。')
    return parsed.data
  }
  const repository: Repository = {
    async snapshot() {
      const result = snapshotSchema.safeParse(await call('planner_snapshot'))
      if (!result.success) throw new DataError('server', '云端数据格式与应用不兼容；请检查迁移和应用版本。')
      return result.data
    },
    submit,
    async confirm(requestId) {
      const raw = await call('planner_receipt', { p_request_id: requestId })
      if (raw === null) return null
      const parsed = receiptSchema.safeParse(raw)
      if (!parsed.success || parsed.data.requestId !== requestId) throw new DataError('server', '服务器回执格式不正确')
      return parsed.data
    },
    async exportBackup() { return createBackup(await repository.snapshot()) },
    async restore(backup, expectedRevision, requestId) {
      const parsed = backupSchema.safeParse(backup)
      if (!parsed.success) throw new DataError('validation', '备份格式不正确，不会修改云端。')
      return submit({ requestId, expectedRevision, command: { type: 'restore', value: parsed.data.data } })
    },
    async migrate(contents, expectedRevision, requestId) {
      let backup
      try { backup = parseBackup(contents).backup } catch { throw new DataError('validation', '本地备份格式不受支持或未通过校验。') }
      return repository.restore(backup, expectedRevision, requestId)
    },
  }
  return repository
}
