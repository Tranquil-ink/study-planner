// Historical schema suite: adapt empty workLogs at the test boundary only.
// The production snapshot parser requires v4; stage-4 migration tests use it directly.
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessData, snapshotSchema } from '../src/domain/model'
import { createBackup, parseBackup } from '../src/data/backup'
import { audit, category, ownerA, ownerB, schedule, task } from './fixtures'
let db: PGlite
const oldRequest = randomUUID()
async function actor(id: string, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${role}`)
}
async function snapshot() { return snapshotSchema.parse({ ...(await db.query<{ value: Record<string, unknown> }>('select public.planner_snapshot() as value')).rows[0].value, workLogs: [] }) }
async function mutate(command: unknown, revision: number, id = randomUUID()) { return (await db.query<{ value: unknown }>('select public.planner_mutate($1,$2,$3::jsonb) as value', [id,revision,JSON.stringify(command, (key, value: unknown) => key === 'workLogs' ? undefined : value)])).rows[0].value }
async function receipt(id: string) { return (await db.query<{ value: unknown }>('select public.planner_receipt($1) as value',[id])).rows[0].value }
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${ownerA}'),('${ownerB}');`)
  await db.exec(await readFile('supabase/migrations/202610170001_stage1.sql','utf8'))
  await actor(ownerA)
  await mutate({ type: 'saveCategory', value: category },0,oldRequest)
  await mutate({ type: 'saveTask', value: task },1)
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/202610190001_stage2.sql','utf8'))
  await actor(ownerA)
},30000)
afterAll(async () => { await db?.close() })
describe('阶段 2 增量迁移及事务（本地 PostgreSQL；非云端并发证明）', () => {
  it('升级保留阶段 1 数据/回执，提高 revision 拒绝旧表单', async () => {
    const current = await snapshot()
    expect(current.revision).toBe(3); expect(current.tasks[0].id).toBe(task.id); expect(current.schedules).toEqual([])
    expect(await mutate({ type: 'saveCategory', value: category },0,oldRequest)).toEqual({ requestId: oldRequest, revision: 1 })
    await expect(mutate({ type: 'saveTask', value: task },2)).rejects.toThrow('REVISION_CONFLICT')
  })
  it('新增与幂等重试不增加进度；重复占用由数据库拒绝', async () => {
    const id = randomUUID(), cmd = { type: 'saveSchedule', value: schedule }
    const result = await mutate(cmd,3,id)
    expect(await mutate(cmd,3,id)).toEqual(result)
    await expect(mutate({ ...cmd, value: { ...schedule, note: '不同内容' } },3,id)).rejects.toThrow('REQUEST_REUSED')
    await expect(mutate({ ...cmd, value: { ...schedule, id: randomUUID() } },4)).rejects.toThrow(/planner_schedules_occupied/)
    const current = await snapshot()
    expect(current.revision).toBe(4); expect(current.schedules).toHaveLength(1); expect(current.tasks[0].initialCompletedUnits).toBe('8')
  })
  it('两个旧版本请求只有一个成功；失败输入未写入', async () => {
    const competing = [0,1].map(n => ({ type: 'saveSchedule', value: { ...schedule, id: randomUUID(), date: '2026-10-21', title: `竞争${n}`, taskId: null } }))
    // PGlite serializes execution. Real simultaneous sessions are covered by integration.ts.
    const results = await Promise.allSettled(competing.map(c => mutate(c,4)))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { message: 'REVISION_CONFLICT' } })
    expect((await snapshot()).schedules).toHaveLength(2)
  })
  it('稳定任务 ID 跟随改名/分类颜色/归档，日程编辑和移除幂等', async () => {
    await mutate({ type: 'saveTask', value: { ...task, title: '新的任务名', archived: true } },5)
    await mutate({ type: 'saveCategory', value: { ...category, color: '#ff0000' } },6)
    await mutate({ type: 'saveSchedule', value: { ...schedule, plannedRangeText: '2.2～2.4', slotIds: [9], startMinute: 1110, endMinute: 1215 } },7)
    const current = await snapshot(), row = current.schedules.find(s => s.id === schedule.id)!
    expect(row.taskId).toBe(task.id); expect(row.endMinute-row.startMinute).toBe(105)
    expect(current.tasks[0].title).toBe('新的任务名'); expect(current.categories[0].color).toBe('#ff0000')
    const id = randomUUID(), cmd = { type: 'removeSchedule', value: { id: row.id } }
    expect(await mutate(cmd,8,id)).toEqual(await mutate(cmd,8,id))
    expect((await snapshot()).tasks).toHaveLength(1)
    await expect(mutate(cmd,9)).rejects.toThrow('SCHEDULE_MISSING')
  })
  it('数据库拒绝无效日期、伪造分钟、合并、多余所有者、无效任务引用', async () => {
    for (const patch of [{ date: '2026-02-30' },{ startMinute: 541 },{ slotIds: [2,3] },{ slotTemplateVersion: 2 },{ taskId: randomUUID() },{ owner_id: ownerB },{ slotIds: [null] }]) await expect(mutate({ type: 'saveSchedule', value: { ...schedule, ...patch } },9)).rejects.toThrow()
    expect((await snapshot()).revision).toBe(9)
  })
  it('新增表及私有函数权限、越权关联与回执均隔离', async () => {
    for (const query of ['insert into public.planner_schedules(owner_id) values($1)','update public.planner_schedules set owner_id=$1','delete from public.planner_schedules where owner_id=$1']) await expect(db.query(query,[ownerA])).rejects.toThrow(/permission denied/)
    await expect(db.query('select planner_private.put_schedule($1,$2::jsonb)',[ownerA,JSON.stringify(schedule)])).rejects.toThrow(/permission denied/)
    await actor('', 'anon')
    await expect(db.query('select * from public.planner_schedules')).rejects.toThrow(/permission denied/)
    await expect(mutate({ type: 'saveSchedule', value: schedule },0)).rejects.toThrow(/permission denied/)
    await actor(ownerB)
    expect((await db.query('select * from public.planner_schedules')).rows).toEqual([])
    await expect(mutate({ type: 'saveSchedule', value: schedule },0)).rejects.toThrow(/foreign key/)
    await expect(mutate({ type: 'saveSchedule', value: { ...schedule, owner_id: ownerA } },0)).rejects.toThrow('VALIDATION')
    expect(await receipt(oldRequest)).toBeNull()
    await actor(ownerA)
  })
  it('恢复碰撞或悬空日程在插入阶段失败，整笔回滚旧数据/版本/回执', async () => {
    const before = await snapshot(), data = businessData(before)
    for (const rows of [[{ ...schedule, ...audit, taskId: randomUUID() }],[{ ...schedule, ...audit },{ ...schedule, ...audit, id: randomUUID() }]]) {
      const id = randomUUID()
      await expect(mutate({ type: 'restore', value: { ...data, schedules: rows } },before.revision,id)).rejects.toThrow()
      expect(await snapshot()).toEqual(before); expect(await receipt(id)).toBeNull()
    }
    await expect(mutate({ type: 'restore', value: { categories: data.categories, tasks: data.tasks, settings: data.settings } },before.revision)).rejects.toThrow('VALIDATION')
    expect(await snapshot()).toEqual(before)
  })
  it('v2 完整恢复/重试保留业务与快照，拒绝预检后并发和恢复后的旧表单', async () => {
    const before = await snapshot(), backup = createBackup(before)
    await mutate({ type: 'saveSchedule', value: schedule },9)
    await expect(mutate({ type: 'restore', value: backup.data },9)).rejects.toThrow('REVISION_CONFLICT')
    const id = randomUUID(), cmd = { type: 'restore', value: backup.data }
    expect(await mutate(cmd,10,id)).toEqual(await mutate(cmd,10,id))
    const current = await snapshot()
    expect(current.revision).toBe(11)
    expect(current.schedules.map(s => ({ ...s, createdAt: '', updatedAt: '' }))).toEqual(before.schedules.map(s => ({ ...s, createdAt: '', updatedAt: '' })))
    await expect(mutate({ type: 'saveSchedule', value: schedule },10)).rejects.toThrow('REVISION_CONFLICT')
  })
  it('有效阶段 1 备份迁移后原子恢复，清空日程且不影响另一个账号', async () => {
    const before = await snapshot(), backup = createBackup(before)
    const old = { ...backup, schemaVersion: 1, data: { categories: backup.data.categories, tasks: backup.data.tasks, settings: backup.data.settings } }
    const migrated = parseBackup(JSON.stringify(old))
    await mutate({ type: 'restore', value: migrated.backup.data },11)
    expect((await snapshot()).schedules).toEqual([])
    expect((await snapshot()).tasks[0].initialCompletedUnits).toBe('8')
    await actor(ownerB); expect((await snapshot()).tasks).toEqual([])
  })
})
