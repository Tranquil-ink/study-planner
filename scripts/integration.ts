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
const tables = ['categories','tasks','schedules','settings','dataset_state','operation_receipts']
let cleanupReady = false
let initial: Awaited<ReturnType<typeof snapshot>>
try {
  const userA = await login(phone,env.SUPABASE_TEST_EMAIL_A,env.SUPABASE_TEST_PASSWORD_A)
  assert.equal(await login(desktop,env.SUPABASE_TEST_EMAIL_A,env.SUPABASE_TEST_PASSWORD_A),userA)
  const userB = await login(other,env.SUPABASE_TEST_EMAIL_B,env.SUPABASE_TEST_PASSWORD_B)
  assert.notEqual(userA,userB)
  initial = await snapshot(phone)
  const initialB = await snapshot(other)
  assert.equal(initial.categories.length+initial.tasks.length+initial.schedules.length,0,'拒绝测试：A 账号非空')
  assert.equal(initialB.categories.length+initialB.tasks.length+initialB.schedules.length,0,'拒绝测试：B 账号非空')
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
  const broken = {categories:[],tasks:beforeFailure.tasks,schedules:beforeFailure.schedules,settings:beforeFailure.settings}
  assert.ok((await write(phone,revision,command('restore',broken))).error)
  assert.deepEqual(await snapshot(phone),beforeFailure)
  const restoreId = randomUUID(), restored = {categories:beforeFailure.categories,tasks:beforeFailure.tasks,schedules:beforeFailure.schedules,settings:beforeFailure.settings}
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
  for(const patch of [{date:'2026-02-30'},{startMinute:541},{slotIds:[2,3]},{slotTemplateVersion:2},{taskId:randomUUID()}]) assert.ok((await write(phone,revision,command('saveSchedule',{...schedule,...patch}))).error)
  const beforeScheduleFailure=await snapshot(phone)
  offline=true
  assert.ok((await phone.rpc('planner_snapshot')).error)
  assert.ok((await write(phone,revision,command('saveSchedule',{...schedule,note:'不得写入'}))).error)
  offline=false
  assert.deepEqual(await snapshot(phone),beforeScheduleFailure)
  console.log('通过：日程双向读写、响应丢失幂等、数据库重复占用、真实双会话竞争、临时 105 分钟、跨账号拒绝、非法日期/快照与断网；初始进度不变。')
  const scheduleData={categories:beforeScheduleFailure.categories,tasks:beforeScheduleFailure.tasks,schedules:beforeScheduleFailure.schedules,settings:beforeScheduleFailure.settings}
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
  const migratedStage1={categories:scheduleData.categories,tasks:scheduleData.tasks,settings:scheduleData.settings,schedules:[]}
  assert.equal((await write(phone,revision,command('restore',migratedStage1))).error,null);revision++
  assert.equal((await snapshot(desktop)).schedules.length,0)
  assert.equal((await snapshot(desktop)).tasks[0].initialCompletedUnits,'8')
  assert.equal((await snapshot(other)).schedules.length,0)
  console.log('通过：含日程恢复中途失败全部回滚、完整快照恢复/重试、预检后并发拒绝、恢复后旧表单拒绝、移除幂等及阶段 1 迁移输出的云端原子恢复。')
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
      const result = await write(desktop,latest.revision,command('restore',{categories:[],tasks:[],schedules:[],settings:initial.settings}))
      assert.equal(result.error,null)
      console.log('已清理 A 测试业务数据；内部递增版本与回执保留。')
    } catch { console.error('测试数据清理失败，请在测试项目内检查 A 账号。'); process.exitCode=1 }
  }
  await Promise.all([phone,desktop,other].map(c=>c.auth.signOut({scope:'local'})))
}
