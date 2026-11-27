import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { datasetSchema, type Dataset, type WorkLog } from '../src/domain/model'
import { averageGoalRates, capacityFor, daySummary, emptyCapacity, weekCandidates, weekSummary } from '../src/domain/planning'
import { audit, fixtureData, goal, schedule, scheduled, task, todo } from './fixtures'

function planned(): Dataset {
  const data = fixtureData()
  data.weeks = [{ weekStart: goal.weekStart, capacity: [[30, 30, 0], [60, 60, 0], [60, 0, 0],
    [60, 30, 30], [60, 0, 0], [0, 0, 0], [0, 0, 0]], committedAt: audit.createdAt }]
  data.weekItems = [{ ...goal, ...audit, status: 'active', baseline: { minutes: 240, targetUnits: '30' } }]
  return data
}
const log = (patch: Partial<WorkLog> = {}): WorkLog => ({
  id: randomUUID(), date: '2026-10-20', taskId: task.id, todoId: null, scheduleBlockId: null,
  titleSnapshot: task.title, actualMinutes: 80, progressDelta: '6', progressLabel: '', note: '', createdOrder: 1, ...audit, ...patch,
})

describe('本周预算、累计进度和日程完成口径', () => {
  it('过去、未做和完成的安排都扣预算；实际时间不影响剩余预算', () => {
    const data = planned()
    data.schedules = [{ ...scheduled, plannedMinutes: 100, outcome: 'completed' },
      { ...scheduled, id: randomUUID(), date: '2026-10-22', plannedMinutes: 60, outcome: 'skipped' }]
    data.workLogs = [log({ scheduleBlockId: schedule.id, actualMinutes: 170 })]
    const summary = weekSummary(data, goal.weekStart, '2026-10-22')
    expect(summary.items[0]).toMatchObject({ budget: 80, actualUnits: '6', progress: { current: '14', target: '38', ratio: 0.2 } })
    expect(summary).toMatchObject({ scheduledMinutes: 160, actualMinutes: 170 })
    data.schedules[1].date = '2026-10-26'
    expect(weekSummary(data, goal.weekStart, '2026-10-22').items[0].budget).toBe(140)
  })
  it('累计位置包含周前进度，周比例和平均完成率只用各周实际新增与该周目标新增量', () => {
    const data = planned()
    data.workLogs = [log({ date: '2026-10-17', progressDelta: '10' }), log({ createdOrder: 2, progressDelta: '15' }),
      log({ date: '2026-10-26', createdOrder: 3, progressDelta: '2' })]
    const first = weekSummary(data, goal.weekStart, '2026-10-30')
    expect(first.items[0]).toMatchObject({ progress: { current: '33', target: '48', ratio: 0.5 } })
    data.weeks.push({ weekStart: '2026-10-26', capacity: null, committedAt: null })
    data.weekItems.push({ ...goal, id: randomUUID(), weekStart: '2026-10-26', targetUnits: '8', ...audit, status: 'active', baseline: null })
    const second = weekSummary(data, '2026-10-26', '2026-10-30')
    expect(second.items[0].progress).toEqual({ current: '35', target: '41', unit: '页', ratio: 0.25 })
    expect(averageGoalRates([first, second])[0]).toMatchObject({ count: 2, ratio: 0.375 })
  })
  it('同一天完成比例按卡片计数，未做照常计入分母和安排时长', () => {
    const data = planned()
    data.schedules = [{ ...scheduled, outcome: 'completed' }, { ...scheduled, id: randomUUID(), outcome: 'skipped', period: 'afternoon' },
      { ...scheduled, id: randomUUID(), period: 'afternoon', position: 1 }]
    expect(daySummary(data, schedule.date, schedule.date)).toMatchObject({
      capacity: 120, periodCapacity: [60, 60, 0], scheduledMinutes: 180, completedCount: 1,
    })
  })
  it('激活跨周持续，临时待办按距离该周周一不足两周自动出现，完成后退出候选', () => {
    const data = fixtureData()
    data.tasks[0].activated = true
    data.todos[0].dueDate = '2026-11-01'
    const borderTodo = { ...data.todos[0], dueDate: '2026-11-02', id: randomUUID() }
    data.todos.push(borderTodo)
    expect(weekCandidates(data, '2026-10-19', '2026-10-21').map(e => e.id)).toEqual([todo.id, task.id])
    data.todos[0].completedOn = '2026-10-22'
    expect(weekCandidates(data, '2026-10-26', '2026-10-27').map(e => e.id)).toEqual([borderTodo.id, task.id])
    expect(weekCandidates(data, '2026-10-19', '2026-10-27')).toEqual([])
  })
  it('保留原目标与调整后目标、补记按发生周、周中新增与计划外投入分开', () => {
    const data = planned()
    data.weekItems[0].targetUnits = '10'
    data.weekItems.push({ ...goal, ...audit, id: randomUUID(), taskId: null, todoId: todo.id, targetUnits: null, minutes: 80, status: 'active', baseline: null })
    data.workLogs = [log({ progressDelta: '10' }), log({ createdOrder: 2, date: '2026-10-26' }),
      log({ createdOrder: 3, taskId: null, progressDelta: null, actualMinutes: 25 })]
    const summary = weekSummary(data, goal.weekStart, '2026-10-30')
    expect(summary.items[0]).toMatchObject({ original: { reached: false, percent: 33 }, current: { reached: true, percent: 100 }, actualUnits: '10' })
    expect(summary).toMatchObject({ initialCount: 1, initialReached: 0, currentCount: 2, currentReached: 1, added: 1, unplannedActualMinutes: 25 })
    expect(weekSummary(data, '2026-10-26', '2026-10-30')).toMatchObject({ initialCount: 0, actualMinutes: 80 })
  })
  it('默认模板只为未设容量的当周或未来周提供值，已保存配置不会随模板调整', () => {
    const data = planned()
    data.settings.capacityTemplate = emptyCapacity()
    data.settings.capacityTemplate[0] = [30, 30, 60]
    expect(capacityFor(data, '2026-10-12', '2026-10-19')).toBeNull()
    expect(capacityFor(data, goal.weekStart, '2026-10-19')).toEqual(data.weeks[0].capacity)
    data.weeks.push({ weekStart: '2026-10-26', capacity: null, committedAt: null })
    expect(capacityFor(data, '2026-10-26', '2026-10-19')).toEqual(data.settings.capacityTemplate)
  })
  it('允许同一时段多项安排，拒绝重复顺序和同一任务同周的重复目标', () => {
    const data = planned()
    data.schedules = [scheduled, { ...scheduled, id: randomUUID(), position: 1 }]
    expect(datasetSchema.safeParse(data).success).toBe(true)
    data.schedules[1].position = 0
    expect(datasetSchema.safeParse(data).success).toBe(false)
    data.schedules[1].position = 1
    data.weekItems.push({ ...data.weekItems[0], id: randomUUID() })
    expect(datasetSchema.safeParse(data).success).toBe(false)
  })
})
