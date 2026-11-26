import { z } from 'zod'
import { businessData, datasetSchema, revisionSchema, type Snapshot } from '../domain/model'

export const APP_VERSION = '0.5.0'
export const backupSchema = z.strictObject({
  format: z.literal('study-planner'), schemaVersion: z.literal(5), appVersion: z.string().min(1).max(40),
  exportedAt: z.iso.datetime({ offset: true }), sourceRevision: revisionSchema.optional(), data: datasetSchema,
})
export type Backup = z.infer<typeof backupSchema>

export function parseBackup(contents: string): Backup {
  if (new TextEncoder().encode(contents).length > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MiB')
  let raw: unknown
  try { raw = JSON.parse(contents) } catch { throw new Error('文件不是有效 JSON') }
  if (typeof raw === 'object' && raw && 'schemaVersion' in raw && raw.schemaVersion !== 5) {
    throw new Error('此版本仅恢复 v5 备份。请选择本版导出的文件。')
  }
  const result = backupSchema.safeParse(raw)
  if (!result.success) throw new Error(`备份校验失败。\n${result.error.issues[0]?.message ?? ''}`.trim())
  return result.data
}

export function createBackup(snapshot: Snapshot): Backup {
  return backupSchema.parse({ format: 'study-planner', schemaVersion: 5, appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(), sourceRevision: snapshot.revision, data: businessData(snapshot) })
}
