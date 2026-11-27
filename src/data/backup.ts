import { z } from 'zod'
import { businessData, datasetSchema, revisionSchema, v5DatasetSchema, type Snapshot } from '../domain/model'

export const APP_VERSION = '0.5.1'
const backupFields = {
  format: z.literal('study-planner'), appVersion: z.string().min(1).max(40),
  exportedAt: z.iso.datetime({ offset: true }), sourceRevision: revisionSchema.optional(),
}
export const backupSchema = z.strictObject({ ...backupFields, schemaVersion: z.literal(6), data: datasetSchema })
const v5BackupSchema = z.strictObject({ ...backupFields, schemaVersion: z.literal(5), data: v5DatasetSchema })
export type Backup = z.infer<typeof backupSchema>

function upgradeV5(backup: z.infer<typeof v5BackupSchema>) {
  const { data } = backup
  const capacity = (values: number[] | null) => values?.map(minutes => [minutes, 0, 0]) ?? null
  const positions = new Map<string, number>()
  const logged = new Set(data.workLogs.map(log => log.scheduleBlockId))
  const schedules = [...data.schedules].sort((a, b) =>
    Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
  return {
    ...backup, schemaVersion: 6,
    data: {
      ...data,
      tasks: data.tasks.map(row => ({ ...row, activated: false })),
      todos: data.todos.map(row => ({ ...row, activated: false })),
      weeks: data.weeks.map(row => ({ ...row, capacity: capacity(row.capacity) })),
      schedules: schedules.map(({ resolved, ...row }) => {
        const position = positions.get(row.date) ?? 0
        positions.set(row.date, position + 1)
        return { ...row, position, period: 'morning', outcome: !resolved ? 'pending' : logged.has(row.id) ? 'completed' : 'skipped' }
      }),
      settings: { ...data.settings, capacityTemplate: capacity(data.settings.capacityTemplate) },
    },
  }
}

export function parseBackup(contents: string): Backup {
  if (new TextEncoder().encode(contents).length > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MiB')
  let raw: unknown
  try { raw = JSON.parse(contents) } catch { throw new Error('文件不是有效 JSON') }
  if (typeof raw === 'object' && raw && 'schemaVersion' in raw) {
    if (raw.schemaVersion === 5) {
      const legacy = v5BackupSchema.safeParse(raw)
      if (!legacy.success) throw new Error(`v5 备份校验失败。 ${legacy.error.issues[0]?.message ?? ''}`)
      raw = upgradeV5(legacy.data)
    } else if (raw.schemaVersion !== 6) {
      throw new Error('此版本仅恢复 v5 或 v6 备份。')
    }
  }
  const result = backupSchema.safeParse(raw)
  if (!result.success) throw new Error(`备份校验失败。\n${result.error.issues[0]?.message ?? ''}`.trim())
  return result.data
}

export function createBackup(snapshot: Snapshot): Backup {
  return backupSchema.parse({ format: 'study-planner', schemaVersion: 6, appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(), sourceRevision: snapshot.revision, data: businessData(snapshot) })
}
