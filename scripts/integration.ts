// Destructive checks are restricted to two NEW, disposable, empty test accounts.
// Never run against the owner's everyday project/account. No admin key required.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const required = ['SUPABASE_TEST_URL','SUPABASE_TEST_PUBLIC_KEY','SUPABASE_TEST_PROJECT_REF','SUPABASE_TEST_EMAIL_A','SUPABASE_TEST_PASSWORD_A','SUPABASE_TEST_EMAIL_B','SUPABASE_TEST_PASSWORD_B']
if (required.some(key => !process.env[key]) || process.env.SUPABASE_TEST_ACK !== 'isolated-disposable') {
  console.error('未运行：需要独立 Supabase 测试项目、两个空测试账号和 SUPABASE_TEST_ACK=isolated-disposable；详见 docs/SUPABASE.md。')
  process.exit(2)
}
const env = process.env as Record<string,string>
assert.equal(new URL(env.SUPABASE_TEST_URL).hostname, `${env.SUPABASE_TEST_PROJECT_REF}.supabase.co`, '测试项目引用与 URL 不符')
assert.notEqual(env.SUPABASE_TEST_EMAIL_A, env.SUPABASE_TEST_EMAIL_B)
let loseResponse = false
let offline = false
const phone = createClient(env.SUPABASE_TEST_URL,env.SUPABASE_TEST_PUBLIC_KEY,{
  auth: { persistSession:false,autoRefreshToken:false },
  global: { fetch: async (url,init) => {
    if (offline) throw new TypeError('test offline')
    const result = await fetch(url,{ ...init, signal:AbortSignal.timeout(20000) })
    if (loseResponse && String(url).endsWith('/rpc/planner_mutate')) {
      loseResponse=false
      assert.equal(result.ok,true)
      await result.text()
      throw new TypeError('test lost response after actual commit')
    }
    return result
  } },
})
const client = () => createClient(env.SUPABASE_TEST_URL,env.SUPABASE_TEST_PUBLIC_KEY,{ auth:{ persistSession:false,autoRefreshToken:false }, global:{ fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)}) } })
const desktop = client(), other = client(), anonymous = client()
async function login(c: SupabaseClient,email:string,password:string) {
  const result = await c.auth.signInWithPassword({email,password})
  assert.equal(result.error,null,'测试账号登录失败（不输出凭据）')
  assert.ok(result.data.user)
  return result.data.user.id
}
async function snapshot(c: SupabaseClient) {
  const result = await c.rpc('planner_snapshot'); assert.equal(result.error,null,'读取 RPC 失败')
  return result.data
}
const command = (type:string,value:unknown) => ({type,value})
const write = (c:SupabaseClient, revision:number, cmd:unknown, requestId=randomUUID()) => c.rpc('planner_mutate',{p_request_id:requestId,p_expected_revision:revision,p_command:cmd})
const tables = ['categories','tasks','schedules','schedule_slots','schedule_cells','work_logs','settings','dataset_state','operation_receipts']
let cleanupReady = false
let initial: Awaited<ReturnType<typeof snapshot>>
try {
  const userA = await login(phone,env.SUPABASE_TEST_EMAIL_A,env.SUPABASE_TEST_PASSWORD_A)
  assert.equal(await login(desktop,env.SUPABASE_TEST_EMAIL_A,env.SUPABASE_TEST_PASSWORD_A),userA)
  const userB = await login(other,env.SUPABASE_TEST_EMAIL_B,env.SUPABASE_TEST_PASSWORD_B)
  assert.notEqual(userA,userB)
  initial = await snapshot(phone)
  const initialB = await snapshot(other)
  assert.equal(initial.categories.length+initial.tasks.length+initial.schedules.length+initial.workLogs.length,0,'拒绝测试：A 账号非空')
  assert.equal(initialB.categories.length+initialB.tasks.length+initialB.schedules.length+initialB.workLogs.length,0,'拒绝测试：B 账号非空')
  cleanupReady = true
  let revision = initial.revision
  const category = {id:randomUUID(),name:'虚构集成测试分类',color:'#32796b',archived:false}
  const task = {id:randomUUID(),categoryId:category.id,title:'虚构理论力学',unitName:'节',totalUnits:'40',initialCompletedUnits:'8',initialProgressLabel:'2.1.1',note:'',archived:false}
  assert.equal((await write(phone,revision++,command('saveCategory',category))).error,null)
  assert.equal((await write(phone,revision++,command('saveTask',task))).error,null)
  assert.equal((await snapshot(desktop)).tasks[0].initialProgressLabel,'2.1.1')
  assert.equal((await write(desktop,revision++,command('saveTask',{...task,note:'电脑修改'}))).error,null)
  assert.equal((await snapshot(phone)).tasks[0].note,'电脑修改')
  console.log('通过：真实 Auth 双会话、手机→电脑及电脑→手机读写（API，会话标签不代表实机）。')
  for (const table of tables) {
    assert.ok((await anonymous.from(`planner_${table}`).select('*')).error,`匿名可读取 ${table}`)
    const denied = await other.from(`planner_${table}`).select('*').eq('owner_id',userA)
    assert.equal(denied.error,null); assert.deepEqual(denied.data,[])
    assert.ok((await phone.from(`planner_${table}`).insert({owner_id:userB})).error)
    assert.ok((await phone.from(`planner_${table}`).update({owner_id:userB}).eq('owner_id',userA)).error)
    assert.ok((await phone.from(`planner_${table}`).delete().eq('owner_id',userA)).error)
  }
  assert.ok((await anonymous.rpc('planner_snapshot')).error)
  assert.ok((await anonymous.rpc('planner_receipt',{p_request_id:randomUUID()})).error)
  assert.ok((await write(anonymous,0,command('saveCategory',category))).error)
  assert.ok((await write(other,initialB.revision,command('saveCategory',{...category,owner_id:userA}))).error)
  assert.ok((await write(other,initialB.revision,command('saveTask',task))).error)
  console.log('通过：全部表的匿名/跨账号读取、伪造所有者、越权引用、直接写表与匿名 RPC。')
  const concurrent = await Promise.all([
    write(phone,revision,command('saveTask',{...task,note:'并发甲'})),
    write(desktop,revision,command('saveTask',{...task,note:'并发乙'})),
  ])
  assert.equal(concurrent.filter(r=>!r.error).length,1)
  assert.equal(concurrent.find(r=>r.error)?.error?.message,'REVISION_CONFLICT'); revision++
  const requestId = randomUUID(), stable = command('saveTask',{...task,note:'响应丢失案例'})
  loseResponse = true
  assert.ok((await write(phone,revision,stable,requestId)).error)
  const receipt = await phone.rpc('planner_receipt',{p_request_id:requestId})
  assert.equal(receipt.error,null); assert.equal(receipt.data.revision,revision+1)
  const otherReceipt = await other.rpc('planner_receipt',{p_request_id:requestId})
  assert.equal(otherReceipt.error,null); assert.equal(otherReceipt.data,null)
  const retry = await write(phone,revision,stable,requestId)
  assert.equal(retry.error,null); assert.equal(retry.data.revision,revision+1)
  assert.equal((await write(phone,revision,command('saveTask',task),requestId)).error?.message,'REQUEST_REUSED')
  revision++
  console.log('通过：真实并发冲突、已提交响应丢失、回执隔离、原请求幂等重试。')
  const beforeFailure = await snapshot(phone)
  offline = true
  assert.ok((await phone.rpc('planner_snapshot')).error)
  assert.ok((await write(phone,revision,command('saveTask',task))).error)
  offline = false
  assert.deepEqual(await snapshot(phone),beforeFailure)
  const broken = {categories:[],tasks:beforeFailure.tasks,schedules:beforeFailure.schedules,workLogs:beforeFailure.workLogs,settings:beforeFailure.settings}
  assert.ok((await write(phone,revision,command('restore',broken))).error)
  assert.deepEqual(await snapshot(phone),beforeFailure)
  const restoreId = randomUUID(), restored = {categories:beforeFailure.categories,tasks:beforeFailure.tasks,schedules:beforeFailure.schedules,workLogs:beforeFailure.workLogs,settings:beforeFailure.settings}
  assert.equal((await write(phone,revision,command('restore',restored),restoreId)).error,null)
  assert.equal((await write(phone,revision,command('restore',restored),restoreId)).error,null)
  assert.equal((await write(desktop,revision,command('saveTask',task))).error?.message,'REVISION_CONFLICT'); revision++
  const restoredSnapshot = await snapshot(desktop)
  assert.equal(restoredSnapshot.revision,revision)
  assert.deepEqual(restoredSnapshot.tasks.map((t: Record<string,unknown>)=>({id:t.id,title:t.title,note:t.note})),beforeFailure.tasks.map((t:Record<string,unknown>)=>({id:t.id,title:t.title,note:t.note})))
  assert.equal((await snapshot(other)).tasks.length,0)
  console.log('通过：读取失败、提交前断网、恢复中途回滚、完整恢复重试、恢复后的旧表单拒绝。')
  // Stage 2: real independent HTTP sessions contend under PostgreSQL's account lock.
  const schedule = {id:randomUUID(),date:'2026-10-20',slotTemplateVersion:1,slotIds:[2],startMinute:540,endMinute:600,taskId:task.id,title:task.title,plannedRangeText:'2.1～2.3',note:'虚构日程'}
  const firstScheduleId=randomUUID(),firstScheduleCommand=command('saveSchedule',schedule)
  loseResponse=true
  assert.ok((await write(phone,revision,firstScheduleCommand,firstScheduleId)).error)
  assert.equal((await phone.rpc('planner_receipt',{p_request_id:firstScheduleId})).data?.revision,revision+1)
  assert.equal((await write(phone,revision,firstScheduleCommand,firstScheduleId)).error,null);revision++
  assert.equal((await snapshot(desktop)).schedules[0].plannedRangeText,'2.1～2.3')
  assert.equal((await snapshot(desktop)).tasks[0].initialCompletedUnits,'8')
  assert.equal((await write(desktop,revision++,command('saveSchedule',{...schedule,plannedRangeText:'2.2～2.4'}))).error,null)
  assert.equal((await snapshot(phone)).schedules[0].plannedRangeText,'2.2～2.4')
  assert.ok((await write(phone,revision,command('saveSchedule',{...schedule,id:randomUUID()}))).error,'数据库允许重复占用')
  assert.equal((await snapshot(phone)).revision,revision)
  const contenders=await Promise.all([phone,desktop].map((c,i)=>write(c,revision,command('saveSchedule',{...schedule,id:randomUUID(),slotIds:[9],startMinute:1110,endMinute:1215,taskId:null,title:`临时报告${i}`}))))
  assert.equal(contenders.filter(r=>!r.error).length,1)
  assert.equal(contenders.find(r=>r.error)?.error?.message,'REVISION_CONFLICT');revision++
  const concurrentSchedules=(await snapshot(phone)).schedules
  assert.equal(concurrentSchedules.length,2)
  assert.equal(concurrentSchedules.find((s:Record<string,unknown>)=>s.taskId===null).endMinute-concurrentSchedules.find((s:Record<string,unknown>)=>s.taskId===null).startMinute,105)
  assert.ok((await write(other,initialB.revision,command('saveSchedule',schedule))).error,'跨账号任务引用未拒绝')
  assert.ok((await write(other,initialB.revision,command('saveSchedule',{...schedule,owner_id:userA}))).error)
  for(const patch of [{date:'2026-02-30'},{startMinute:541},{slotIds:[2,3]},{slotTemplateVersion:3},{taskId:randomUUID()}]) assert.ok((await write(phone,revision,command('saveSchedule',{...schedule,...patch}))).error)
  const beforeScheduleFailure=await snapshot(phone)
  offline=true
  assert.ok((await phone.rpc('planner_snapshot')).error)
  assert.ok((await write(phone,revision,command('saveSchedule',{...schedule,note:'不得写入'}))).error)
  offline=false
  assert.deepEqual(await snapshot(phone),beforeScheduleFailure)
  console.log('通过：日程双向读写、响应丢失幂等、数据库重复占用、真实双会话竞争、临时 105 分钟、跨账号拒绝、非法日期/快照与断网；初始进度不变。')
  const scheduleData={categories:beforeScheduleFailure.categories,tasks:beforeScheduleFailure.tasks,schedules:beforeScheduleFailure.schedules,workLogs:beforeScheduleFailure.workLogs,settings:beforeScheduleFailure.settings}
  for(const schedules of [[{...beforeScheduleFailure.schedules[0],taskId:randomUUID()}],[beforeScheduleFailure.schedules[0],{...beforeScheduleFailure.schedules[0],id:randomUUID()}]]) {
    const failedId=randomUUID()
    assert.ok((await write(phone,revision,command('restore',{...scheduleData,schedules}),failedId)).error)
    assert.deepEqual(await snapshot(phone),beforeScheduleFailure)
    assert.equal((await phone.rpc('planner_receipt',{p_request_id:failedId})).data,null)
  }
  const scheduleRestoreId=randomUUID()
  assert.equal((await write(phone,revision,command('restore',scheduleData),scheduleRestoreId)).error,null)
  assert.equal((await write(phone,revision,command('restore',scheduleData),scheduleRestoreId)).error,null)
  assert.equal((await write(desktop,revision,command('saveSchedule',schedule))).error?.message,'REVISION_CONFLICT');revision++
  const afterRestore=await snapshot(desktop)
  const businessSchedules=(rows:Record<string,unknown>[])=>rows.map(s=>({...s,createdAt:null,updatedAt:null}))
  assert.deepEqual(businessSchedules(afterRestore.schedules),businessSchedules(scheduleData.schedules))
  // Preflight base is invalidated by another device's edit before restore.
  assert.equal((await write(desktop,revision,command('saveSchedule',{...schedule,note:'预检后更新'}))).error,null)
  assert.equal((await write(phone,revision,command('restore',scheduleData))).error?.message,'REVISION_CONFLICT');revision++
  const deleteId=randomUUID(),deleteCommand=command('removeSchedule',{id:schedule.id})
  assert.equal((await write(phone,revision,deleteCommand,deleteId)).error,null)
  assert.equal((await write(phone,revision,deleteCommand,deleteId)).error,null);revision++
  assert.equal((await snapshot(desktop)).schedules.length,1)
  // Canonical output of validated v1 -> v2 migration (parser covered by unit tests).
  const migratedStage1={categories:scheduleData.categories,tasks:scheduleData.tasks,settings:scheduleData.settings,schedules:[],workLogs:[]}
  assert.equal((await write(phone,revision,command('restore',migratedStage1))).error,null);revision++
  assert.equal((await snapshot(desktop)).schedules.length,0)
  assert.equal((await snapshot(desktop)).tasks[0].initialCompletedUnits,'8')
  assert.equal((await snapshot(other)).schedules.length,0)
  console.log('通过：含日程恢复中途失败全部回滚、完整快照恢复/重试、预检后并发拒绝、恢复后旧表单拒绝、移除幂等及阶段 1 迁移输出的云端原子恢复。')
  // Stage 3: real independent Supabase sessions; every operation is one RPC.
  const morningA={...schedule,id:randomUUID(),slotTemplateVersion:2}
  const morningB={...morningA,id:randomUUID(),slotIds:[3],startMinute:600,endMinute:660,note:'明确不同内容'}
  for(const value of [morningA,morningB]) assert.equal((await write(phone,revision++,command('saveSchedule',value))).error,null)
  const morningMerged={...morningA,slotIds:[2,3],endMinute:660,note:'用户明确选择后的内容'}
  const mergeMorning=command('mergeSchedules',{ids:[morningA.id,morningB.id],result:morningMerged,contentConfirmed:true})
  const beforeMerge=await snapshot(phone)
  for(const cmd of [command('mergeSchedules',{ids:[morningA.id,morningB.id],result:morningMerged,contentConfirmed:false}),command('mergeSchedules',{ids:[morningA.id,morningB.id],result:{...morningMerged,taskId:randomUUID()},contentConfirmed:true})]) {
    const id=randomUUID();assert.ok((await write(phone,revision,cmd,id)).error)
    assert.deepEqual(await snapshot(phone),beforeMerge)
    assert.equal((await phone.rpc('planner_receipt',{p_request_id:id})).data,null)
  }
  const mergeId=randomUUID();loseResponse=true
  assert.ok((await write(phone,revision,mergeMorning,mergeId)).error)
  assert.equal((await write(desktop,revision,mergeMorning,mergeId)).error,null);revision++
  assert.equal((await snapshot(phone)).schedules.length,1)
  assert.equal((await snapshot(phone)).schedules[0].endMinute-(await snapshot(phone)).schedules[0].startMinute,120)
  const occupied=await phone.from('planner_schedule_slots').select('*');assert.equal(occupied.error,null);assert.equal(occupied.data?.length,2)
  // Split and competing move start from the same revision; exactly one commits.
  const splitMorning=command('splitSchedule',{id:morningA.id,copyPlanText:true})
  const splitRace=await Promise.all([write(phone,revision,splitMorning),write(desktop,revision,command('saveSchedule',{...morningMerged,date:'2026-10-22'}))])
  assert.equal(splitRace.filter(r=>!r.error).length,1)
  assert.equal(splitRace.find(r=>r.error)?.error?.message,'REVISION_CONFLICT');revision++
  if(splitRace[0].error) {assert.equal((await write(phone,revision++,splitMorning)).error,null)}
  const splitRows=(await snapshot(phone)).schedules
  assert.equal(splitRows.length,2);assert.equal(splitRows.reduce((n:number,s:{startMinute:number;endMinute:number})=>n+s.endMinute-s.startMinute,0),120)
  assert.ok(splitRows.every((s:{note:string})=>s.note===morningMerged.note))
  // Explicit old-version split cannot be silently replayed on a new revision.
  assert.equal((await write(desktop,revision-1,splitMorning)).error?.message,'REVISION_CONFLICT')
  for(const patch of [{slotIds:[4,5],startMinute:660,endMinute:840},{slotIds:[8,9],startMinute:960,endMinute:1200},{slotIds:[2,2]}]) assert.ok((await write(phone,revision,command('saveSchedule',{...morningMerged,...patch}))).error)
  const nightIds=[randomUUID(),randomUUID(),randomUUID()]
  const nights=nightIds.map((id,i)=>({...morningA,id,date:'2026-10-23',slotIds:[9+i],startMinute:[1110,1200,1260][i],endMinute:[1200,1260,1320][i]}))
  for(const value of nights) assert.equal((await write(phone,revision++,command('saveSchedule',value))).error,null)
  const nightMerged={...nights[0],slotIds:[9,10,11],endMinute:1320}
  const nightMerge=command('mergeSchedules',{ids:nightIds,result:nightMerged,contentConfirmed:true})
  // Merge versus removal competes under the account lock and cannot partially finish.
  const race=await Promise.all([write(phone,revision,nightMerge),write(desktop,revision,command('removeSchedule',{id:nightIds[2]}))])
  assert.equal(race.filter(r=>!r.error).length,1);assert.equal(race.find(r=>r.error)?.error?.message,'REVISION_CONFLICT');revision++
  if(race[0].error) {
    assert.equal((await write(phone,revision++,command('saveSchedule',nights[2]))).error,null)
    assert.equal((await write(phone,revision++,nightMerge)).error,null)
  }
  const night=(await snapshot(phone)).schedules.find((s:{id:string})=>s.id===nightIds[0]);assert.equal(night.endMinute-night.startMinute,210)
  const splitId=randomUUID(),splitNight=command('splitSchedule',{id:night.id,copyPlanText:false});loseResponse=true
  assert.ok((await write(phone,revision,splitNight,splitId)).error)
  assert.equal((await write(desktop,revision,splitNight,splitId)).error,null);revision++
  assert.equal((await snapshot(phone)).schedules.filter((s:{date:string})=>s.date==='2026-10-23').length,3)
  assert.equal((await write(desktop,revision-1,command('splitSchedule',{id:night.id,copyPlanText:true}),splitId)).error?.message,'REQUEST_REUSED')
  const nightParts=(await snapshot(phone)).schedules.filter((s:{date:string})=>s.date==='2026-10-23')
  assert.equal((await write(phone,revision++,command('mergeSchedules',{ids:nightParts.map((s:{id:string})=>s.id),result:nightMerged,contentConfirmed:true}))).error,null)
  const beforeSlotRestore=await snapshot(phone)
  const slotBackup={categories:beforeSlotRestore.categories,tasks:beforeSlotRestore.tasks,schedules:beforeSlotRestore.schedules,workLogs:beforeSlotRestore.workLogs,settings:beforeSlotRestore.settings}
  const invalidRestoreId=randomUUID()
  assert.ok((await write(phone,revision,command('restore',{...slotBackup,schedules:[...slotBackup.schedules,{...slotBackup.schedules[0],id:randomUUID()}]}),invalidRestoreId)).error)
  assert.deepEqual(await snapshot(phone),beforeSlotRestore);assert.equal((await phone.rpc('planner_receipt',{p_request_id:invalidRestoreId})).data,null)
  const restoreSlotsId=randomUUID(),restoreSlots=command('restore',slotBackup)
  assert.equal((await write(phone,revision,restoreSlots,restoreSlotsId)).error,null)
  assert.equal((await write(desktop,revision,restoreSlots,restoreSlotsId)).error,null);revision++
  // Valid v2 migration output preserves original 105-minute snapshots; derived occupancy rebuilds.
  const historical={...slotBackup.schedules[0],slotTemplateVersion:1,slotIds:[9],startMinute:1110,endMinute:1215}
  assert.equal((await write(phone,revision++,command('restore',{...slotBackup,schedules:[historical]}))).error,null)
  assert.equal((await snapshot(desktop)).schedules[0].endMinute,1215)
  assert.ok((await write(phone,revision,command('saveSchedule',{...morningA,id:randomUUID(),date:historical.date,slotIds:[10],startMinute:1200,endMinute:1260}))).error,'跨模板占用漏检')
  assert.equal((await snapshot(phone)).tasks[0].initialCompletedUnits,'8')
  console.log('通过：阶段 3 120/210 分钟、明确内容确认、真实合并/移除和拆分/移动并发、响应丢失合并/拆分幂等、旧版本、间隔拒绝、全部回滚、基础时段占位、完整恢复及 v2 迁移输出/跨模板重叠保护。')
  // Stage 4: actual records use the same real account lock and transaction.
  const log={id:randomUUID(),date:'2026-10-25',taskId:task.id,scheduleBlockId:historical.id,titleSnapshot:task.title,actualMinutes:80,progressDelta:'1.5',progressLabel:'2.2 节结束',note:''}
  const saveLog=command('saveWorkLog',log),logRequest=randomUUID()
  loseResponse=true
  assert.ok((await write(phone,revision,saveLog,logRequest)).error)
  assert.equal((await write(desktop,revision,saveLog,logRequest)).error,null);revision++
  assert.equal((await snapshot(phone)).workLogs.length,1)
  const order=(await snapshot(phone)).workLogs[0].createdOrder
  assert.equal((await snapshot(desktop)).workLogs[0].progressDelta,'1.5')
  assert.equal((await write(phone,revision++,command('saveWorkLog',{...log,progressDelta:'1'}))).error,null)
  assert.equal((await snapshot(desktop)).workLogs[0].progressDelta,'1')
  assert.equal((await snapshot(desktop)).workLogs[0].createdOrder,order)
  const deleteLog=command('removeWorkLog',{id:log.id}),deleteRequest=randomUUID()
  loseResponse=true;assert.ok((await write(phone,revision,deleteLog,deleteRequest)).error)
  assert.equal((await write(desktop,revision,deleteLog,deleteRequest)).error,null);revision++
  assert.equal((await snapshot(phone)).workLogs.length,0)
  assert.equal((await write(phone,revision++,saveLog)).error,null)
  const preInvalid=await snapshot(phone)
  for(const patch of [{actualMinutes:0},{actualMinutes:1.5},{progressDelta:'0.0000001'},{taskId:null},{owner_id:userB},{createdOrder:100},{scheduleBlockId:randomUUID()},{progressDelta:'32.000001'}]) {
    const id=randomUUID();assert.ok((await write(phone,revision,command('saveWorkLog',{...log,...patch}),id)).error)
    assert.deepEqual(await snapshot(phone),preInvalid);assert.equal((await phone.rpc('planner_receipt',{p_request_id:id})).data,null)
  }
  assert.equal((await write(phone,revision,command('saveTask',{...task,totalUnits:'9'}))).error?.message,'PROGRESS_LIMIT')
  assert.equal((await write(phone,revision,command('saveTask',{...task,initialCompletedUnits:'39'}))).error?.message,'PROGRESS_LIMIT')
  assert.equal((await write(other,initialB.revision,saveLog)).error?.message,'LOG_SCHEDULE_MISMATCH')
  assert.ok((await write(other,initialB.revision,command('saveWorkLog',{...log,scheduleBlockId:null}))).error)
  assert.equal((await write(other,initialB.revision,deleteLog)).error?.message,'WORK_LOG_MISSING')
  assert.equal((await other.rpc('planner_receipt',{p_request_id:logRequest})).data,null)
  // Simultaneous additions would exceed total together; one commits, one is stale.
  const competingLogs=[{...log,id:randomUUID(),progressDelta:'30'},{...log,id:randomUUID(),progressDelta:'30'}]
  const logRace=await Promise.all([write(phone,revision,command('saveWorkLog',competingLogs[0])),write(desktop,revision,command('saveWorkLog',competingLogs[1]))])
  assert.equal(logRace.filter(r=>!r.error).length,1);assert.equal(logRace.find(r=>r.error)?.error?.message,'REVISION_CONFLICT');revision++
  const loser=logRace[0].error?competingLogs[0]:competingLogs[1]
  assert.equal((await write(phone,revision,command('saveWorkLog',loser))).error?.message,'PROGRESS_LIMIT')
  const winner=logRace[0].error?competingLogs[1]:competingLogs[0]
  assert.equal((await write(phone,revision++,command('removeWorkLog',{id:winner.id}))).error,null)
  assert.equal((await write(phone,revision,command('splitSchedule',{id:historical.id,copyPlanText:true}))).error?.message,'SCHEDULE_HAS_LOGS')
  const {createdAt:_created,updatedAt:_updated,...historicalInput}=historical;void _created;void _updated
  assert.equal((await write(phone,revision++,command('saveSchedule',{...historicalInput,date:'2026-10-27'}))).error,null)
  assert.equal((await snapshot(desktop)).workLogs[0].date,log.date)
  assert.equal((await write(phone,revision++,command('saveSchedule',{...historicalInput,taskId:null,title:'更换任务后的计划'}))).error,null)
  assert.equal((await snapshot(desktop)).workLogs[0].scheduleBlockId,null)
  assert.equal((await snapshot(desktop)).workLogs[0].taskId,task.id)
  assert.equal((await write(phone,revision++,command('saveSchedule',historicalInput))).error,null)
  assert.equal((await write(phone,revision++,saveLog)).error,null)
  assert.equal((await write(phone,revision++,command('removeSchedule',{id:historical.id}))).error,null)
  assert.equal((await snapshot(desktop)).workLogs[0].scheduleBlockId,null)
  assert.equal((await snapshot(desktop)).workLogs[0].progressDelta,'1.5')
  const temporaryLog={...log,id:randomUUID(),taskId:null,scheduleBlockId:null,progressDelta:null,titleSnapshot:'无计划的临时报告'}
  assert.equal((await write(phone,revision++,command('saveWorkLog',temporaryLog))).error,null)
  const zeroLog={...log,id:randomUUID(),scheduleBlockId:null,progressDelta:'0',actualMinutes:180}
  assert.equal((await write(phone,revision++,command('saveWorkLog',zeroLog))).error,null)
  const logSnapshot=await snapshot(phone),{revision:_revision,...logData}=logSnapshot;void _revision
  const failedRestore=randomUUID()
  assert.equal((await write(phone,revision,command('restore',{...logData,tasks:[{...logData.tasks[0],totalUnits:'9'}]}),failedRestore)).error?.message,'PROGRESS_LIMIT')
  assert.deepEqual(await snapshot(desktop),logSnapshot);assert.equal((await phone.rpc('planner_receipt',{p_request_id:failedRestore})).data,null)
  const restoreLogsId=randomUUID(),restoreLogs=command('restore',logData)
  assert.equal((await write(phone,revision,restoreLogs,restoreLogsId)).error,null)
  assert.equal((await write(desktop,revision,restoreLogs,restoreLogsId)).error,null);revision++
  const logValues=(s:typeof logSnapshot)=>s.workLogs.map((l:{id:string;createdOrder:number;progressDelta:string|null})=>[l.id,l.createdOrder,l.progressDelta])
  assert.deepEqual(logValues(await snapshot(desktop)),logValues(logSnapshot))
  assert.equal((await write(phone,revision-1,saveLog)).error?.message,'REVISION_CONFLICT')
  assert.equal((await write(phone,revision++,command('restore',{...logData,workLogs:[]}))).error,null)
  assert.equal((await snapshot(desktop)).workLogs.length,0)
  console.log('通过：阶段 4 实际记录增改删与补记、零进度/临时事项、原请求响应丢失幂等、稳定创建顺序、真实超量竞争与刷新后拒绝、任务总量/初始量校验、实际关联保护、移日/换任务/移除保留实际、v4 恢复/回滚/旧表单及旧备份清空记录。')
  await phone.auth.signOut({scope:'local'})
  assert.ok((await phone.rpc('planner_snapshot')).error)
  await login(phone,env.SUPABASE_TEST_EMAIL_A,env.SUPABASE_TEST_PASSWORD_A)
  assert.equal((await snapshot(phone)).tasks.length,1)
  console.log('通过：退出后拒绝业务请求，重新登录取回云端数据。自然过期与安卓实机仍按手动步骤验收。')
} catch {
  console.error('集成检查失败：为避免泄露凭据或业务内容，未打印服务器响应。请按最后一个通过组定位并在受控测试环境排查。')
  process.exitCode = 1
} finally {
  if (cleanupReady) {
    try {
      const latest = await snapshot(desktop)
      const result = await write(desktop,latest.revision,command('restore',{categories:[],tasks:[],schedules:[],workLogs:[],settings:initial.settings}))
      assert.equal(result.error,null)
      console.log('已清理 A 测试业务数据；内部递增版本与回执保留。')
    } catch { console.error('测试数据清理失败，请在测试项目内检查 A 账号。'); process.exitCode=1 }
  }
  await Promise.all([phone,desktop,other].map(c=>c.auth.signOut({scope:'local'})))
}
