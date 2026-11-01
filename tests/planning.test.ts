import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { capacityMinutes, carryDraft, weekSummary } from '../src/domain/planning'
import { entriesSchema, weekInputSchema, type WeekEntry } from '../src/domain/planning-schema'
import { datasetSchema } from '../src/domain/model'
import { createBackup, parseBackup } from '../src/data/backup'
import { audit, fixtureData, schedule, task, withoutPlanning } from './fixtures'
export const entry: WeekEntry = { id: '60000000-0000-4000-8000-000000000001', taskId: task.id, todoId: null, titleSnapshot: task.title, goalType: 'progress', estimatedMinutes: 240, targetUnits: '30', unitName: task.unitName, importance: 'important', deadline: null, carryToNextWeek: true, cancelled: false }
describe('周目标、容量与备份边界', () => {
  it('重叠按并集，不跨日相加；计划/已排/实际独立，额外安排不扩容', () => {
    const availability = [{ day: 1, startMinute: 540, endMinute: 570 }, { day: 1, startMinute: 560, endMinute: 585 }]
    expect(capacityMinutes(availability)).toBe(45)
    expect(capacityMinutes([...availability, { day: 2, startMinute: 540, endMinute: 585 }])).toBe(90)
    const s = { ...fixtureData(), revision: 0, schedules: [{ ...schedule, ...audit }], workLogs: [] }
    expect(weekSummary(s, '2026-10-19', availability, [entry])).toEqual({ capacity: 45, planned: 240, scheduled: 60, actual: 0, extra: 15 })
    expect(weekSummary(s, '2026-10-19', availability, [{ ...entry, cancelled: true }]).planned).toBe(0)
  })
  it('20 小时容量与24小时计划允许超量；同周重复任务/身份/无估时/非法目标被拒绝', () => {
    const value = { weekStart: '2026-11-02', availability: [{ day: 0, startMinute: 0, endMinute: 1200 }], entries: [{ ...entry, estimatedMinutes: 1440 }], confirm: false }
    expect(weekInputSchema.safeParse(value).success).toBe(true)
    expect(entriesSchema.safeParse([entry, { ...entry, id: randomUUID() }]).success).toBe(false)
    for (const patch of [{ targetUnits: '0' }, { targetUnits: '-1' }, { targetUnits: '0.0000001' }, { estimatedMinutes: 0 }, { goalType: 'todo' }, { todoId: randomUUID() }]) expect(entriesSchema.safeParse([{ ...entry, ...patch }]).success).toBe(false)
    expect(entriesSchema.safeParse([{ ...entry, goalType: 'time', targetUnits: null }]).success).toBe(true)
    expect(entriesSchema.safeParse([{ ...entry, targetUnits: '0.000001' }]).success).toBe(true)
    expect(weekInputSchema.safeParse({ ...value, weekStart: '2026-11-03' }).success).toBe(false)
  })
  it('带入只生成新身份草稿，跳过取消/未勾选/已有任务；不修改源条目', () => {
    expect(carryDraft([entry], [entry], randomUUID)).toEqual([])
    expect(carryDraft([{ ...entry, cancelled: true }], [], randomUUID)).toEqual([])
    const next = carryDraft([entry], [], randomUUID)
    expect(next[0].id).not.toBe(entry.id); expect(next[0].taskId).toBe(entry.taskId); expect(entry.targetUnits).toBe('30')
  })
  it('v4保留历史实际/时段，迁到v5空规划；拒绝伪装旧文件/遗漏新实体', () => {
    const backup = createBackup({ ...fixtureData(), revision: 3 })
    const old = { ...backup, schemaVersion: 4, data: withoutPlanning(backup.data) }
    const result = parseBackup(JSON.stringify(old))
    expect(result.sourceVersion).toBe(4); expect(result.backup.schemaVersion).toBe(5); expect(result.backup.data).toEqual(backup.data)
    expect(() => parseBackup(JSON.stringify({ ...old, data: backup.data }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...backup, data: old.data }))).toThrow()
    expect(datasetSchema.safeParse({ ...backup.data, todos: [{ id: randomUUID(), title: '报告', estimatedMinutes: null, note: '', archived: false, ...audit }] }).success).toBe(true)
  })
})
