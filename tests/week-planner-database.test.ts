import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessData, snapshotSchema, type Capacity, type ScheduleInput, type WorkLogInput } from '../src/domain/model'
import { shiftDate, today, weekStart } from '../src/domain/calendar'
import { weekSummary } from '../src/domain/planning'
import { createBackup, parseBackup } from '../src/data/backup'
import { category, goal, legacyTask, ownerA, ownerB, schedule, task, todo } from './fixtures'

let db: PGlite
const now = today(), week = weekStart(now), nextWeek = shiftDate(week, 7)!
const template: Capacity = [[60, 30, 90], [0, 60, 0], [60, 0, 0], [30, 30, 90], [60, 0, 0], [0, 0, 0], [0, 0, 0]]
const currentGoal = { ...goal, weekStart: week }
const currentSchedule = { ...schedule, date: now, plannedMinutes: 120 }
const todoSchedule: ScheduleInput = { ...currentSchedule, id: randomUUID(), taskId: null, todoId: todo.id, plannedUnits: null,
  title: todo.title, plannedMinutes: 55 }
const project = { id: randomUUID(), categoryId: category.id, title: '虚构项目', archived: false }
const actual: WorkLogInput = { id: randomUUID(), date: now, taskId: task.id, todoId: null, scheduleBlockId: currentSchedule.id,
  titleSnapshot: task.title, actualMinutes: 80, progressDelta: '3', progressLabel: '2.2', note: '' }
const oldSchedule = { id: randomUUID(), date: schedule.date, taskId: task.id, title: task.title, slotTemplateVersion: 2, slotIds: [9],
  startMinute: 1110, endMinute: 1200, plannedRangeText: '', note: '' }
const oldSkipped = { id: randomUUID(), date: oldSchedule.date, taskId: null, todoId: null, title: '旧临时安排',
  plannedMinutes: 45, plannedUnits: null, plannedRangeText: '', note: '', resolved: true }
const oldRequest = randomUUID()

async function actor(id = ownerA) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role authenticated')
}
async function rawSnapshot() {
  return (await db.query<{ value: unknown }>('select public.planner_snapshot() value')).rows[0].value
}
async function snapshot() { return snapshotSchema.parse(await rawSnapshot()) }
async function write(type: string, value: unknown, revision: number, id = randomUUID()) {
  return (await db.query<{ value: { revision: number; requestId: string } }>(
    'select public.planner_mutate($1,$2,$3::jsonb) value', [id, revision, JSON.stringify({ type, value })])).rows[0].value
}
async function mutate(type: string, value: unknown) { return write(type, value, (await snapshot()).revision) }
async function migration(file: string) {
  await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${ownerA}'),('${ownerB}');`)
  const migrations = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  for (const file of migrations.filter(f => f < '202611010001_stage5a.sql')) await migration(file)
  await actor()
  await rawSnapshot()
  await write('saveCategory', category, 0)
  await write('saveTask', legacyTask, 1, oldRequest)
  await write('saveSchedule', oldSchedule, 2)
  await write('saveWorkLog', { id: randomUUID(), date: oldSchedule.date, taskId: task.id, scheduleBlockId: oldSchedule.id,
    titleSnapshot: task.title, actualMinutes: 90, progressDelta: '0', progressLabel: '', note: '' }, 3)
  await db.exec('reset role')
  await migration('202611190001_week_planner.sql')
  await actor()
  await write('resolveSchedule', { id: oldSchedule.id, resolved: true }, 5)
  await write('saveSchedule', oldSkipped, 6)
  await write('saveCapacityTemplate', { capacity: [60, 30, 90, 0, 0, 0, 0] }, 7)
  await write('saveWeekCapacity', { weekStart: goal.weekStart, capacity: [120, 60, 0, 0, 0, 0, 0] }, 8)
  await db.exec('reset role')
  await migration('202611260001_schedule_board.sql')
  await actor()
}, 30000)
afterAll(async () => { await db?.close() })

