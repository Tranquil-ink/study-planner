import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { snapshotSchema, type Command } from '../src/domain/model'
import { category, task, ownerA, ownerB, fixtureData } from './fixtures'
let db: PGlite
async function actor(id: string, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${role}`)
}
async function snapshot() { return (await db.query<{ value: unknown }>('select public.planner_snapshot() as value')).rows[0].value }
async function mutate(command: Command | unknown, rev: number, id = randomUUID()) {
  return (await db.query<{ value: { revision: number; requestId: string } }>('select public.planner_mutate($1,$2,$3::jsonb) as value', [id, rev, JSON.stringify(command)])).rows[0].value
}
beforeAll(async () => {
  db = new PGlite()
  // Auth claims are a local test fixture. This is PostgreSQL execution, NOT
  // verification of Supabase Auth, PostgREST or a deployed cloud project.
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${ownerA}'),('${ownerB}');`)
  await db.exec(await readFile('supabase/migrations/202610170001_stage1.sql', 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
describe('迁移在本地 PostgreSQL 引擎上的权限与事务检查', () => {
  it('匿名不能读任何表或调用任何公开 RPC', async () => {
    await actor('', 'anon')
    for (const table of ['categories','tasks','settings','dataset_state','operation_receipts']) await expect(db.query(`select * from public.planner_${table}`)).rejects.toThrow(/permission denied/)
    await expect(snapshot()).rejects.toThrow(/permission denied/)
    await expect(mutate({ type: 'saveCategory', value: category },0)).rejects.toThrow(/permission denied/)
    await expect(db.query('select public.planner_receipt($1)',[randomUUID()])).rejects.toThrow(/permission denied/)
  })
  it('首读初始化幂等、正常保存与稳定 ID 编辑，数据库校验数量', async () => {
    await actor(ownerA)
    expect(snapshotSchema.parse(await snapshot()).revision).toBe(0)
    expect(snapshotSchema.parse(await snapshot()).categories).toEqual([])
    expect(await mutate({ type: 'saveCategory', value: category },0)).toHaveProperty('revision',1)
    await mutate({ type: 'saveTask', value: task },1)
    await mutate({ type: 'saveTask', value: { ...task, initialCompletedUnits: '8.5' } },2)
    expect(snapshotSchema.parse(await snapshot()).tasks[0].initialCompletedUnits).toBe('8.5')
    await expect(mutate({ type: 'saveTask', value: { ...task, initialCompletedUnits: '40.000001' } },3)).rejects.toThrow('PROGRESS_LIMIT')
    expect(snapshotSchema.parse(await snapshot()).revision).toBe(3)
  })
  it('先去重后检查过期版本，同 ID 不同内容拒绝', async () => {
    const id = randomUUID(); const cmd = { type: 'saveTask', value: task } as const
    const receipt = await mutate(cmd,3,id)
    expect(await mutate(cmd,3,id)).toEqual(receipt)
    await expect(mutate({ ...cmd, value: { ...task, note: 'changed' } },3,id)).rejects.toThrow('REQUEST_REUSED')
    await expect(mutate(cmd,3)).rejects.toThrow('REVISION_CONFLICT')
    expect(snapshotSchema.parse(await snapshot()).tasks).toHaveLength(1)
  })
  it('表直写与私有函数不可调用，B 不能读取或引用 A 数据', async () => {
    await expect(db.query('update public.planner_dataset_state set revision=0')).rejects.toThrow(/permission denied/)
    await expect(db.query('delete from public.planner_categories')).rejects.toThrow(/permission denied/)
    await expect(db.query('select planner_private.lock_dataset($1)',[ownerA])).rejects.toThrow(/permission denied/)
    await actor(ownerB)
    for (const table of ['categories','tasks','settings','dataset_state','operation_receipts']) expect((await db.query(`select * from public.planner_${table} where owner_id=$1`,[ownerA])).rows).toEqual([])
    await snapshot()
    await expect(mutate({ type: 'saveTask', value: task },0)).rejects.toThrow(/foreign key/)
    await expect(mutate({ type: 'saveCategory', value: { ...category, owner_id: ownerA } },0)).rejects.toThrow('VALIDATION')
    expect(snapshotSchema.parse(await snapshot()).revision).toBe(0)
  })
  it('恢复中途外键失败回滚删除、插入、版本和回执', async () => {
    await actor(ownerA)
    const before = await snapshot(); const id = randomUUID()
    const bad = fixtureData(); bad.categories = []
    await expect(mutate({ type: 'restore', value: bad },4,id)).rejects.toThrow(/foreign key/)
    expect(await snapshot()).toEqual(before)
    expect((await db.query<{ result: unknown }>('select public.planner_receipt($1) as result',[id])).rows[0].result).toBeNull()
  })
  it('有效恢复原子替换、新版本拒绝旧表单；B 不受影响', async () => {
    const data = fixtureData(); data.tasks[0].archived = true
    const id = randomUUID(); const cmd = { type: 'restore', value: data } as const
    await mutate(cmd,4,id)
    await mutate(cmd,4,id)
    const current = snapshotSchema.parse(await snapshot())
    expect(current.revision).toBe(5); expect(current.tasks[0].archived).toBe(true)
    expect(current.tasks[0].createdAt).not.toBe(data.tasks[0].createdAt)
    await expect(mutate({ type: 'saveTask', value: task },4)).rejects.toThrow('REVISION_CONFLICT')
    await actor(ownerB); expect(snapshotSchema.parse(await snapshot()).tasks).toHaveLength(0)
  })
})
