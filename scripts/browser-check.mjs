// Synthetic Auth/HTTP and a local PostgreSQL engine. No personal data or remote test calls.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

await fs.mkdir('work', { recursive: true })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
  env: { ...process.env, VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' },
  stdio: 'inherit',
})
process.on('exit', () => server.kill())
let db
let browser
const errors = [], pages = []
const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', created_at: '2026-10-17T00:00:00Z' }
const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }, 'signature']
  .map(x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')).join('.')

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('检查用 Vite 服务未能启动，请检查 5174 端口')
    try { if ((await fetch('http://127.0.0.1:5174')).ok) return } catch { await delay(100) }
  }
  throw new Error('检查用 Vite 服务启动超时')
}

async function setup(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true })
  let mode = 'normal'
  await context.route('https://test.supabase.co/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/token')) return route.fulfill({ json: { access_token: token, refresh_token: 'fixture-refresh-token',
      token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user } })
    if (path.endsWith('/user')) return route.fulfill({ json: user })
    if (path.endsWith('/logout')) return route.fulfill({ status: 204 })
    if (mode === 'offline') return route.fulfill({ status: 503, json: { message: 'test network failure' } })
    try {
      const args = request.postDataJSON()
      let rows
      if (path.endsWith('/planner_snapshot')) rows = (await db.query('select public.planner_snapshot() value')).rows
      else if (path.endsWith('/planner_mutate')) {
        rows = (await db.query('select public.planner_mutate($1,$2,$3::jsonb) value',
          [args.p_request_id, args.p_expected_revision, JSON.stringify(args.p_command)])).rows
        if (mode === 'lost') { mode = 'normal'; return route.fulfill({ status: 503, body: 'response lost' }) }
      } else if (path.endsWith('/planner_receipt')) {
        rows = (await db.query('select public.planner_receipt($1) value', [args.p_request_id])).rows
      } else throw new Error('Unknown fixture path')
      return rows[0].value === null ? route.fulfill({ body: 'null', contentType: 'application/json' }) : route.fulfill({ json: rows[0].value })
    } catch (error) { return route.fulfill({ status: 400, json: { code: error.code ?? 'P0001', message: error.message } }) }
  })
  context.setDefaultTimeout(12000)
  const page = await context.newPage()
  pages.push(page)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.goto('http://127.0.0.1:5174/#tasks')
  await page.getByLabel('邮箱', { exact: true }).fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await button(page, '登录').click()
  await button(page, '新增分类').waitFor()
  return { page, mode: value => { mode = value } }
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
const field = (page, name) => page.getByLabel(name, { exact: true })
async function nav(page, name) {
  await page.getByRole('link', { name, exact: true }).click()
  await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor()
}
const dialog = page => page.locator('dialog[open]')
const card = (page, name, type = 'goal') => page.locator('.' + type + '-card').filter({ has: page.getByRole('heading', { name, exact: true }) })
async function saved(page) {
  await dialog(page).waitFor({ state: 'hidden' })
  await page.locator('.workspace-status').getByText('已保存到云端。', { exact: true }).waitFor()
}
async function save(page) { await button(dialog(page), '保存').click(); await saved(page) }
async function refresh(page) {
  const account = page.locator('.account-menu')
  if (await account.getAttribute('open') === null) await account.getByText('账号', { exact: true }).click()
  await button(page, '获取最新数据').click()
}

