import { describe, expect, it } from 'vitest'
import { addDays, clockTime, isBusinessDate, plannedMinutes, SLOTS, today, weekDates, weekStart } from '../src/domain/calendar'
import { datasetSchema, scheduleInputSchema } from '../src/domain/model'
import { createBackup, parseBackup } from '../src/data/backup'
import { audit, fixtureData, task, schedule } from './fixtures'

describe('日历日期与分钟', () => {
  it('中国日界不依赖设备时区，跨年与闰日保持业务日期', () => {
    expect(today(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12-31')
    expect(today(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(weekStart('2027-01-03')).toBe('2026-12-28')
    expect(weekDates('2026-11-01')).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01'])
    expect(weekStart('0001-01-01')).toBe('0001-01-01')
    expect(weekDates('9999-12-31').at(-1)).toBe('9999-12-31')
    expect(() => addDays('9999-12-31', 1)).toThrow()
  })
  it.each(['2026-02-29','2024-02-30','2026-13-01','0000-01-01','2026-1-1','2026-10-20T00:00:00Z'])('拒绝无效业务日期 %s', date => expect(isBusinessDate(date)).toBe(false))
  it('10 块共 690 分钟；两块晚间各 105，午休和晚饭不计入', () => {
    expect(SLOTS).toHaveLength(10)
    expect(SLOTS.reduce((n, s) => n + plannedMinutes(s), 0)).toBe(690)
    expect(SLOTS.slice(8).map(plannedMinutes)).toEqual([105,105])
    expect(SLOTS[4].startMinute - SLOTS[3].endMinute).toBe(60)
    expect(SLOTS[8].startMinute - SLOTS[7].endMinute).toBe(90)
    expect(clockTime(SLOTS[8].endMinute)).toBe('20:15')
  })
})
describe('日程快照与备份升级', () => {
  it('同日重复占用、悬空任务、伪造时间、合并、未知模板拒绝', () => {
    const row = { ...schedule, ...audit }
    expect(datasetSchema.safeParse({ ...fixtureData(), schedules: [row] }).success).toBe(true)
    expect(datasetSchema.safeParse({ ...fixtureData(), schedules: [row,{ ...row, id: '50000000-0000-4000-8000-000000000002' }] }).success).toBe(false)
    expect(datasetSchema.safeParse({ ...fixtureData(), tasks: [], schedules: [row] }).success).toBe(false)
    for (const patch of [{ startMinute: 541 },{ slotIds: [2,3] },{ slotTemplateVersion: 2 },{ date: '2026-02-30' },{ owner_id: task.id }]) expect(scheduleInputSchema.safeParse({ ...schedule, ...patch }).success).toBe(false)
  })
  it('v2 完整往返保留 UUID、引用、临时事项和时间快照，不改变初始进度', () => {
    const data = { ...fixtureData(), schedules: [{ ...schedule, ...audit },{ ...schedule, ...audit, id: '50000000-0000-4000-8000-000000000002', date: '2026-10-21', taskId: null, title: '临时报告' }] }
    const backup = createBackup({ ...data, revision: 5 })
    expect(backup.schemaVersion).toBe(2)
    expect(parseBackup(JSON.stringify(backup)).backup.data).toEqual(data)
    expect(backup.data.tasks[0].initialCompletedUnits).toBe('8')
  })
  it('有效 v1 迁移为空日程，严格拒绝伪造 v1 新字段与无效引用', () => {
    const data = fixtureData()
    const v1 = { format: 'study-planner', schemaVersion: 1, appVersion: '0.1.0', exportedAt: audit.createdAt, sourceRevision: 9, data: { categories: data.categories, tasks: data.tasks, settings: data.settings } }
    const result = parseBackup(JSON.stringify(v1))
    expect(result.sourceVersion).toBe(1); expect(result.migrated).toBe(true)
    expect(result.backup.data).toEqual(data)
    expect(() => parseBackup(JSON.stringify({ ...v1, data: { ...v1.data, schedules: [] } }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...v1, data: { ...v1.data, categories: [] } }))).toThrow()
  })
})
