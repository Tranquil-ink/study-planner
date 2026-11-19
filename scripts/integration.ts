// Destructive restore checks require two disposable, empty test accounts.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Command, Dataset, Snapshot } from '../src/domain/model'

const required = ['SUPABASE_TEST_URL', 'SUPABASE_TEST_PUBLIC_KEY', 'SUPABASE_TEST_PROJECT_REF', 'SUPABASE_TEST_EMAIL_A',
  'SUPABASE_TEST_PASSWORD_A', 'SUPABASE_TEST_EMAIL_B', 'SUPABASE_TEST_PASSWORD_B']
if (required.some(key => !process.env[key]) || process.env.SUPABASE_TEST_ACK !== 'isolated-disposable') {
  console.error('未运行：需要已升级的隔离 Supabase 测试项目、两个空测试账号和 SUPABASE_TEST_ACK=isolated-disposable。见 docs/SUPABASE.md。')
  process.exit(2)
}
const env = process.env as Record<string, string>
assert.equal(new URL(env.SUPABASE_TEST_URL).hostname, `${env.SUPABASE_TEST_PROJECT_REF}.supabase.co`, '测试项目与 URL 不符')
assert.notEqual(env.SUPABASE_TEST_EMAIL_A, env.SUPABASE_TEST_EMAIL_B)
if (env.SUPABASE_TEST_PUBLIC_KEY.startsWith('sb_secret_')) throw new Error('测试只使用公开 publishable 或 anon key')
if (!env.SUPABASE_TEST_PUBLIC_KEY.startsWith('sb_publishable_')) {
  assert.equal(JSON.parse(Buffer.from(env.SUPABASE_TEST_PUBLIC_KEY.split('.')[1] ?? '', 'base64url').toString()).role, 'anon')
}

let loseResponse = false
const client = (simulateLoss = false) => createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_PUBLIC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (url, init) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) })
    if (simulateLoss && loseResponse && String(url).endsWith('/rpc/planner_mutate')) {
      loseResponse = false
      assert.equal(response.ok, true)
      await response.text()
      throw new TypeError('synthetic lost response after commit')
    }
    return response
  } },
})
const phone = client(true), computer = client(), other = client(), anonymous = client()
const tableSuffixes = ['categories','projects','tasks','todos','weeks','week_items','schedules','work_logs','settings','dataset_state','operation_receipts']
const dataKeys = ['categories', 'projects', 'tasks', 'todos', 'weeks', 'weekItems', 'schedules', 'workLogs'] as const

async function signIn(c: SupabaseClient, suffix: 'A' | 'B') {
  const result = await c.auth.signInWithPassword({ email: env[`SUPABASE_TEST_EMAIL_${suffix}`], password: env[`SUPABASE_TEST_PASSWORD_${suffix}`] })
  assert.equal(result.error, null, '测试账号登录失败')
  assert.ok(result.data.user)
  return result.data.user.id
}
async function snapshot(c: SupabaseClient): Promise<Snapshot> {
  const result = await c.rpc('planner_snapshot')
  assert.equal(result.error, null, '读取 RPC 失败')
  assert.ok(result.data && dataKeys.every(k => Array.isArray(result.data[k])), '测试库尚未升级到按天排程结构')
  return result.data as Snapshot
}
function business(s: Snapshot): Dataset {
  return { categories: s.categories, projects: s.projects, tasks: s.tasks, todos: s.todos, weeks: s.weeks, weekItems: s.weekItems,
    schedules: s.schedules, workLogs: s.workLogs, settings: s.settings }
}
const write = (c: SupabaseClient, revision: number, command: unknown, id = randomUUID()) => c.rpc('planner_mutate', {
  p_request_id: id, p_expected_revision: revision, p_command: command,
})
async function save(c: SupabaseClient, command: Command) {
  const prior = await snapshot(c)
  const result = await write(c, prior.revision, command)
  assert.equal(result.error, null)
  assert.equal(result.data.revision, prior.revision + 1)
}
const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const monday = new Date(`${now}T00:00:00Z`)
monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
const week = monday.toISOString().slice(0, 10)

