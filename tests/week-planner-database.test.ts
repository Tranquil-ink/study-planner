import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessData, snapshotSchema, type WorkLogInput } from '../src/domain/model'
import { shiftDate, today, weekStart } from '../src/domain/calendar'
import { weekSummary } from '../src/domain/planning'
import { createBackup, parseBackup } from '../src/data/backup'
import { category, goal, legacyTask, ownerA, ownerB, schedule, task, todo } from './fixtures'

let db: PGlite
const week = weekStart(today())
const nextWeek = shiftDate(week, 7)!
const template = [60, 60, 60, 60, 60, 0, 0]
const currentGoal = { ...goal, weekStart: week }
const currentSchedule = { ...schedule, date: today(), plannedMinutes: 120 }
const project = { id: randomUUID(), categoryId: category.id, title: '虚构项目', archived: false }
const actual: WorkLogInput = { id: randomUUID(), date: today(), taskId: task.id, todoId: null, scheduleBlockId: schedule.id,
  titleSnapshot: task.title, actualMinutes: 80, progressDelta: '6', progressLabel: '2.2', note: '' }
const oldSchedule = { id: randomUUID(), date: schedule.date, taskId: task.id, title: task.title, slotTemplateVersion: 2, slotIds: [9],
  startMinute: 1110, endMinute: 1200, plannedRangeText: '', note: '' }
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

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${ownerA}'),('${ownerB}');`)
  const migrations = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  for (const file of migrations.slice(0, -1)) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
  await actor()
  await rawSnapshot()
  await write('saveCategory', category, 0)
  await write('saveTask', legacyTask, 1, oldRequest)
  await write('saveSchedule', oldSchedule, 2)
  await write('saveWorkLog', { id: randomUUID(), date: oldSchedule.date, taskId: task.id, scheduleBlockId: oldSchedule.id,
    titleSnapshot: task.title, actualMinutes: 90, progressDelta: '0', progressLabel: '', note: '' }, 3)
  await db.exec('reset role')
  await db.exec(await readFile(`supabase/migrations/${migrations.at(-1)}`, 'utf8'))
  await actor()
}, 30000)
afterAll(async () => { await db?.close() })