try {
  await ready()
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select '${user.id}'::uuid $$;
    insert into auth.users values('${user.id}');`)
  for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await fs.readFile(`supabase/migrations/${file}`, 'utf8'))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox'] })
  const phone = await setup(360), desktop = await setup(1280)
  const p = phone.page, d = desktop.page
  const todayColumn = page => page.locator(`[data-board-date="${now}"]`)
  const lane = (column, period) => column.getByRole('region', { name: period, exact: true })
  const add = column => column.getByRole('button', { name: /新增安排$/ })
  const dateIn = offset => new Date(Date.parse(`${now}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10)
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(`${now}T00:00:00Z`).getUTCDay()]
  const tomorrowInWeek = dateIn(weekday === '日' ? -1 : 1)
  const inbox = p.getByRole('region', { name: '收件箱', exact: true })
  const physics = p.getByRole('region', { name: '虚构物理', exact: true })
  const project = p.getByRole('region', { name: '虚构理论力学', exact: true })
  const scheduleCard = (column, title) => column.locator('.schedule-card').filter({ has: button(column.page(), title) })
  const boardGoal = (page, name) => page.locator('.board-goal').filter({ has: page.getByRole('heading', { name, exact: true }) })
  const expectBar = async (column, label, text, value) => {
    const bar = column.getByRole('progressbar', { name: label, exact: true })
    assert.equal(await bar.getAttribute('aria-valuetext'), text)
    assert.equal(await bar.evaluate(element => element.value), value)
  }
  const pickExisting = async (kind, title) => {
    await field(p, '任务类型').selectOption({ label: kind })
    await field(p, `选择${kind}`).selectOption({ label: title })
  }

  await button(p, '新增分类').click()
  await field(p, '分类名称').fill('虚构物理')
  await field(p, '分类颜色').fill('#32796b')
  await save(p)
  await button(p, '新增分类').click()
  await field(p, '分类名称').fill('虚构写作')
  await field(p, '分类颜色').fill('#9b4b33')
  await save(p)
  await button(physics, '新增项目').click()
  await field(p, '项目名称').fill('虚构理论力学')
  await save(p)
  await button(project, '新增长期任务').click()
  await field(p, '任务名称').fill('虚构教材')
  await field(p, '总量（可选）').fill('400')
  await field(p, '初始已完成量').fill('250')
  await save(p)
  const poolTask = card(p, '虚构教材', 'pool')
  await button(poolTask, '虚构教材：激活').click()
  await saved(p)
  assert.equal(await button(poolTask, '虚构教材：取消激活').getAttribute('aria-pressed'), 'true')
  await expectBar(poolTask, '累计进度', '250 / 400 页', 0.625)
  await button(inbox, '新增临时待办').click()
  await field(p, '待办名称').fill('虚构课程报告')
  await field(p, '预计分钟数（可选）').fill('60')
  await field(p, '截止日期（可选）').fill(dateIn(7))
  await save(p)

  await nav(p, '本周目标')
  await card(p, '虚构课程报告').getByText('近两周截止', { exact: true }).waitFor()
  await button(p, '编辑默认配置').click()
  await field(p, `周${weekday}上午（h）`).fill('1.5')
  await field(p, `周${weekday}下午（h）`).fill('0.5')
  await save(p)
  await button(p, '采用默认配置').click()
  await saved(p)
  await button(p, '本周临时配置').click()
  assert.equal(await field(p, `周${weekday}上午（h）`).inputValue(), '1.5')
  await field(p, `周${weekday}上午（h）`).fill('2')
  await button(dialog(p), '载入默认值').click()
  assert.equal(await field(p, `周${weekday}上午（h）`).inputValue(), '1.5')
  await field(p, `周${weekday}晚上（h）`).fill('0.5')
  await save(p)
  await button(card(p, '虚构教材'), '设定目标').click()
  await field(p, '本周计划时长（h）').fill('4')
  await field(p, '本周目标新增（页，可选）').fill('50')
  await save(p)
  await button(p, '确认周初计划').click()
  await saved(p)
  await button(card(p, '虚构课程报告'), '设定目标').click()
  assert.equal(await field(p, '本周计划时长（h）').inputValue(), '1')
  await save(p)
  await button(p, '下一周').click()
  await button(card(p, '虚构教材'), '设定目标').waitFor()
  await nav(p, '日程')
  await boardGoal(p, '虚构教材').getByText('待设目标', { exact: true }).waitFor()
  await nav(p, '本周目标')
  await button(p, '本周').click()
  await button(card(p, '虚构教材'), '编辑目标').waitFor()

  await nav(p, '日程')
  const morning = lane(todayColumn(p), '上午')
  const evening = lane(todayColumn(p), '晚上')
  await add(morning).click()
  await pickExisting('长期任务', '虚构教材')
  await field(p, '计划时长（h）').fill('1.5h')
  await field(p, '目标新增（页，可选）').fill('25')
  await field(p, '目标位置（可选）').fill('第 3 章')
  await save(p)
  await add(morning).click()
  await pickExisting('长期任务', '虚构教材')
  await field(p, '计划时长（h）').fill('.5')
  await field(p, '目标新增（页，可选）').fill('15')
  await save(p)
  await add(evening).click()
  await pickExisting('临时待办', '虚构课程报告')
  await field(p, '计划时长（h）').fill('0.5')
  await save(p)
  await add(evening).click()
  await field(p, '安排名称').fill('虚构独立安排')
  await field(p, '计划时长（h）').fill('0.5')
  await save(p)
  await expectBar(todayColumn(p), '已安排时间', '120%', 1)

  const topGoals = p.getByRole('region', { name: '日程中的本周目标' })
  await boardGoal(p, '虚构教材').getByText('2 h', { exact: true }).waitFor()
  await boardGoal(p, '虚构课程报告').getByText('0.5 h', { exact: true }).waitFor()
  const first = scheduleCard(morning, '虚构教材').filter({ hasText: '+25 页' })
  await button(first, '标记完成').click()
  assert.equal(await field(p, '实际时长（h）').inputValue(), '1.5')
  await field(p, '实际时长（h）').fill('1.25')
  await field(p, '完成到（页）').fill('275')
  await field(p, '章或节的位置（可选）').fill('第 3 章')
  await p.screenshot({ path: 'work/completion-mobile.png' })
  await button(dialog(p), '保存并完成').click()
  await saved(p)
  await first.getByText('已完成', { exact: true }).waitFor()
  await expectBar(boardGoal(p, '虚构教材'), '周进度', 'p275 / p300 · 50%', 0.5)
  await boardGoal(p, '虚构教材').getByText('2 h', { exact: true }).waitFor()
  const reportTask = scheduleCard(evening, '虚构课程报告')
  await button(reportTask, '标记未做').click()
  await saved(p)
  await button(reportTask, '撤销未做').waitFor()
  await boardGoal(p, '虚构课程报告').getByText('0.5 h', { exact: true }).waitFor()
  await expectBar(todayColumn(p), '已完成', '25% · 1/4', 0.25)
  await expectBar(todayColumn(p), '已安排时间', '120%', 1)
  assert.equal(await topGoals.getByRole('heading', { level: 3 }).count(), 2)

  const independent = scheduleCard(evening, '虚构独立安排')
  await button(independent, '移动').click()
  await field(p, '时段').selectOption({ label: '下午' })
  await button(dialog(p), '移动').click()
  await saved(p)
  const afternoon = lane(todayColumn(p), '下午')
  await scheduleCard(afternoon, '虚构独立安排').waitFor()
  await add(afternoon).click()
  await field(p, '任务类型').selectOption({ label: '临时待办' })
  await field(p, '选择临时待办').selectOption('new')
  await field(p, '待办名称').fill('日程中新建的虚构待办')
  await field(p, '分类').selectOption({ label: '虚构写作' })
  await field(p, '计划时长（h）').fill('0.5')
  await save(p)
  const inlineTodo = scheduleCard(afternoon, '日程中新建的虚构待办')
  await button(inlineTodo, '标记完成').click()
  await button(dialog(p), '保存并完成').click()
  await saved(p)
  await inlineTodo.getByText('已完成', { exact: true }).waitFor()

  await nav(p, '任务池')
  await card(p, '虚构课程报告', 'pool').waitFor()
  await expectBar(poolTask, '累计进度', '275 / 400 页', 0.6875)
  assert.equal(await card(p, '日程中新建的虚构待办', 'pool').count(), 0)
  await refresh(d)
  await d.getByRole('heading', { name: '虚构教材', exact: true }).waitFor()
  await d.locator('.account-menu > summary').click()
  await nav(d, '日程')
  const source = scheduleCard(lane(todayColumn(d), '上午'), '虚构教材').filter({ hasText: '+15 页' })
  const destination = lane(d.locator(`[data-board-date="${tomorrowInWeek}"]`), '下午')
  await source.dragTo(destination, { targetPosition: { x: 30, y: 18 } })
  await saved(d)
  await scheduleCard(destination, '虚构教材').filter({ hasText: '+15 页' }).waitFor()
  await d.screenshot({ path: 'work/week-desktop.png', fullPage: true })
  await nav(d, '复盘')
  const report = card(d, '虚构教材')
  await report.getByText(/50 页 .*50%/).waitFor()
  await expectBar(report, '周进度', 'p275 / p300 · 50%', 0.5)
  assert.equal(await d.getByText('日历已排', { exact: true }).count(), 0)
  await button(d, '近 12 周').click()
  assert.equal(await d.locator('.trend li').count(), 12)
  assert.equal(await d.locator('.bar-stack > div').count(), 2)
  assert.equal(await d.locator('.study-pie-legend li').count(), 2)
  await expectBar(d.getByRole('region', { name: '长期任务平均完成率', exact: true }), '虚构教材', '50% · 1 周', 0.5)

  await button(inbox, '新增临时待办').click()
  await field(p, '待办名称').fill('模拟响应丢失')
  await button(dialog(p), '保存').click()
  await button(dialog(p), '以最新版本继续编辑').waitFor()
  assert.equal(await field(p, '待办名称').inputValue(), '模拟响应丢失')
  await button(dialog(p), '以最新版本继续编辑').click()
  phone.mode('lost')
  await button(dialog(p), '保存').click()
  await button(dialog(p), '确认并重试原请求').click()
  await saved(p)
  assert.equal((await db.query("select count(*)::int n from public.planner_todos where title='模拟响应丢失'")).rows[0].n, 1)

  await nav(p, '数据设置')
  const downloadPromise = p.waitForEvent('download')
  await button(p, '从云端导出完整 JSON').click()
  const download = await downloadPromise
  await download.saveAs('work/browser-backup.json')
  const backup = JSON.parse(await fs.readFile('work/browser-backup.json', 'utf8'))
  assert.equal(backup.schemaVersion, 6)
  assert.equal(backup.data.weekItems.length, 2)
  assert.equal(backup.data.schedules.length, 5)
  assert.equal(backup.data.workLogs[0].actualMinutes, 75)
  assert.equal(backup.data.tasks[0].activated, true)
  await field(p, '选择 v5 或 v6 备份文件').setInputFiles('work/browser-backup.json')
  await p.getByRole('heading', { name: '备份恢复预览', exact: true }).waitFor()
  await field(p, '我确认替换当前账号全部业务数据与设置').check()
  await button(p, '确认恢复到云端').click()
  await saved(p)

  for (const width of [320, 360, 430, 1280]) {
    await p.setViewportSize({ width, height: 900 })
    for (const link of ['今天', '任务池', '本周目标', '日程', '复盘', '数据设置']) {
      await nav(p, link)
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${link} overflow ${width}`)
      if (link === '日程') {
        await button(p, '周视图').click()
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `week board overflow ${width}`)
      }
    }
  }
  await p.setViewportSize({ width: 360, height: 900 })
  await nav(p, '本周目标')
  await p.screenshot({ path: 'work/plan-mobile.png', fullPage: true })
  phone.mode('offline')
  await refresh(p)
  await p.getByRole('alert').filter({ hasText: '获取失败' }).waitFor()
  await card(p, '虚构教材').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: activation and deadlines, capacity templates, mobile form and desktop drag, completion and skip, report charts, retry, backup and restore, network failure, four viewport widths. Local fixtures only.')
} catch (error) {
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: `work/failure-${i}.png`, fullPage: true }).catch(() => {})
    await fs.writeFile(`work/failure-${i}.txt`, await pages[i].locator('body').innerText()).catch(() => {})
  }
  throw error
} finally {
  if (browser) await browser.close()
  if (db) await db.close()
  server.kill()
}
