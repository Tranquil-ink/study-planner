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
  await button(p, '新增分类').click()
  await field(p, '分类名称').fill('虚构物理')
  await save(p)
  await button(p, '新增项目').click()
  await field(p, '项目名称').fill('虚构理论力学')
  await save(p)
  await button(p, '新增长期任务').click()
  await field(p, '任务名称').fill('虚构教材')
  await field(p, '总量（可选）').fill('300')
  await field(p, '项目（可选）').selectOption({ label: '虚构理论力学' })
  await save(p)
  await button(p, '＋ 收集待办').click()
  await field(p, '待办名称').fill('虚构课程报告')
  await field(p, '预计分钟数（可选）').fill('55')
  await field(p, '截止日期（可选）').fill(now)
  await save(p)
  await p.getByRole('heading', { name: '收件箱', exact: true }).waitFor()
  await nav(p, '本周')
  await button(p, '调整本周').click()
  for (const day of ['一','二','三']) await field(p, `周${day}可用（分钟）`).fill('60')
  await save(p)
  await nav(p, '任务池')
  await button(card(p, '虚构教材', 'pool'), '加入本周').click()
  await field(p, '本周计划分钟数').fill('240')
  await field(p, '本周新增目标（页，可选）').fill('30')
  await save(p)
  await nav(p, '本周')
  await p.getByText(/本周计划超出容量 1 小时/).waitFor()
  await button(p, '确认周初计划').click()
  await saved(p)
  const due = p.locator('.panel').filter({ has: p.getByRole('heading', { name: /尚未纳入计划/ }) })
  await button(due, '加入本周').click()
  await save(p)
  await card(p, '虚构课程报告').getByText('周中新增', { exact: true }).waitFor()
  for (const [minutes, pages] of [['120','10'],['100','20']]) {
    await button(card(p, '虚构教材'), '安排到一天').click()
    await field(p, '安排日期').fill(now)
    await field(p, '计划分钟数').fill(minutes)
    await field(p, '计划新增量（页，可选）').fill(pages)
    await save(p)
  }
  await button(card(p, '虚构课程报告'), '安排到一天').click()
  await field(p, '安排日期').fill(now)
  await save(p)
  await nav(p, '今天')
  assert.equal(await p.locator('.schedule-card').count(), 3)
  const first = card(p, '虚构教材', 'schedule').filter({ hasText: ' · 10 页' })
  await button(first, '记实际').click()
  await field(p, '实际分钟数').fill('80')
  await field(p, '本次新增量（页）').fill('6')
  await field(p, '学到的位置（可选）').fill('第 6 页')
  await save(p)
  await first.getByText(/关联实际 1 小时 20 分钟/).waitFor()
  await button(first, '标记已处理').click()
  await saved(p)
  await nav(p, '本周')
  await card(p, '虚构教材').getByText(/仍需安排 4 页/).waitFor()
  await button(card(p, '虚构教材'), '编辑目标').click()
  await field(p, '本周新增目标（页，可选）').fill('6')
  await save(p)
  await nav(p, '复盘')
  const report = card(p, '虚构教材')
  await report.getByText(/30 页 .*20%/).waitFor()
  await report.getByText(/6 页 .*100%/).waitFor()
  await button(p, '近 12 周').click()
  assert.equal(await p.locator('.trend li').count(), 12)
  await refresh(d)
  await d.getByRole('heading', { name: '虚构教材', exact: true }).waitFor()
  await nav(d, '日历')
  await d.getByRole('heading', { name: '这一周' }).waitFor()
  assert.equal(await d.locator('.week-item').count(), 3)
  await d.screenshot({ path: 'work/week-desktop.png', fullPage: true })
  await nav(d, '复盘')
  await card(d, '虚构教材').getByText(/30 页 .*20%/).waitFor()

  await nav(p, '任务池')
  await button(p, '＋ 收集待办').click()
  await field(p, '待办名称').fill('模拟响应丢失')
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
  assert.equal(backup.schemaVersion, 5)
  assert.equal(backup.data.weekItems.length, 2)
  assert.equal(backup.data.schedules.length, 3)
  assert.equal(backup.data.workLogs[0].actualMinutes, 80)
  await field(p, '选择 v5 备份文件').setInputFiles('work/browser-backup.json')
  await p.getByRole('heading', { name: '备份恢复预览', exact: true }).waitFor()
  await field(p, '我确认替换当前账号全部业务数据与设置').check()
  await button(p, '确认恢复到云端').click()
  await saved(p)

  for (const width of [320, 360, 430, 1280]) {
    await p.setViewportSize({ width, height: 900 })
    for (const link of ['今天', '任务池', '本周', '日历', '复盘', '数据设置']) {
      await nav(p, link)
      await p.getByRole('heading', { name: link, exact: true, level: 1 }).waitFor()
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${link} overflow ${width}`)
    }
  }
  await p.setViewportSize({ width: 360, height: 900 })
  await nav(p, '本周')
  await p.screenshot({ path: 'work/plan-mobile.png', fullPage: true })
  phone.mode('offline')
  await refresh(p)
  await p.getByRole('alert').filter({ hasText: '获取失败' }).waitFor()
  await card(p, '虚构教材').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: day assignments, historical baseline, hours and units, account refresh, lost response retry, backup/restore, network failure, 320/360/430/1280 layouts. Local fixtures only.')
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
