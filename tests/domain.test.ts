import { describe, expect, it } from 'vitest'
import { datasetSchema, quantityTicks, taskInputSchema } from '../src/domain/model'
import { createBackup, parseBackup } from '../src/data/backup'
import { audit, category, fixtureData, goal, savedGoal, schedule, task, todo } from './fixtures'

describe('精确进度与备份边界', () => {
  it('小数精确比较，位置文字不会参与计算', () => {
    expect(quantityTicks('0.1') + quantityTicks('0.2')).toBe(quantityTicks('0.3'))
    expect(taskInputSchema.parse(task).initialProgressLabel).toBe('2.1.1')
    expect(taskInputSchema.safeParse({ ...task, initialCompletedUnits: '40.000001' }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, totalUnits: null }).success).toBe(true)
  })
  it.each(['NaN', 'Infinity', '-1', '1e3', '1.1234567', '1000000000', '2.1.1', ' 1', '01'])('拒绝非法或不精确数量 %s', value => { expect(() => quantityTicks(value)).toThrow() })
  it('完整往返包含归档与设置，不携带身份或内部状态', () => {
    const data = fixtureData(); data.tasks[0].archived = true
    const backup = createBackup({ ...data, revision: 9 })
    expect(parseBackup(JSON.stringify(backup)).data).toEqual(data)
    expect(backup).not.toHaveProperty('owner_id')
    expect(backup.data).not.toHaveProperty('receipts')
  })
  it('拒绝重复 ID、悬空引用、额外实体和未授权字段', () => {
    const data = fixtureData()
    expect(datasetSchema.safeParse({ ...data, categories: [...data.categories, ...data.categories] }).success).toBe(false)
    expect(datasetSchema.safeParse({ ...data, categories: [] }).success).toBe(false)
    expect(datasetSchema.safeParse({ ...data, periodPlans: [] }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, owner_id: 'forged' }).success).toBe(false)
  })
  it('拒绝无效 JSON、未来版本与无效时间', () => {
    expect(() => parseBackup('{')).toThrow('有效 JSON')
    expect(() => parseBackup('{"schemaVersion":999}')).toThrow('仅恢复 v5')
    const backup = createBackup({ ...fixtureData(), revision: 0 })
    backup.exportedAt = '2026-02-30T00:00:00Z'
    expect(() => parseBackup(JSON.stringify(backup))).toThrow()
  })
  it('阶段 5 之前的备份不进入恢复事务', () => {
    const backup = createBackup({ ...fixtureData(), revision: 0 })
    expect(() => parseBackup(JSON.stringify({ ...backup, schemaVersion: 4 }))).toThrow('仅恢复 v5')
  })
  it('v5 备份保留日容量、实际与完成判断，新字段在校验后补齐', () => {
    const { period: _period, ...oldSchedule } = schedule
    void _period
    const legacy = {
      format: 'study-planner', schemaVersion: 5, appVersion: '0.5.0', exportedAt: audit.createdAt,
      data: {
        categories: [{ ...category, ...audit }], projects: [], tasks: [{ ...task, ...audit }], todos: [{ ...todo, ...audit, completedOn: null }],
        weeks: [{ weekStart: goal.weekStart, capacity: [120, 60, 0, 0, 0, 0, 0], committedAt: null }], weekItems: [],
        schedules: [{ ...oldSchedule, ...audit, resolved: true }],
        workLogs: [],
        settings: { timezone: 'Asia/Shanghai', dateFormat: 'YYYY-MM-DD', capacityTemplate: [60, 30, 0, 0, 0, 0, 0] },
      },
    }
    const migrated = parseBackup(JSON.stringify(legacy))
    expect(migrated.schemaVersion).toBe(7)
    expect(migrated.data.tasks[0].activated).toBe(false)
    expect(migrated.data.weeks[0].capacity?.[0]).toEqual([120, 0, 0])
    expect(migrated.data.settings.capacityTemplate?.[1]).toEqual([30, 0, 0])
    expect(migrated.data.schedules[0]).toMatchObject({ id: schedule.id, period: 'morning', position: 0, outcome: 'skipped' })
    legacy.data.categories = []
    expect(() => parseBackup(JSON.stringify(legacy))).toThrow('引用')
  })
  it('v6 的已有激活和周目标升级时不被改为周期任务', () => {
    const data = fixtureData()
    const { recursWeekly, recurringNextWeek, ...oldTodo } = data.todos[0]
    const { recurringCompletedOn, ...oldGoal } = savedGoal
    void recursWeekly; void recurringNextWeek; void recurringCompletedOn
    const backup = parseBackup(JSON.stringify({
      format: 'study-planner', schemaVersion: 6, appVersion: '0.5.1', exportedAt: audit.createdAt,
      data: { ...data, todos: [{ ...oldTodo, activated: true }], weekItems: [oldGoal],
        weeks: [{ weekStart: goal.weekStart, capacity: null, committedAt: null }] },
    }))
    expect(backup.data.todos[0]).toMatchObject({ activated: true, recursWeekly: false, recurringNextWeek: null })
    expect(backup.data.weekItems[0]).toMatchObject({ targetUnits: '30', recurringCompletedOn: null })
  })
})
