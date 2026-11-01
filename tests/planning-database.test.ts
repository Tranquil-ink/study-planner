import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessData, datasetSchema, snapshotSchema } from '../src/domain/model'
import { createBackup, parseBackup } from '../src/data/backup'
import { category, task, ownerA, ownerB, schedule, withoutPlanning } from './fixtures'
import type { WeekEntry, WeekInput } from '../src/domain/planning-schema'
let db: PGlite
const entry: WeekEntry = { id: randomUUID(), taskId: task.id, todoId: null, titleSnapshot: task.title, goalType: 'progress', estimatedMinutes: 240, targetUnits: '30', unitName: task.unitName, importance: 'important', deadline: '2026-11-08', carryToNextWeek: true, cancelled: false }
const todo = { id: randomUUID(), title: '完成课程报告', estimatedMinutes: null, note: '', archived: false }
const availability = [{ day: 0, startMinute: 480, endMinute: 720 }]
const week: WeekInput = { weekStart: '2026-11-02', entries: [entry], availability, confirm: false }
const oldRequest = randomUUID()
let beforeUpgrade: Record<string, unknown>
async function actor(id = ownerA, role = 'authenticated') {
  await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec(`set role ${role}`)
}
async function snapshot() { return snapshotSchema.parse((await db.query<{ value: unknown }>('select public.planner_snapshot() value')).rows[0].value) }
async function write(command: unknown, revision: number, id = randomUUID()) { return (await db.query<{ value: unknown }>('select public.planner_mutate($1,$2,$3::jsonb) value', [id, revision, JSON.stringify(command)])).rows[0].value }
async function mutate(command: unknown) { return write(command, (await snapshot()).revision) }
async function unchanged(command: unknown, pattern?: RegExp) {
  const before = await snapshot(), id = randomUUID()
  await expect(write(command, before.revision, id)).rejects.toThrow(pattern)
  expect(await snapshot()).toEqual(before)
  expect((await db.query<{ value: unknown }>('select public.planner_receipt($1) value', [id])).rows[0].value).toBeNull()
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${ownerA}'),('${ownerB}');`)
  for (const file of ['202610170001_stage1.sql', '202610190001_stage2.sql', '202610210001_stage3.sql', '202610250001_stage4.sql']) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
  await actor(); await write({ type: 'saveCategory', value: category }, 0, oldRequest); await write({ type: 'saveTask', value: task }, 1); await write({ type: 'saveSchedule', value: schedule }, 2)
  beforeUpgrade = (await db.query<{ value: Record<string, unknown> }>('select public.planner_snapshot() value')).rows[0].value
  await db.exec('reset role'); await db.exec(await readFile('supabase/migrations/202611010001_stage5a.sql', 'utf8')); await actor()
}, 30000)
afterAll(async () => { await db?.close() })
describe('阶段 5A PostgreSQL 事务/权限/历史（本地引擎）', () => {
  it('升级保留阶段4事实及回执；旧版本编辑冲突，旧格式恢复拒绝', async () => {
    const current = await snapshot()
    expect(current).toEqual({ ...beforeUpgrade, revision: 4, todos: [], weekPlans: [], availabilityTemplate: [] })
    expect(await write({ type: 'saveCategory', value: category }, 0, oldRequest)).toEqual({ requestId: oldRequest, revision: 1 })
    await expect(write({ type: 'saveTask', value: task }, 3)).rejects.toThrow('REVISION_CONFLICT')
    await unchanged({ type: 'restore', value: withoutPlanning(businessData(current)) }, /VALIDATION/)
  })
  it('待估算收集不要求执行周；同身份编辑，版本竞争和幂等不重复历史', async () => {
    await mutate({ type: 'saveTodo', value: todo })
    const before = await snapshot(), requestId = randomUUID(), command = { type: 'saveWeekPlan', value: week }
    const result = await write(command, before.revision, requestId)
    expect(await write(command, before.revision, requestId)).toEqual(result)
    expect((await snapshot()).weekPlans[0].history).toHaveLength(1)
    const rev = (await snapshot()).revision
    const results = await Promise.allSettled([write({ type: 'saveTodo', value: { ...todo, estimatedMinutes: 60 } }, rev), write({ type: 'saveTodo', value: { ...todo, estimatedMinutes: 90 } }, rev)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { message: 'REVISION_CONFLICT' } })
    expect((await snapshot()).todos).toHaveLength(1)
    await expect(write({ ...command, value: { ...week, confirm: true } }, before.revision, requestId)).rejects.toThrow('REQUEST_REUSED')
  })
  it('确认后改目标/新增/取消保留初始量与全部历史，不写实际或日程', async () => {
    await mutate({ type: 'saveWeekPlan', value: { ...week, confirm: true } })
    const before = await snapshot(), initial = before.weekPlans[0].initialEntries
    const todoEntry: WeekEntry = { ...entry, id: randomUUID(), taskId: null, todoId: todo.id, titleSnapshot: todo.title, goalType: 'todo', targetUnits: null, unitName: '', estimatedMinutes: 60 }
    await mutate({ type: 'saveWeekPlan', value: { ...week, entries: [{ ...entry, targetUnits: '10', cancelled: true }, todoEntry] } })
    const current = await snapshot()
    expect(current.weekPlans[0].initialEntries).toEqual(initial); expect(current.weekPlans[0].initialEntries?.[0].targetUnits).toBe('30')
    expect(current.weekPlans[0].history).toHaveLength(3); expect(current.weekPlans[0].entries[0].targetUnits).toBe('10')
    expect(current.schedules).toEqual(before.schedules); expect(current.workLogs).toEqual(before.workLogs)
    await unchanged({ type: 'saveWeekPlan', value: { ...week, confirm: true } }, /PLAN_ALREADY_CONFIRMED|PLAN_IDENTITY/)
    await unchanged({ type: 'saveWeekPlan', value: week }, /PLAN_IDENTITY/)
  })
  it('模板、本周例外、其他周互不改写；同任务跨周可有新目标', async () => {
    const historical = (await snapshot()).weekPlans[0]
    await mutate({ type: 'saveAvailabilityTemplate', value: { availability: [{ day: 1, startMinute: 480, endMinute: 600 }] } })
    await mutate({ type: 'saveWeekPlan', value: { ...week, weekStart: '2026-11-09', entries: [{ ...entry, id: randomUUID() }], availability: (await snapshot()).availabilityTemplate } })
    await mutate({ type: 'saveAvailabilityTemplate', value: { availability: [] } })
    const current = await snapshot(); expect(current.weekPlans[0]).toEqual(historical); expect(current.weekPlans[1].availability).toEqual([{ day: 1, startMinute: 480, endMinute: 600 }])
  })
  it('拒绝重复任务、空估时、超精度、无效日期/时段、历史单位更换及伪造字段', async () => {
    const fresh = { ...week, weekStart: '2026-11-16' }
    for (const entries of [[entry, { ...entry, id: randomUUID() }], [{ ...entry, targetUnits: '0.0000001' }], [{ ...entry, targetUnits: '0' }], [{ ...entry, estimatedMinutes: 0 }], [{ ...entry, estimatedMinutes: 1.5 }], [{ ...entry, taskId: randomUUID() }], [{ ...entry, deadline: '2026-02-30' }], [{ ...entry, owner_id: ownerB }]]) await unchanged({ type: 'saveWeekPlan', value: { ...fresh, entries } })
    await unchanged({ type: 'saveWeekPlan', value: { ...fresh, weekStart: '2026-11-17' } })
    for (const availability of [[{ day: 7, startMinute: 0, endMinute: 1 }], [{ day: 0, startMinute: 60, endMinute: 30 }], [{ day: 0, startMinute: 0, endMinute: 1441 }]]) await unchanged({ type: 'saveAvailabilityTemplate', value: { availability } })
    await unchanged({ type: 'saveTask', value: { ...task, unitName: '页' } }, /PLAN_REFERENCE/)
    await unchanged({ type: 'saveTodo', value: { ...todo, owner_id: ownerB } }, /VALIDATION/)
  })
  it('完整v5恢复留存基线/历史/模板；损坏引用和历史回滚，v4迁移清空规划', async () => {
    const before = await snapshot(), backup = createBackup(before)
    expect(parseBackup(JSON.stringify(backup)).backup.data).toEqual(businessData(before))
    for (const patch of [{ initialEntries: [] }, { history: [] }, { entries: [] }, { confirmedAt: null }]) {
      const data = { ...backup.data, weekPlans: [{ ...backup.data.weekPlans[0], ...patch }] }
      expect(datasetSchema.safeParse(data).success).toBe(false)
      await unchanged({ type: 'restore', value: data })
    }
    await unchanged({ type: 'restore', value: { ...backup.data, todos: [] } }, /PLAN_REFERENCE/)
    await unchanged({ type: 'restore', value: { ...backup.data, weekPlans: [...backup.data.weekPlans, backup.data.weekPlans[0]] } }, /DUPLICATE_ID/)
    const id = randomUUID(), command = { type: 'restore', value: backup.data }
    const receipt = await write(command, before.revision, id); expect(await write(command, before.revision, id)).toEqual(receipt)
    expect((await snapshot()).weekPlans).toEqual(before.weekPlans)
    const old = parseBackup(JSON.stringify({ ...backup, schemaVersion: 4, data: withoutPlanning(backup.data) }))
    await mutate({ type: 'restore', value: old.backup.data }); expect((await snapshot()).weekPlans).toEqual([])
    await mutate(command)
  })
  it('新表与历史私有函数无旁路；跨账号引用、匿名、直写与伪造owner拒绝', async () => {
    const tables = ['planner_todos', 'planner_week_plans', 'planner_availability_templates']
    for (const table of tables) {
      for (const sql of [`insert into public.${table}(owner_id) values('${ownerA}')`, `update public.${table} set owner_id='${ownerB}'`, `delete from public.${table}`]) await expect(db.exec(sql)).rejects.toThrow(/permission denied/)
    }
    await expect(db.exec('select planner_private.snapshot_v4()')).rejects.toThrow(/permission denied/)
    await actor(ownerB)
    for (const table of tables) expect((await db.query(`select * from public.${table}`)).rows).toEqual([])
    await unchanged({ type: 'saveWeekPlan', value: week }, /PLAN_REFERENCE/)
    await unchanged({ type: 'saveWeekPlan', value: { ...week, entries: [{ ...entry, taskId: null, todoId: todo.id, goalType: 'todo', targetUnits: null, unitName: '' }] } }, /PLAN_REFERENCE/)
    await actor('', 'anon'); await expect(snapshot()).rejects.toThrow(/permission denied/)
    for (const table of tables) await expect(db.exec(`select * from public.${table}`)).rejects.toThrow(/permission denied/)
    await expect(write({ type: 'saveTodo', value: todo }, 0)).rejects.toThrow(/permission denied/)
    await actor()
  })
})