describe('按天排程和周计划 PostgreSQL 事务', () => {
  it('在阶段 4 项目中应用一次新增迁移，已有测试安排时长和关联可读取', async () => {
    const state = await snapshot()
    expect(state.revision).toBe(5)
    expect(state.schedules[0]).toMatchObject({ id: oldSchedule.id, plannedMinutes: 90 })
    expect(state.schedules[0]).not.toHaveProperty('startMinute')
    expect(state.workLogs[0]).toMatchObject({ scheduleBlockId: oldSchedule.id, actualMinutes: 90 })
    expect(await write('saveTask', legacyTask, 1, oldRequest)).toEqual({ requestId: oldRequest, revision: 2 })
  })
  it('项目归属、周模板与本周例外分别持久化；初始承诺只确认一次', async () => {
    await mutate('saveProject', project)
    await mutate('saveTask', { ...task, projectId: project.id })
    await mutate('saveTodo', todo)
    await mutate('saveCapacityTemplate', { capacity: template })
    await mutate('saveWeekItem', currentGoal)
    await mutate('commitWeek', { weekStart: week })
    await mutate('saveWeekItem', { ...currentGoal, minutes: 180, targetUnits: '6' })
    await mutate('saveWeekCapacity', { weekStart: week, capacity: [30, 30, 30, 30, 30, 0, 0] })
    const state = await snapshot()
    expect(state.settings.capacityTemplate).toEqual(template)
    expect(state.weeks[0]).toMatchObject({ weekStart: week, capacity: [30, 30, 30, 30, 30, 0, 0] })
    expect(state.weekItems[0]).toMatchObject({ minutes: 180, targetUnits: '6', baseline: { minutes: 240, targetUnits: '30' } })
    await expect(mutate('commitWeek', { weekStart: week })).rejects.toThrow('WEEK_ALREADY_COMMITTED')
    await expect(mutate('saveWeekItem', { ...currentGoal, id: randomUUID() })).rejects.toThrow(/unique constraint/)
    await expect(mutate('saveWeekCapacity', { weekStart: shiftDate(week, 1), capacity: template })).rejects.toThrow(/check constraint/)
    await expect(mutate('saveCapacityTemplate', { capacity: [...template.slice(0, 6), null] })).rejects.toThrow('VALIDATION')
    expect(await snapshot()).toEqual(state)
  })
  it('同日多项安排、手填实际、改期和删除均不会覆盖计划/实际事实', async () => {
    const todoSchedule = { ...currentSchedule, id: randomUUID(), taskId: null, todoId: todo.id, plannedUnits: null, title: todo.title, plannedMinutes: 55 }
    await mutate('saveSchedule', currentSchedule)
    await mutate('saveSchedule', todoSchedule)
    const start = (await snapshot()).revision, requestId = randomUUID()
    expect((await snapshot()).workLogs).toHaveLength(1)
    await expect(mutate('saveWorkLog', { ...actual, scheduleBlockId: todoSchedule.id })).rejects.toThrow('LOG_SCHEDULE_MISMATCH')
    const receipt = await write('saveWorkLog', actual, start, requestId)
    expect(await write('saveWorkLog', actual, start, requestId)).toEqual(receipt)
    await expect(write('saveWorkLog', { ...actual, actualMinutes: 90 }, start, requestId)).rejects.toThrow('REQUEST_REUSED')
    await expect(mutate('saveTask', { ...task, projectId: project.id, unitName: '题' })).rejects.toThrow('TASK_UNIT_LOCKED')
    await mutate('resolveSchedule', { id: schedule.id, resolved: true })
    const report = weekSummary(await snapshot(), week, today())
    expect(report).toMatchObject({ actualMinutes: 80, scheduledMinutes: 175, currentReached: 1, initialReached: 0 })
    await mutate('saveSchedule', { ...currentSchedule, date: nextWeek, resolved: false })
    expect((await snapshot()).workLogs.find(l => l.id === actual.id)).toMatchObject({ date: actual.date, actualMinutes: 80 })
    await mutate('removeSchedule', { id: schedule.id })
    expect((await snapshot()).workLogs.find(l => l.id === actual.id)).toMatchObject({ scheduleBlockId: null, progressDelta: '6' })
  })
  it('无结果的结转回滚，成功结转保留原周状态与下周容量，完成待办不生成实际记录', async () => {
    const once = { ...currentGoal, id: randomUUID(), taskId: null, todoId: todo.id, targetUnits: null, minutes: 80 }
    await mutate('saveWeekItem', once)
    const before = await snapshot()
    const next = { ...once, id: randomUUID(), weekStart: nextWeek }
    await expect(mutate('carryWeekItem', { id: once.id, next: { ...next, minutes: 0 } })).rejects.toThrow('VALIDATION')
    expect(await snapshot()).toEqual(before)
    await mutate('carryWeekItem', { id: once.id, next })
    await mutate('completeTodo', { id: todo.id, completed: true })
    const state = await snapshot()
    expect(state.weeks.find(w => w.weekStart === nextWeek)?.capacity).toEqual(template)
    expect(state.weekItems.find(i => i.id === once.id)).toMatchObject({ status: 'carried', baseline: null })
    expect(state.weekItems.find(i => i.id === next.id)).toMatchObject({ status: 'active', weekStart: nextWeek })
    expect(state.todos[0].completedOn).toBe(today())
    expect(state.workLogs).toEqual(before.workLogs)
  })
  it('v5 完整恢复验证引用、保留基线和工作记录，失败回滚，其他账号隔离', async () => {
    const before = await snapshot()
    const backup = parseBackup(JSON.stringify(createBackup(before)))
    const expected = backup.data
    const illegal = { ...expected, weeks: [] }
    const requestId = randomUUID()
    await expect(write('restore', illegal, before.revision, requestId)).rejects.toThrow(/foreign key/)
    expect(await snapshot()).toEqual(before)
    const receipt = (await db.query<{ value: unknown }>('select public.planner_receipt($1) value', [requestId])).rows[0]
    expect(receipt.value).toBeNull()
    await mutate('restore', expected)
    const state = businessData(await snapshot())
    expect(state.settings).toEqual(expected.settings)
    expect(state.weeks).toEqual(expected.weeks)
    expect(state.weekItems.map(i => i.baseline)).toEqual(expected.weekItems.map(i => i.baseline))
    expect(state.workLogs.map(l => [l.id, l.createdOrder, l.progressDelta])).toEqual(expected.workLogs.map(l => [l.id, l.createdOrder, l.progressDelta]))
    await actor(ownerB)
    await expect(mutate('saveSchedule', { ...currentSchedule, id: randomUUID() })).rejects.toThrow(/foreign key/)
    expect((await snapshot()).weekItems).toEqual([])
  })
})
