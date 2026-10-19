export type ErrorKind = 'auth' | 'network' | 'unknown' | 'conflict' | 'validation' | 'server'
export class DataError extends Error {
  constructor(public kind: ErrorKind, message: string) { super(message); this.name = 'DataError' }
}
export function dataError(error: unknown, writing = false): DataError {
  if (error instanceof DataError) return error
  const e = error as { code?: string; message?: string; status?: number } | null
  if (e?.code === 'REVISION_CONFLICT' || e?.message === 'REVISION_CONFLICT') return new DataError('conflict', '云端已有更新。请获取最新数据，核对后重新应用修改。')
  if (e?.code === 'PGRST301' || e?.code === 'PGRST303' || e?.status === 401 || e?.message === 'AUTH_REQUIRED') return new DataError('auth', '登录已过期，请重新登录。当前输入尚未提交。')
  if (e?.code === 'P0001' || e?.code?.startsWith('22') || e?.code?.startsWith('23')) return new DataError('validation', e?.message === 'REQUEST_REUSED' ? '此请求编号已用于其他内容，请先确认原请求结果。' : '数据未通过云端校验，请检查进度总量、分类引用和备份格式。')
  if (e?.code === '42501') return new DataError('server', '没有操作权限，请检查账号和数据库授权。')
  if (writing) return new DataError('unknown', '保存结果待确认：请求可能已提交。请使用“确认并重试原请求”，不要重新创建。')
  return new DataError('network', '获取失败，请检查网络后重试。已有数据可能过期。')
}
export function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试' }
