import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { datasetSchema, type Dataset, type WorkLog } from '../src/domain/model'
import { capacityFor, weekSummary } from '../src/domain/planning'
import { audit, fixtureData, goal, schedule, task, todo } from './fixtures'

function planned(): Dataset {
  const data = fixtureData()
  data.weeks = [{ weekStart: goal.weekStart, capacity: [60, 120, 60, 120, 60, 0, 0], committedAt: audit.createdAt }]
  data.weekItems = [{ ...goal, ...audit, status: 'active', baseline: { minutes: 240, targetUnits: '30' } }]
  return data
}
const log = (patch: Partial<WorkLog> = {}): WorkLog => ({
  id: randomUUID(), date: '2026-10-20', taskId: task.id, todoId: null, scheduleBlockId: null,
  titleSnapshot: task.title, actualMinutes: 80, progressDelta: '6', progressLabel: '', note: '', createdOrder: 1, ...audit, ...patch,
})

describe('周计划、剩余安排与报告口径', () => {
  it('30 页目标，实际 6 页、未来 20 页，剩余未排 4 页；旧排程不抵扣缺口', () => {
    const data = planned()
    data.schedules = [{ ...schedule, ...audit, plannedUnits: '24' },
      { ...schedule, ...audit, id: randomUUID(), date: '2026-10-22', plannedUnits: '20' }]
    data.workLogs = [log({ scheduleBlockId: schedule.id })]
    const summary = weekSummary(data, goal.weekStart, '2026-10-21')
    expect(summary.items[0]).toMatchObject({ actualUnits: '6', futureUnits: '20', missingUnits: '4', missed: 1, scheduling: '部分已排' })
    expect(summary).toMatchObject({ scheduledMinutes: 120, actualMinutes: 80, leftCapacity: 180 })
  })
  it('同日已有实际的安排只保留剩余计划量；完成一次性待办不产生投入', () => {
    const data = planned()
    data.schedules = [{ ...schedule, ...audit, plannedUnits: '20' }]
    data.workLogs = [log({ scheduleBlockId: schedule.id })]
    data.weekItems.push({ ...goal, ...audit, id: randomUUID(), taskId: null, todoId: todo.id, targetUnits: null, minutes: 80, status: 'active', baseline: null })
    data.todos[0].completedOn = '2026-10-20'
    const summary = weekSummary(data, goal.weekStart, '2026-10-20')
    expect(summary.items[0]).toMatchObject({ actualUnits: '6', futureUnits: '14', missingUnits: '10' })
    expect(summary.items[1]).toMatchObject({ actualMinutes: 0, current: { reached: true } })
    expect(summary.actualMinutes).toBe(80)
  })
  it('保留原目标与调整后目标、补计按发生周、周中新增与计划外投入分开', () => {
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
  it('模板只预填未保存的当周或未来周，调整模板不改历史容量', () => {
    const data = planned()
    data.settings.capacityTemplate = [80, 60, 80, 60, 80, 0, 0]
    expect(capacityFor(data, '2026-10-12', '2026-10-19')).toBeNull()
    expect(capacityFor(data, goal.weekStart, '2026-10-19')).toEqual(data.weeks[0].capacity)
    expect(capacityFor(data, '2026-10-26', '2026-10-19')).toEqual(data.settings.capacityTemplate)
  })
  it('允许同一天多项安排，但拒绝同一任务同周的重复目标', () => {
    const data = planned()
    data.schedules = [{ ...schedule, ...audit }, { ...schedule, ...audit, id: randomUUID() }]
    expect(datasetSchema.safeParse(data).success).toBe(true)
    data.weekItems.push({ ...data.weekItems[0], id: randomUUID() })
    expect(datasetSchema.safeParse(data).success).toBe(false)
  })
})
