import { z } from 'zod'
import { businessData, datasetSchema, revisionSchema, type Snapshot } from '../domain/model'

export const APP_VERSION = '0.3.0'
export const backupSchema = z.strictObject({
  format: z.literal('study-planner'), schemaVersion: z.literal(3), appVersion: z.string().min(1).max(40),
  exportedAt: z.iso.datetime({ offset: true }), sourceRevision: revisionSchema.optional(), data: datasetSchema,
})
export type Backup = z.infer<typeof backupSchema>

// Explicit migration contract, not a claim that an IndexedDB release existed.
// Same entities as v1, but quantities are JSON numbers. Unknown formats fail closed.
const legacySchema = z.strictObject({
  format: z.literal('study-planner-local'), schemaVersion: z.literal(0),
  appVersion: z.string().min(1).max(40), exportedAt: z.iso.datetime({ offset: true }),
  data: z.strictObject({ categories: z.array(z.unknown()), tasks: z.array(z.record(z.string(), z.unknown())), settings: z.unknown() }),
})
export function parseBackup(contents: string): { backup: Backup; migrated: boolean; sourceVersion: number } {
  if (new TextEncoder().encode(contents).length > 10 * 1024 * 1024) throw new Error('文件超过 10 MiB，请分辨是否为本应用备份')
  let raw: unknown
  try { raw = JSON.parse(contents) } catch { throw new Error('文件不是有效 JSON') }
  const old = legacySchema.safeParse(raw)
  if (old.success) {
    const data = old.data.data
    const tasks = data.tasks.map(task => {
      const convert = (value: unknown) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('旧格式进度必须是有限非负数')
        return String(value)
      }
      return { ...task, totalUnits: task.totalUnits === null ? null : convert(task.totalUnits), initialCompletedUnits: convert(task.initialCompletedUnits) }
    })
    const migrated = backupSchema.safeParse({ format: 'study-planner', schemaVersion: 3, appVersion: APP_VERSION, exportedAt: old.data.exportedAt, data: { ...data, tasks, schedules: [] } })
    if (!migrated.success) throw new Error('旧备份校验失败，请检查字段类型、时间、重复 ID、任务/分类引用、时段冲突和进度范围；不会修改云端数据')
    return { backup: migrated.data, migrated: true, sourceVersion: 0 }
  }
  // Validate the exact stage-1 envelope before adding the new empty collection.
  const v1 = backupSchema.extend({ schemaVersion: z.literal(1), data: z.strictObject({ categories: z.array(z.unknown()), tasks: z.array(z.unknown()), settings: z.unknown() }) }).safeParse(raw)
  if (v1.success) {
    const migrated = backupSchema.safeParse({ ...v1.data, schemaVersion: 3, data: { ...v1.data.data, schedules: [] } })
    if (!migrated.success) throw new Error('阶段 1 备份校验失败；不会修改云端数据')
    return { backup: migrated.data, migrated: true, sourceVersion: 1 }
  }
  // v2 allowed exactly one v1 base slot; do not accept new-format rows disguised as v2.
  const v2 = backupSchema.extend({ schemaVersion: z.literal(2) }).safeParse(raw)
  if (v2.success) {
    if (v2.data.data.schedules.some(s => s.slotTemplateVersion !== 1 || s.slotIds.length !== 1)) throw new Error('阶段 2 备份时段格式无效')
    return { backup: backupSchema.parse({ ...v2.data, schemaVersion: 3 }), migrated: true, sourceVersion: 2 }
  }
  if (typeof raw === 'object' && raw && 'schemaVersion' in raw && raw.schemaVersion !== 3) throw new Error('不支持此备份版本；不会修改云端数据')
  const result = backupSchema.safeParse(raw)
  if (!result.success) throw new Error('备份校验失败，请检查文件格式、字段类型、时间、重复 ID、任务/分类引用、时段冲突和进度范围；不会修改云端数据')
  return { backup: result.data, migrated: false, sourceVersion: 3 }
}
export function createBackup(snapshot: Snapshot): Backup {
  return backupSchema.parse({ format: 'study-planner', schemaVersion: 3, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), sourceRevision: snapshot.revision, data: businessData(snapshot) })
}