describe('日程看板 PostgreSQL 事务', () => {
  it('升级已有阶段 5 项目，旧安排、容量、实际和回执完整保留', async () => {
    const state = await snapshot()
    expect(state.revision).toBe(10)
    expect(state.schedules[0]).toMatchObject({ id: oldSchedule.id, plannedMinutes: 90, period: 'morning', position: 0, outcome: 'completed' })
    expect(state.schedules[1]).toMatchObject({ id: oldSkipped.id, plannedMinutes: 45, period: 'morning', position: 1, outcome: 'skipped' })
    expect(state.settings.capacityTemplate?.[1]).toEqual([30, 0, 0])
    expect(state.weeks[0].capacity?.[0]).toEqual([120, 0, 0])
    expect(state.workLogs[0]).toMatchObject({ scheduleBlockId: oldSchedule.id, actualMinutes: 90 })
    expect(await write('saveTask', legacyTask, 1, oldRequest)).toEqual({ requestId: oldRequest, revision: 2 })
  })
  it('激活、默认容量与周临时配置独立，周初承诺和重新设定保留基线', async () => {
    await mutate('saveProject', project)
    await mutate('saveTask', { ...task, projectId: project.id })
    await mutate('saveTodo', todo)
    await mutate('setSubjectActivated', { id: task.id, kind: 'task', activated: true })
    await mutate('saveTask', { ...task, projectId: project.id, note: '另一次编辑' })
    await mutate('saveCapacityTemplate', { capacity: template })
    await mutate('saveWeekItem', currentGoal)
    await mutate('commitWeek', { weekStart: week })
    await mutate('setWeekItemStatus', { id: currentGoal.id, status: 'cancelled' })
    await mutate('saveWeekItem', { ...currentGoal, minutes: 180, targetUnits: '6' })
    const temporary = structuredClone(template)
    temporary[0] = [30, 90, 120]
    await mutate('saveWeekCapacity', { weekStart: week, capacity: temporary })
    const state = await snapshot()
    expect(state.tasks[0].activated).toBe(true)
    expect(state.settings.capacityTemplate).toEqual(template)
    expect(state.weeks.find(w => w.weekStart === week)?.capacity).toEqual(temporary)
    expect(state.weekItems[0]).toMatchObject({ minutes: 180, targetUnits: '6', status: 'active', baseline: { minutes: 240, targetUnits: '30' } })
    await expect(mutate('commitWeek', { weekStart: week })).rejects.toThrow('WEEK_ALREADY_COMMITTED')
    await expect(mutate('saveWeekItem', { ...currentGoal, id: randomUUID() })).rejects.toThrow(/unique constraint/)
    await expect(mutate('saveWeekCapacity', { weekStart: shiftDate(week, 1), capacity: template })).rejects.toThrow(/check constraint/)
    await expect(mutate('saveCapacityTemplate', { capacity: [[600, 600, 600], ...template.slice(1)] })).rejects.toThrow('CAPACITY_LIMIT')
    expect(await snapshot()).toEqual(state)
  })
  it('填累计到达值，更新同一条实际和完成状态，失败或重试时不会重复计入', async () => {
    await mutate('saveSchedule', currentSchedule)
    await mutate('saveSchedule', todoSchedule)
    await expect(mutate('saveWorkLog', { ...actual, scheduleBlockId: todoSchedule.id })).rejects.toThrow('LOG_SCHEDULE_MISMATCH')
    await mutate('saveWorkLog', actual)
    const before = await snapshot(), requestId = randomUUID()
    const completion = { id: currentSchedule.id, logId: actual.id, date: now, actualMinutes: 85,
      reachedUnits: '14', progressLabel: '第 14 页', note: '' }
    await expect(mutate('setScheduleOutcome', { id: currentSchedule.id, outcome: 'skipped' })).rejects.toThrow('SCHEDULE_HAS_ACTUAL')
    await expect(mutate('completeSchedule', { ...completion, reachedUnits: '7' })).rejects.toThrow('PROGRESS_BEHIND')
    await expect(mutate('completeSchedule', { ...completion, reachedUnits: '41' })).rejects.toThrow('PROGRESS_LIMIT')
    expect(await snapshot()).toEqual(before)
    const receipt = await write('completeSchedule', completion, before.revision, requestId)
    expect(await write('completeSchedule', completion, before.revision, requestId)).toEqual(receipt)
    await expect(mutate('completeSchedule', { ...completion, logId: randomUUID() })).rejects.toThrow('SCHEDULE_OUTCOME_CHANGED')
    await expect(mutate('saveTask', { ...task, projectId: project.id, unitName: '题' })).rejects.toThrow('TASK_UNIT_LOCKED')
    const after = await snapshot()
    expect(after.workLogs).toHaveLength(2)
    expect(after.workLogs.find(l => l.id === actual.id)).toMatchObject({ actualMinutes: 85, progressDelta: '6' })
    expect(after.schedules.find(s => s.id === currentSchedule.id)).toMatchObject({ plannedMinutes: 120, outcome: 'completed' })
    const report = weekSummary(after, week, now)
    expect(report).toMatchObject({ actualMinutes: 85, scheduledMinutes: 175, currentReached: 1, initialReached: 0 })
    expect(report.items[0]).toMatchObject({ budget: 60, progress: { current: '14', target: '14', ratio: 1 } })
  })
  it('支持时段内排序和跨日移动，遇到过期位置回滚，实际发生日与状态保持', async () => {
    const newLocation = { date: now, period: 'morning' }
    await mutate('moveSchedule', { id: todoSchedule.id, ...newLocation, beforeId: currentSchedule.id })
    const ordered = await snapshot()
    expect(ordered.schedules.filter(s => s.date === now).map(s => s.id)).toEqual([todoSchedule.id, currentSchedule.id])
    await expect(mutate('moveSchedule', { id: currentSchedule.id, date: nextWeek, period: 'evening', beforeId: todoSchedule.id }))
      .rejects.toThrow('SCHEDULE_POSITION_CHANGED')
    expect(await snapshot()).toEqual(ordered)
    await mutate('moveSchedule', { id: currentSchedule.id, date: nextWeek, period: 'evening', beforeId: null })
    const moved = await snapshot()
    expect(moved.schedules.find(s => s.id === currentSchedule.id)).toMatchObject({ date: nextWeek, period: 'evening', outcome: 'completed' })
    expect(moved.workLogs).toEqual(ordered.workLogs)
    expect(weekSummary(moved, week, now).items[0].budget).toBe(180)
    expect(moved.weeks.find(w => w.weekStart === nextWeek)?.capacity).toEqual(template)
  })
  it('未做仍占预算，临时待办保留；在日程中新建或完成待办用同一事务', async () => {
    const once = { ...currentGoal, id: randomUUID(), taskId: null, todoId: todo.id, targetUnits: null, minutes: 90 }
    await mutate('saveWeekItem', once)
    const before = await snapshot()
    await mutate('setScheduleOutcome', { id: todoSchedule.id, outcome: 'skipped' })
    const skipped = await snapshot()
    expect(skipped.workLogs).toEqual(before.workLogs)
    expect(skipped.todos[0].completedOn).toBeNull()
    expect(weekSummary(skipped, week, now).items.find(r => r.item.id === once.id)?.budget).toBe(35)
    const inline = { ...todo, id: randomUUID(), title: '日程中新建的待办' }
    const card = { ...todoSchedule, id: randomUUID(), todoId: inline.id, title: inline.title, period: 'afternoon' }
    const entry = { type: 'saveTodo', value: inline }
    await expect(mutate('createScheduledEntry', { entry, schedule: { ...card, plannedMinutes: 0 } })).rejects.toThrow('VALIDATION')
    expect(await snapshot()).toEqual(skipped)
    await mutate('createScheduledEntry', { entry, schedule: card })
    const finish = { id: card.id, logId: randomUUID(), date: now, actualMinutes: 55, reachedUnits: null, progressLabel: '', note: '' }
    await mutate('completeSchedule', finish)
    const finished = await snapshot()
    expect(finished.todos.find(t => t.id === inline.id)?.completedOn).toBe(now)
    expect(finished.schedules.find(s => s.id === card.id)?.outcome).toBe('completed')
    expect(finished.workLogs.find(l => l.id === finish.logId)).toMatchObject({ scheduleBlockId: card.id, todoId: inline.id, actualMinutes: 55 })
    await mutate('removeSchedule', { id: currentSchedule.id })
    expect((await snapshot()).workLogs.find(l => l.id === actual.id)).toMatchObject({ scheduleBlockId: null, progressDelta: '6' })
  })
  it('v6 恢复保留顺序、激活和完成状态，失败回滚并隔离其他账号', async () => {
    const before = await snapshot()
    const expected = parseBackup(JSON.stringify(createBackup(before))).data
    const requestId = randomUUID()
    await expect(write('restore', { ...expected, weeks: [] }, before.revision, requestId)).rejects.toThrow(/foreign key/)
    expect(await snapshot()).toEqual(before)
    const duplicatePosition = structuredClone(expected)
    duplicatePosition.schedules[1].position = duplicatePosition.schedules[0].position
    await expect(mutate('restore', duplicatePosition)).rejects.toThrow('planner_schedule_period_position')
    expect(await snapshot()).toEqual(before)
    const receipt = (await db.query<{ value: unknown }>('select public.planner_receipt($1) value', [requestId])).rows[0]
    expect(receipt.value).toBeNull()
    await mutate('restore', expected)
    const state = businessData(await snapshot())
    expect(state.settings).toEqual(expected.settings)
    expect(state.weeks).toEqual(expected.weeks)
    expect(state.tasks.map(t => t.activated)).toEqual(expected.tasks.map(t => t.activated))
    expect(state.weekItems.map(i => i.baseline)).toEqual(expected.weekItems.map(i => i.baseline))
    expect(state.schedules.map(s => [s.id, s.position, s.period, s.outcome])).toEqual(expected.schedules.map(s => [s.id, s.position, s.period, s.outcome]))
    expect(state.workLogs.map(l => [l.id, l.createdOrder, l.progressDelta])).toEqual(expected.workLogs.map(l => [l.id, l.createdOrder, l.progressDelta]))
    await actor(ownerB)
    await expect(mutate('saveSchedule', { ...currentSchedule, id: randomUUID() })).rejects.toThrow(/foreign key/)
    await expect(mutate('setSubjectActivated', { id: task.id, kind: 'task', activated: false })).rejects.toThrow('SUBJECT_INACTIVE')
    expect((await snapshot()).weekItems).toEqual([])
  })
})
