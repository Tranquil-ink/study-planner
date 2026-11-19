export type ErrorKind = 'auth' | 'network' | 'unknown' | 'conflict' | 'validation' | 'server'
export class DataError extends Error {
  constructor(public kind: ErrorKind, message: string) { super(message); this.name = 'DataError' }
}
export function dataError(error: unknown, writing = false): DataError {
  if (error instanceof DataError) return error
  const e = error as { code?: string; message?: string; status?: number } | null
  if (e?.code === 'REVISION_CONFLICT' || e?.message === 'REVISION_CONFLICT') return new DataError('conflict', '云端已有更新。请获取最新数据，核对后重新应用修改。')
  if (e?.message === 'SCHEDULE_MISSING') return new DataError('conflict', '此日程已被移除，请获取最新数据并核对。')
  if (e?.message === 'WEEK_ALREADY_COMMITTED') return new DataError('conflict', '周初计划已经确认。请获取最新数据。')
  if (e?.message === 'WEEK_EMPTY') return new DataError('validation', '本周还没有目标。添加后再确认。')
  if (e?.message === 'WEEK_ITEM_CHANGED') return new DataError('conflict', '此周目标已变更。请核对最新计划。')
  if (e?.message === 'NEXT_WEEK_EXISTS') return new DataError('validation', '下周已有此任务的目标，请直接编辑下周目标。')
  if (e?.message === 'SUBJECT_INACTIVE') return new DataError('validation', '任务已经完成、归档或不存在。')
  if (e?.message === 'TASK_UNIT_LOCKED') return new DataError('validation', '任务已有计划量或实际记录，进度单位已锁定。')
  if (e?.code === '23505' && /planner_week_items/.test(e.message ?? '')) return new DataError('validation', '同一任务在同一周只能有一项目标。')
  if (e?.message === 'PROGRESS_LIMIT') return new DataError('validation', '初始量与全部实际记录的累计进度超过任务总量，请核对后再保存。')
  if (e?.message === 'WORK_LOG_MISSING') return new DataError('conflict', '此实际记录已被删除，请获取最新数据并核对。')
  if (e?.message === 'LOG_SCHEDULE_MISMATCH') return new DataError('validation', '关联日程不存在或任务不同，请解除关联或选择匹配的日程。')
  if (e?.code === 'PGRST301' || e?.code === 'PGRST303' || e?.status === 401 || e?.message === 'AUTH_REQUIRED') return new DataError('auth', '登录已过期，请重新登录。当前输入尚未提交。')
  if (e?.code === 'P0001' || e?.code?.startsWith('22') || e?.code?.startsWith('23')) return new DataError('validation', e?.message === 'REQUEST_REUSED' ? '此请求编号已用于其他内容，请先确认原请求结果。' : '数据未通过云端校验，请检查日期与时长、任务引用、进度总量和备份格式。')
  if (e?.code === '42501') return new DataError('server', '没有操作权限，请检查账号和数据库授权。')
  if (writing) return new DataError('unknown', '保存结果待确认：请求可能已提交。请使用“确认并重试原请求”，不要重新创建。')
  return new DataError('network', '获取失败，请检查网络后重试。已有数据可能过期。')
}
export function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试' }