let initial: Snapshot | undefined
let cleanupReady = false
try {
  const a = await signIn(phone, 'A')
  assert.equal(await signIn(computer, 'A'), a)
  assert.notEqual(await signIn(other, 'B'), a)
  initial = await snapshot(phone)
  const initialB = await snapshot(other)
  assert.ok(dataKeys.every(k => initial![k].length === 0), '拒绝测试：A 账号有数据')
  assert.ok(dataKeys.every(k => initialB[k].length === 0), '拒绝测试：B 账号有数据')
  assert.equal(initial.settings.capacityTemplate, null, '拒绝测试：A 账号已有容量模板')
  cleanupReady = true

  const category = { id: randomUUID(), name: '虚构物理', color: '#32796b', archived: false }
  const project = { id: randomUUID(), categoryId: category.id, title: '虚构课程', archived: false }
  const task = { id: randomUUID(), categoryId: category.id, projectId: project.id, title: '虚构教材', unitName: '页',
    totalUnits: '300', initialCompletedUnits: '0', initialProgressLabel: '', note: '', archived: false, priority: 'normal' as const, dueDate: null }
  const todo = { id: randomUUID(), title: '虚构报告', categoryId: null, projectId: null, priority: 'important' as const,
    dueDate: now, estimatedMinutes: 60, note: '', archived: false }
  await save(phone, { type: 'saveCategory', value: category })
  await save(phone, { type: 'saveProject', value: project })
  await save(phone, { type: 'saveTask', value: task })
  await save(computer, { type: 'saveTodo', value: todo })
  await save(computer, { type: 'saveCapacityTemplate', value: { capacity: [120,120,120,120,120,0,0] } })
  const goal = { id: randomUUID(), weekStart: week, taskId: task.id, todoId: null, minutes: 240, targetUnits: '30' }
  await save(phone, { type: 'saveWeekItem', value: goal })
  await save(phone, { type: 'commitWeek', value: { weekStart: week } })
  await save(phone, { type: 'saveWeekItem', value: { ...goal, targetUnits: '6' } })
  const schedule = { id: randomUUID(), date: now, taskId: task.id, todoId: null, title: task.title,
    plannedMinutes: 120, plannedUnits: '10', plannedRangeText: '', note: '', resolved: false }
  await save(phone, { type: 'saveSchedule', value: schedule })
  await save(computer, { type: 'saveSchedule', value: { ...schedule, id: randomUUID(), taskId: null, todoId: todo.id,
    title: todo.title, plannedUnits: null, plannedMinutes: 60 } })
  const workLog = { id: randomUUID(), date: now, taskId: task.id, todoId: null, scheduleBlockId: schedule.id,
    titleSnapshot: task.title, actualMinutes: 80, progressDelta: '6', progressLabel: '第 6 页', note: '' }
  const rev = (await snapshot(phone)).revision, requestId = randomUUID()
  const logCommand = { type: 'saveWorkLog', value: workLog }
  loseResponse = true
  await write(phone, rev, logCommand, requestId)
  const confirmed = await computer.rpc('planner_receipt', { p_request_id: requestId })
  assert.equal(confirmed.error, null)
  assert.equal(confirmed.data.revision, rev + 1)
  assert.deepEqual((await write(phone, rev, logCommand, requestId)).data, confirmed.data)
  const after = await snapshot(computer)
  assert.equal(after.workLogs.length, 1)
  assert.equal(after.workLogs[0].actualMinutes, 80)
  assert.equal(after.schedules.length, 2)
  assert.equal(after.schedules.find(r => r.id === schedule.id)?.plannedMinutes, 120)
  assert.equal(Number(after.weekItems[0].baseline?.targetUnits), 30)
  assert.equal(Number(after.weekItems[0].targetUnits), 6)
  assert.match((await write(phone, rev, { type: 'saveTodo', value: todo })).error?.message ?? '', /REVISION_CONFLICT/)
  console.log('通过：两个真实 API 会话跨设备取数、同日多项安排、周初保留、实际独立、回执与过期版本。')

  for (const table of tableSuffixes) {
    const name = `planner_${table}`
    assert.ok((await anonymous.from(name).select('*')).error, `匿名可读 ${name}`)
    const blocked = await other.from(name).select('*').eq('owner_id', a)
    assert.equal(blocked.error, null)
    assert.deepEqual(blocked.data, [])
    assert.ok((await phone.from(name).insert({ owner_id: a })).error, `普通角色可写 ${name}`)
    assert.ok((await phone.from(name).update({ owner_id: a }).eq('owner_id', a)).error, `普通角色可修改 ${name}`)
    assert.ok((await phone.from(name).delete().eq('owner_id', a)).error, `普通角色可删除 ${name}`)
  }
  assert.ok((await anonymous.rpc('planner_snapshot')).error)
  assert.ok((await write(anonymous, 0, logCommand)).error)
  assert.equal((await other.rpc('planner_receipt', { p_request_id: requestId })).data, null)
  assert.ok((await write(other, initialB.revision, { type: 'saveWeekItem', value: goal })).error, 'B 不得引用 A 的任务')
  console.log('通过：真实项目的匿名拒绝、账号隔离、表直写限制和跨账号引用限制。')

  const data = business(after)
  const invalid = await write(phone, after.revision, { type: 'restore', value: { ...data, weeks: [] } })
  assert.ok(invalid.error)
  assert.deepEqual(await snapshot(computer), after, '失败的引用校验必须回滚')
  await save(phone, { type: 'restore', value: data })
  const restored = await snapshot(computer)
  assert.deepEqual(restored.weeks, data.weeks)
  assert.deepEqual(restored.weekItems[0].baseline, data.weekItems[0].baseline)
  assert.equal(restored.workLogs[0].createdOrder, data.workLogs[0].createdOrder)
  console.log('通过：完整恢复的回滚、周计划基线、实际记录和顺序。')
} finally {
  if (cleanupReady && initial) {
    try { await save(phone, { type: 'restore', value: business(initial) }) }
    catch { console.error('未能恢复 A 账号的空业务数据。请核对隔离测试账号中的虚构记录。'); process.exitCode = 1 }
  }
  await Promise.allSettled([phone, computer, other].map(c => c.auth.signOut({ scope: 'local' })))
}
