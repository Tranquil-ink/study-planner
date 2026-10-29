import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessData, snapshotSchema, type WorkLogInput } from '../src/domain/model'
import { taskProgress } from '../src/domain/work-logs'
import { createBackup, parseBackup } from '../src/data/backup'
import { category, task, ownerA, ownerB, schedule } from './fixtures'
let db: PGlite
const oldRequest = randomUUID()
let beforeUpgrade: unknown
async function actor(id = ownerA, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${role}`)
}
async function snapshot() { return snapshotSchema.parse((await db.query<{ value: unknown }>('select public.planner_snapshot() value')).rows[0].value) }
async function write(command: unknown, revision: number, id = randomUUID()) { return (await db.query<{ value: unknown }>('select public.planner_mutate($1,$2,$3::jsonb) value', [id, revision, JSON.stringify(command)])).rows[0].value }
async function mutate(command: unknown) { return write(command, (await snapshot()).revision) }
async function receipt(id: string) { return (await db.query<{ value: unknown }>('select public.planner_receipt($1) value', [id])).rows[0].value }
const log: WorkLogInput = { id: randomUUID(), date: schedule.date, taskId: task.id, scheduleBlockId: schedule.id, titleSnapshot: task.title, actualMinutes: 80, progressDelta: '1.5', progressLabel: '2.2', note: '' }
async function unchanged(command: unknown, pattern?: RegExp) {
  const before = await snapshot(), id = randomUUID()
  const state = (await db.query('select * from public.planner_dataset_state')).rows
  const slots = (await db.query('select * from public.planner_schedule_slots order by slot_id')).rows
  await expect(write(command, before.revision, id)).rejects.toThrow(pattern)
  expect(await snapshot()).toEqual(before); expect(await receipt(id)).toBeNull()
  expect((await db.query('select * from public.planner_dataset_state')).rows).toEqual(state)
  expect((await db.query('select * from public.planner_schedule_slots order by slot_id')).rows).toEqual(slots)
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${ownerA}'),('${ownerB}');`)
  for (const file of ['202610170001_stage1.sql', '202610190001_stage2.sql', '202610210001_stage3.sql']) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
  await actor()
  await write({ type: 'saveCategory', value: category }, 0, oldRequest)
  await write({ type: 'saveTask', value: task }, 1)
  await write({ type: 'saveSchedule', value: { ...schedule, slotIds: [2, 3], endMinute: 660 } }, 2)
  beforeUpgrade = (await db.query<{ value: object }>('select public.planner_snapshot() value')).rows[0].value
  await db.exec('reset role'); await db.exec(await readFile('supabase/migrations/202610250001_stage4.sql', 'utf8')); await actor()
}, 30000)
afterAll(async () => { await db?.close() })
describe('阶段 4 PostgreSQL 事务与权限（本地引擎，非真实 Supabase）', () => {
  it('升级不改历史业务/时间/回执，revision +1 并添加空实际记录', async () => {
    const current = await snapshot()
    expect({ ...current, revision: 3, workLogs: undefined }).toEqual({ ...beforeUpgrade as object, workLogs: undefined })
    expect(current.revision).toBe(4); expect(current.workLogs).toEqual([])
    expect(await write({ type: 'saveCategory', value: category }, 0, oldRequest)).toEqual({ requestId: oldRequest, revision: 1 })
    await expect(write({ type: 'saveTask', value: task }, 3)).rejects.toThrow('REVISION_CONFLICT')
  })
  it('初始 8，新建 1.5 → 9.5，编辑 1 → 9，删除 → 8；稳定顺序与幂等回执', async () => {
    const before = await snapshot(), id = randomUUID(), cmd = { type: 'saveWorkLog', value: log }
    const result = await write(cmd, before.revision, id)
    expect(await write(cmd, before.revision, id)).toEqual(result)
    let current = await snapshot(); const order = current.workLogs[0].createdOrder
    expect(current.workLogs).toHaveLength(1); expect(taskProgress(current.tasks[0], current.workLogs).completedUnits).toBe('9.5')
    await expect(write({ ...cmd, value: { ...log, actualMinutes: 90 } }, before.revision, id)).rejects.toThrow('REQUEST_REUSED')
    await mutate({ type: 'saveWorkLog', value: { ...log, progressDelta: '1' } })
    current = await snapshot(); expect(taskProgress(current.tasks[0], current.workLogs).completedUnits).toBe('9'); expect(current.workLogs[0].createdOrder).toBe(order)
    const del = { type: 'removeWorkLog', value: { id: log.id } }, delId = randomUUID()
    const removed = await write(del, current.revision, delId); expect(await write(del, current.revision, delId)).toEqual(removed)
    current = await snapshot(); expect(taskProgress(current.tasks[0], current.workLogs)).toMatchObject({ completedUnits: '8', actualMinutes: 0 })
    await mutate(cmd); expect((await snapshot()).workLogs[0].createdOrder).toBeGreaterThan(order)
  })
  it('补记、零进度与临时事项；非法分钟/精度/类型/所有者/顺序均回滚', async () => {
    for (const patch of [{ actualMinutes: 0 }, { actualMinutes: 1.5 }, { actualMinutes: -1 }, { actualMinutes: 2147483648 }, { progressDelta: '-1' }, { progressDelta: '0.0000001' }, { progressDelta: 1 }, { progressDelta: null }, { taskId: null }, { createdOrder: 100 }, { owner_id: ownerB }, { scheduleBlockId: randomUUID() }, { date: '2026-02-30' }]) await unchanged({ type: 'saveWorkLog', value: { ...log, ...patch } })
    await mutate({ type: 'saveWorkLog', value: { ...log, id: randomUUID(), scheduleBlockId: null, progressDelta: '0', actualMinutes: 180 } })
    await mutate({ type: 'saveWorkLog', value: { ...log, id: randomUUID(), taskId: null, scheduleBlockId: null, progressDelta: null, titleSnapshot: '临时报告' } })
    const current = await snapshot(); expect(taskProgress(current.tasks[0], current.workLogs)).toMatchObject({ completedUnits: '9.5', actualMinutes: 260 })
  })
  it('总量校验覆盖新增/编辑/换任务/任务总量和初始量；同版本竞争仅一方成功', async () => {
    await unchanged({ type: 'saveWorkLog', value: { ...log, progressDelta: '32.000001' } }, /PROGRESS_LIMIT/)
    await unchanged({ type: 'saveTask', value: { ...task, totalUnits: '9' } }, /PROGRESS_LIMIT/)
    await unchanged({ type: 'saveTask', value: { ...task, initialCompletedUnits: '39' } }, /PROGRESS_LIMIT/)
    const revision = (await snapshot()).revision
    const results = await Promise.allSettled([write({ type: 'saveWorkLog', value: { ...log, id: randomUUID(), progressDelta: '30' } }, revision), write({ type: 'saveWorkLog', value: { ...log, id: randomUUID(), progressDelta: '30' } }, revision)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { message: 'REVISION_CONFLICT' } })
    await unchanged({ type: 'saveWorkLog', value: { ...log, id: randomUUID(), progressDelta: '1' } }, /PROGRESS_LIMIT/)
  })
  it('关联实际阻止合并拆分；移日保持实际日期，换任务/移除保留记录并解除关联', async () => {
    await unchanged({ type: 'splitSchedule', value: { id: schedule.id, copyPlanText: true } }, /SCHEDULE_HAS_LOGS/)
    const next = { ...schedule, id: randomUUID(), slotIds: [4], startMinute: 660, endMinute: 720 }
    await mutate({ type: 'saveSchedule', value: next })
    await unchanged({ type: 'mergeSchedules', value: { ids: [schedule.id, next.id], result: { ...schedule, slotIds: [2, 3, 4], endMinute: 720 }, contentConfirmed: true } }, /SCHEDULE_HAS_LOGS/)
    await mutate({ type: 'saveSchedule', value: { ...schedule, date: '2026-10-21' } })
    expect((await snapshot()).workLogs.find(l => l.id === log.id)?.date).toBe(log.date)
    await mutate({ type: 'saveSchedule', value: { ...schedule, taskId: null, title: '改后的临时安排' } })
    let current = await snapshot(); expect(current.workLogs.find(l => l.id === log.id)).toMatchObject({ taskId: task.id, scheduleBlockId: null, actualMinutes: 80 })
    await mutate({ type: 'saveSchedule', value: schedule })
    await mutate({ type: 'saveWorkLog', value: log })
    await mutate({ type: 'removeSchedule', value: { id: schedule.id } })
    current = await snapshot(); expect(current.workLogs.find(l => l.id === log.id)?.scheduleBlockId).toBeNull()
    expect(taskProgress(current.tasks[0], current.workLogs).completedUnits).toBe('39.5')
  })
  it('v4 恢复保留顺序/精确进度/脱离关联记录，错误或中断回滚，v3 清空实际且顺序不倒退', async () => {
    const before = await snapshot(), backup = createBackup(before), cmd = { type: 'restore', value: backup.data }, id = randomUUID()
    expect(parseBackup(JSON.stringify(backup)).backup.data).toEqual(businessData(before))
    await unchanged({ type: 'restore', value: { ...backup.data, workLogs: [...backup.data.workLogs, { ...backup.data.workLogs[0], id: randomUUID() }] } })
    await unchanged({ type: 'restore', value: { ...backup.data, tasks: [{ ...before.tasks[0], totalUnits: '9' }] } }, /PROGRESS_LIMIT/)
    await unchanged({ type: 'restore', value: { ...backup.data, workLogs: [{ ...backup.data.workLogs[0], scheduleBlockId: randomUUID() }] } }, /LOG_SCHEDULE_MISMATCH/)
    await db.exec('reset role'); await db.exec('alter table public.planner_work_logs add constraint injected_failure check(actual_minutes<>180) not valid'); await actor()
    await unchanged(cmd, /injected_failure/)
    await db.exec('reset role'); await db.exec('alter table public.planner_work_logs drop constraint injected_failure'); await actor()
    const result = await write(cmd, before.revision, id); expect(await write(cmd, before.revision, id)).toEqual(result)
    expect((await snapshot()).workLogs.map(l => [l.id, l.createdOrder, l.progressDelta, l.scheduleBlockId])).toEqual(before.workLogs.map(l => [l.id, l.createdOrder, l.progressDelta, l.scheduleBlockId]))
    await expect(write(cmd, before.revision)).rejects.toThrow('REVISION_CONFLICT')
    const { workLogs, ...old } = backup.data
    const migrated = parseBackup(JSON.stringify({ ...backup, schemaVersion: 3, data: old }))
    await mutate({ type: 'restore', value: migrated.backup.data }); expect((await snapshot()).workLogs).toEqual([])
    await mutate({ type: 'saveWorkLog', value: { ...log, scheduleBlockId: null } })
    expect((await snapshot()).workLogs[0].createdOrder).toBeGreaterThan(Math.max(...workLogs.map(l => l.createdOrder)))
  })
  it('匿名、跨账号、伪造所有者、表直写、私有函数、回执均隔离', async () => {
    for (const sql of [`insert into public.planner_work_logs(owner_id) values('${ownerA}')`, 'update public.planner_work_logs set actual_minutes=1', 'delete from public.planner_work_logs']) await expect(db.exec(sql)).rejects.toThrow(/permission denied/)
    await expect(db.query('select planner_private.put_work_log($1,$2)', [ownerA, JSON.stringify(log)])).rejects.toThrow(/permission denied/)
    await actor(ownerB); expect((await db.query('select * from public.planner_work_logs')).rows).toEqual([])
    await unchanged({ type: 'saveWorkLog', value: { ...log, scheduleBlockId: null } }, /foreign key/)
    await unchanged({ type: 'saveWorkLog', value: log }, /LOG_SCHEDULE_MISMATCH/)
    await unchanged({ type: 'removeWorkLog', value: { id: log.id } }, /WORK_LOG_MISSING/)
    expect(await receipt(oldRequest)).toBeNull()
    await actor('', 'anon'); await expect(snapshot()).rejects.toThrow(/permission denied/)
    await expect(db.exec('select * from public.planner_work_logs')).rejects.toThrow(/permission denied/)
    await expect(write({ type: 'saveWorkLog', value: log }, 0)).rejects.toThrow(/permission denied/)
    await actor()
  })
})
