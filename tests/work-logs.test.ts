import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { datasetSchema, workLogInputSchema, type WorkLog } from '../src/domain/model'
import { taskProgress } from '../src/domain/work-logs'
import { createBackup, parseBackup } from '../src/data/backup'
import { audit, fixtureData, schedule, task } from './fixtures'
const row = (patch: Partial<WorkLog> = {}): WorkLog => ({ id: randomUUID(), date: '2026-10-25', taskId: task.id, scheduleBlockId: null, titleSnapshot: task.title, actualMinutes: 80, progressDelta: '1.5', progressLabel: '2.2', note: '', createdOrder: 1, ...audit, ...patch })
describe('实际记录的精确进度、日期与备份', () => {
  it('8 → 9.5 → 9 → 8；编辑替换原记录，零进度仍计投入', () => {
    const t = fixtureData().tasks[0]
    expect(taskProgress(t, [row()]).completedUnits).toBe('9.5')
    expect(taskProgress(t, [row({ progressDelta: '1' })]).completedUnits).toBe('9')
    expect(taskProgress(t, []).completedUnits).toBe('8')
    expect(taskProgress(t, [row({ progressDelta: '0' })])).toMatchObject({ completedUnits: '8', actualMinutes: 80 })
    expect(taskProgress(t, [row({ progressDelta: '0.1' }), row({ progressDelta: '0.2', createdOrder: 2 })]).completedUnits).toBe('8.3')
  })
  it('按业务日期、同日稳定创建顺序取最近非空位置；历史修改与审计时间不覆盖以后位置', () => {
    const rows = [row({ date: '2026-10-24', progressLabel: '旧日更正', updatedAt: '2026-10-26T00:00:00Z', createdOrder: 9 }), row({ progressLabel: '2.3', createdOrder: 2 }), row({ progressLabel: ' ', createdOrder: 3 }), row({ date: '2026-10-26', progressLabel: '将来', createdOrder: 4 })]
    const t = fixtureData().tasks[0]
    expect(taskProgress(t, rows, '2026-10-23')).toMatchObject({ progressLabel: '2.1.1', completedUnits: '8', actualMinutes: 0 })
    expect(taskProgress(t, rows, '2026-10-24').progressLabel).toBe('旧日更正')
    expect(taskProgress(t, rows, '2026-10-25')).toMatchObject({ progressLabel: '2.3', completedUnits: '12.5', actualMinutes: 240 })
  })
  it('拒绝非正整数分钟、负/超精度进度与临时进度；允许超出计划分钟', () => {
    const { createdAt: _c, updatedAt: _u, createdOrder: _o, ...input } = row(); void _c; void _u; void _o
    for (const actualMinutes of [0, -1, 0.5, NaN, Infinity, 2147483648]) expect(workLogInputSchema.safeParse({ ...input, actualMinutes }).success).toBe(false)
    for (const progressDelta of ['-1', '0.0000001', '2.1.1', null]) expect(workLogInputSchema.safeParse({ ...input, progressDelta }).success).toBe(false)
    expect(workLogInputSchema.safeParse({ ...input, actualMinutes: 180, progressDelta: '0' }).success).toBe(true)
    expect(workLogInputSchema.safeParse({ ...input, taskId: null, progressDelta: '1' }).success).toBe(false)
    expect(workLogInputSchema.safeParse({ ...input, taskId: null, progressDelta: null }).success).toBe(true)
  })
  it('备份检验全部记录的总量、顺序、引用和关联任务，日期可与计划不同', () => {
    const data = { ...fixtureData(), schedules: [{ ...schedule, ...audit }], workLogs: [row({ scheduleBlockId: schedule.id })] }
    expect(datasetSchema.safeParse(data).success).toBe(true)
    for (const workLogs of [[row({ progressDelta: '32.000001' })], [row(), row()], [row({ taskId: randomUUID() })], [row({ scheduleBlockId: randomUUID() })], [row({ scheduleBlockId: schedule.id, taskId: null, progressDelta: null })]]) expect(datasetSchema.safeParse({ ...data, workLogs }).success).toBe(false)
    const backup = createBackup({ ...data, revision: 1 })
    expect(backup.schemaVersion).toBe(4)
    expect(parseBackup(JSON.stringify(backup)).backup.data).toEqual(data)
    const { workLogs: _logs, ...oldData } = data; void _logs
    const old = { ...backup, schemaVersion: 3, data: oldData }
    expect(parseBackup(JSON.stringify(old))).toMatchObject({ migrated: true, sourceVersion: 3, backup: { data: { ...oldData, workLogs: [] } } })
    expect(() => parseBackup(JSON.stringify({ ...old, data }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...backup, data: oldData }))).toThrow()
  })
})
