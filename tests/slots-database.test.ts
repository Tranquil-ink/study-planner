import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessData, snapshotSchema } from '../src/domain/model'
import { createBackup, parseBackup } from '../src/data/backup'
import { audit, category, ownerA, ownerB, schedule, task } from './fixtures'
let db: PGlite
const oldReceipt = randomUUID()
async function actor(id = ownerA, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${role}`)
}
async function snapshot() { return snapshotSchema.parse((await db.query<{value: unknown}>('select public.planner_snapshot() value')).rows[0].value) }
async function write(command: unknown, revision: number, id = randomUUID()) { return (await db.query<{value: unknown}>('select public.planner_mutate($1,$2,$3::jsonb) value',[id,revision,JSON.stringify(command)])).rows[0].value }
async function mutate(command: unknown, id = randomUUID()) { return write(command,(await snapshot()).revision,id) }
async function receipt(id: string) { return (await db.query<{value: unknown}>('select public.planner_receipt($1) value',[id])).rows[0].value }
const base = { ...schedule, slotTemplateVersion: 2 as const }
const second = { ...base, id: randomUUID(), slotIds: [3], startMinute: 600, endMinute: 660, note: '不同备注' }
const merged = { ...base, slotIds: [2,3], endMinute: 660, note: '用户明确选择' }
const merge = { type: 'mergeSchedules', value: { ids: [base.id,second.id], result: merged, contentConfirmed: true } }
async function occupancy() { return (await db.query('select * from public.planner_schedule_slots order by date,slot_id')).rows }
async function unchanged(command: unknown, match?: RegExp) {
  const before=await snapshot(), slots=await occupancy(), cells=(await db.query('select * from public.planner_schedule_cells order by date,cell_id')).rows, id=randomUUID()
  await expect(write(command,before.revision,id)).rejects.toThrow(match)
  expect(await snapshot()).toEqual(before);expect(await occupancy()).toEqual(slots);expect((await db.query('select * from public.planner_schedule_cells order by date,cell_id')).rows).toEqual(cells);expect(await receipt(id)).toBeNull()
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${ownerA}'),('${ownerB}');`)
  for(const migration of ['202610170001_stage1','202610190001_stage2']) await db.exec(await readFile(`supabase/migrations/${migration}.sql`,'utf8'))
  await actor();await mutate({type:'saveCategory',value:category});await mutate({type:'saveTask',value:task})
  await mutate({type:'saveSchedule',value:{...schedule,date:'2026-10-19',slotIds:[9],startMinute:1110,endMinute:1215}},oldReceipt)
  await db.exec('reset role');await db.exec(await readFile('supabase/migrations/202610210001_stage3.sql','utf8'));await actor()
},30000)
afterAll(async()=>{await db?.close()})
describe('阶段 3 数据库约束与原子操作（本地 PostgreSQL）',()=>{
  it('升级保留历史 105 分钟、稳定 ID/回执，回填占位并拒绝旧版本',async()=>{
    const s=await snapshot();expect(s.revision).toBe(4);expect(s.schedules[0].endMinute).toBe(1215)
    expect(await receipt(oldReceipt)).toMatchObject({revision:3});
    expect(await write({type:'saveSchedule',value:{...schedule,date:'2026-10-19',slotIds:[9],startMinute:1110,endMinute:1215}},2,oldReceipt)).toMatchObject({revision:3});expect(await occupancy()).toHaveLength(1)
    await expect(write({type:'saveTask',value:task},3)).rejects.toThrow('REVISION_CONFLICT')
    await unchanged({type:'saveSchedule',value:{...base,id:randomUUID(),date:'2026-10-19',slotIds:[10],startMinute:1200,endMinute:1260}},/planner_schedule_cells/)
    await mutate({type:'removeSchedule',value:{id:schedule.id}})
  })
  it('新模板三块 90/60/60；合并 210 后拆分守恒并明确复制文字',async()=>{
    const night={...base,slotIds:[9,10,11],startMinute:1110,endMinute:1320}
    await mutate({type:'saveSchedule',value:night})
    const before=await snapshot(),id=randomUUID(),cmd={type:'splitSchedule',value:{id:night.id,copyPlanText:true}}
    const result=await write(cmd,before.revision,id);expect(await write(cmd,before.revision,id)).toEqual(result)
    const rows=(await snapshot()).schedules;expect(rows.map(s=>s.endMinute-s.startMinute)).toEqual([90,60,60]);expect(rows.every(s=>s.plannedRangeText===night.plannedRangeText)).toBe(true)
    const cmdMerge={type:'mergeSchedules',value:{ids:rows.map(s=>s.id),result:night,contentConfirmed:true}}
    await mutate(cmdMerge);expect((await snapshot()).schedules).toHaveLength(1)
    await mutate({type:'removeSchedule',value:{id:night.id}});expect(await occupancy()).toEqual([])
  })
  it('09–11 合并/拆分、稳定任务引用、幂等与不同 request 内容拒绝',async()=>{
    await mutate({type:'saveSchedule',value:base});await mutate({type:'saveSchedule',value:second})
    await unchanged({...merge,value:{...merge.value,contentConfirmed:false}})
    const revision=(await snapshot()).revision,id=randomUUID(),result=await write(merge,revision,id)
    expect(await write(merge,revision,id)).toEqual(result)
    await expect(write({...merge,value:{...merge.value,result:{...merged,note:'变了'}}},revision,id)).rejects.toThrow('REQUEST_REUSED')
    expect((await snapshot()).schedules[0]).toMatchObject({taskId:task.id,startMinute:540,endMinute:660,slotIds:[2,3]})
    expect(await occupancy()).toHaveLength(2)
    await mutate({type:'splitSchedule',value:{id:base.id,copyPlanText:false}})
    const rows=(await snapshot()).schedules;expect(rows.map(s=>s.endMinute-s.startMinute)).toEqual([60,60]);expect(rows[1].note).toBe('');expect(rows[0].note).toBe('用户明确选择')
    expect((await snapshot()).tasks[0].initialCompletedUnits).toBe('8')
  })
  it('非连续、跨日、跨午休/晚饭、重复时段与未知模板均拒绝',async()=>{
    for(const patch of [{slotIds:[4,5],startMinute:660,endMinute:840},{slotIds:[8,9],startMinute:960,endMinute:1200},{slotIds:[2,2],endMinute:600},{slotIds:[3,2]},{slotIds:[2,4],endMinute:720},{slotTemplateVersion:3}]) await unchanged({type:'saveSchedule',value:{...merged,...patch}})
    const rows=(await snapshot()).schedules
    await mutate({type:'saveSchedule',value:{...second,id:rows[1].id,date:'2026-10-21'}})
    await unchanged({...merge,value:{...merge.value,ids:rows.map(s=>s.id)}},/NOT_CONTIGUOUS/)
    await mutate({type:'saveSchedule',value:{...second,id:rows[1].id}})
  })
  it('编辑/移动冲突失败回滚占位，成功释放旧占位；移除释放全部',async()=>{
    const rows=(await snapshot()).schedules
    await unchanged({type:'saveSchedule',value:{...merged,id:rows[1].id}},/planner_schedule_slots/)
    await mutate({type:'saveSchedule',value:{...base,id:rows[1].id,date:'2026-10-21'}})
    await mutate({type:'saveSchedule',value:second})
    await mutate({type:'removeSchedule',value:{id:rows[1].id}})
    expect(await occupancy()).toHaveLength(2)
  })
  it('合并失败不留下日程删除/占位/版本/回执；并发旧版本只成功一方',async()=>{
    await unchanged({...merge,value:{...merge.value,result:{...merged,taskId:randomUUID()}}},/foreign key/)
    const revision=(await snapshot()).revision
    const results=await Promise.allSettled([write(merge,revision),write({type:'saveSchedule',value:{...second,note:'竞争'}},revision)])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{message:'REVISION_CONFLICT'}})
  })
  it('拆分第二块插入失败，第一块/版本/占位/成功回执全部回滚',async()=>{
    await db.exec('reset role')
    await db.exec('alter table public.planner_schedule_slots add constraint injected_failure check(slot_id<>3) not valid')
    await actor()
    await unchanged({type:'splitSchedule',value:{id:base.id,copyPlanText:true}},/injected_failure/)
    await db.exec('reset role');await db.exec('alter table public.planner_schedule_slots drop constraint injected_failure');await actor()
  })
  it('v3 完整恢复守恒、错误恢复回滚、预检/旧表单冲突、v2 迁移保留历史快照',async()=>{
    const before=await snapshot(),backup=createBackup(before)
    expect(parseBackup(JSON.stringify(backup)).backup.data).toEqual(businessData(before))
    await unchanged({type:'restore',value:{...backup.data,schedules:[...backup.data.schedules,{...backup.data.schedules[0],id:randomUUID()}]}})
    const id=randomUUID(),cmd={type:'restore',value:backup.data},result=await write(cmd,before.revision,id)
    expect(await write(cmd,before.revision,id)).toEqual(result)
    await expect(write(cmd,before.revision)).rejects.toThrow('REVISION_CONFLICT')
    const v2={...backup,schemaVersion:2,data:{...backup.data,schedules:[{...schedule,...audit,slotIds:[9],startMinute:1110,endMinute:1215}]}}
    const migrated=parseBackup(JSON.stringify(v2));expect(migrated.sourceVersion).toBe(2)
    await mutate({type:'restore',value:migrated.backup.data})
    expect((await snapshot()).schedules[0].endMinute).toBe(1215);expect(await occupancy()).toHaveLength(1)
  })
  it('历史晚间合并拆分仍为 105+105，白天跨模板合并保留时间',async()=>{
    const current=await snapshot(),row=current.schedules[0]
    const {createdAt: _created,updatedAt: _updated,...first}=row
    void _created;void _updated
    const next={...first,id:randomUUID(),slotIds:[10],startMinute:1215,endMinute:1320}
    await mutate({type:'saveSchedule',value:next})
    await mutate({type:'mergeSchedules',value:{ids:[row.id,next.id],result:{...first,slotIds:[9,10],endMinute:1320},contentConfirmed:true}})
    await mutate({type:'splitSchedule',value:{id:row.id,copyPlanText:true}})
    expect((await snapshot()).schedules.map(s=>s.endMinute-s.startMinute)).toEqual([105,105])
    await mutate({type:'saveSchedule',value:{...schedule,date:'2026-10-22'}})
    const secondDay={...second,date:'2026-10-22'}
    await mutate({type:'saveSchedule',value:secondDay})
    await mutate({type:'mergeSchedules',value:{ids:[schedule.id,second.id],result:{...merged,slotTemplateVersion:1,date:'2026-10-22'},contentConfirmed:true}})
    expect((await snapshot()).schedules.find(s=>s.date==='2026-10-22')?.endMinute).toBe(660)
  })
  it('所有支持表 RLS、匿名/直写/私有函数及越权操作保护',async()=>{
    for(const table of ['schedule_slots','schedule_cells']) {
      for(const sql of [`insert into public.planner_${table}(owner_id) values('${ownerA}')`,`update public.planner_${table} set owner_id='${ownerB}'`,`delete from public.planner_${table}`]) await expect(db.exec(sql)).rejects.toThrow(/permission denied/)
    }
    await expect(db.query('select planner_private.split_schedule($1,$2)',[ownerA,JSON.stringify({id:schedule.id,copyPlanText:true})])).rejects.toThrow(/permission denied/)
    await actor(ownerB)
    for(const table of ['schedule_slots','schedule_cells']) expect((await db.query(`select * from public.planner_${table}`)).rows).toEqual([])
    await unchanged({type:'splitSchedule',value:{id:schedule.id,copyPlanText:true}},/SCHEDULE_MISSING/)
    await actor('','anon')
    for(const table of ['schedule_slots','schedule_cells']) await expect(db.exec(`select * from public.planner_${table}`)).rejects.toThrow(/permission denied/)
    await actor()
  })
})
