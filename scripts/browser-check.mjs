// Browser simulation only: synthetic Auth/HTTP + PGlite, never a cloud acceptance result.
import { checkCalendar } from './calendar-browser-check.mjs'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
await fs.mkdir('work',{recursive:true})
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort'],{
  env:{...process.env,VITE_SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'},stdio:'ignore',
})
let ready=false
for(let attempt=0;attempt<100;attempt++) {
  if(server.exitCode!==null) throw new Error('检查用 Vite 服务未能启动，请检查 5174 端口')
  try { await fetch('http://127.0.0.1:5174');ready=true;break } catch { await delay(100) }
}
if(!ready) {server.kill();throw new Error('检查用 Vite 服务启动超时')}
process.on('exit',()=>server.kill())
const db = new PGlite()
const userId = '10000000-0000-4000-8000-000000000001'
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select '${userId}'::uuid $$; insert into auth.users values('${userId}');`)
await db.exec(await fs.readFile('supabase/migrations/202610170001_stage1.sql','utf8'))
  await db.exec(await fs.readFile('supabase/migrations/202610190001_stage2.sql', 'utf8'))
await db.exec(await fs.readFile('supabase/migrations/202610210001_stage3.sql', 'utf8'))
await db.exec(await fs.readFile('supabase/migrations/202610250001_stage4.sql', 'utf8'))
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,headless:true,args:['--no-sandbox']})
const errors=[]
const allPages=[]
const user={id:userId,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',created_at:'2026-10-17T00:00:00Z'}
const token=[{alg:'HS256',typ:'JWT'},{sub:userId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'signature'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.')
async function setup(width) {
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true})
  let mode='normal'
  await context.route('https://test.supabase.co/**',async route=>{
    const request=route.request(),url=new URL(request.url())
    if(mode==='authOffline' && url.pathname.endsWith('/user')) return route.fulfill({status:503,json:{message:'test Auth service unreachable'}})
    if(mode==='badreceipt' && url.pathname.endsWith('/planner_receipt')) return route.fulfill({json:{requestId:'invalid',revision:1}})
    if((mode==='offline' || mode==='authOffline') && url.pathname.startsWith('/rest')) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'test network failure'})})
    if(mode==='expired' && url.pathname.startsWith('/rest')) return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'PGRST301',message:'JWT expired'})})
    if(url.pathname.endsWith('/token')) return route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}})
    if(url.pathname.endsWith('/user')) return route.fulfill({json:user})
    if(url.pathname.endsWith('/logout')) return route.fulfill({status:204})
    try {
      const payload=request.postDataJSON()
      let rows
      if(url.pathname.endsWith('/planner_snapshot')) rows=(await db.query('select public.planner_snapshot() as value')).rows
      else if(url.pathname.endsWith('/planner_mutate')) rows=(await db.query('select public.planner_mutate($1,$2,$3::jsonb) as value',[payload.p_request_id,payload.p_expected_revision,JSON.stringify(payload.p_command)])).rows
      else if(url.pathname.endsWith('/planner_receipt')) rows=(await db.query('select public.planner_receipt($1) as value',[payload.p_request_id])).rows
      else throw new Error('unknown path')
      if(mode==='lost' && url.pathname.endsWith('/planner_mutate')) { mode='normal'; return route.fulfill({status:503,body:'response lost'}) }
      return route.fulfill({json:rows[0].value})
    } catch(e) { return route.fulfill({status:400,json:{code:e.code??'P0001',message:e.message}}) }
  })
  context.setDefaultTimeout(10000)
  const page=await context.newPage()
  allPages.push(page)
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:5174/#tasks')
  await page.getByLabel('邮箱',{exact:true}).fill(user.email)
  await page.getByLabel('密码',{exact:true}).fill('fixture-password')
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.getByRole('button',{name:'新增分类',exact:true}).waitFor()
  return {page,context,mode:value=>mode=value}
}
async function saved(page) {await page.getByRole('status').filter({hasText:'已保存到云端'}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='获取最新数据'&&!b.disabled))}
try {
  const phone=await setup(360),desktop=await setup(1280)
  const p=phone.page,d=desktop.page
  p.on('dialog',dialog=>dialog.accept())
  await p.getByRole('button',{name:'新增分类',exact:true}).click()
  await p.getByLabel('分类名称',{exact:true}).fill('浏览器虚构物理')
  await p.getByRole('button',{name:'保存到云端',exact:true}).click();await saved(p)
  await p.getByRole('button',{name:'新增长期任务',exact:true}).click()
  await p.getByLabel('任务名称',{exact:true}).fill('浏览器虚构理论力学')
  await p.getByLabel('总量（可留空）',{exact:true}).fill('40')
  await p.getByLabel('初始已完成量',{exact:true}).fill('8')
  await p.getByLabel('初始位置文字',{exact:true}).fill('2.1.1')
  await p.getByRole('button',{name:'保存到云端',exact:true}).click();await saved(p)
  // Background/foreground recovery makes the SDK emit SIGNED_IN again.
  // Auth being unreachable must preserve this page's verified identity/draft.
  await p.getByRole('button',{name:'编辑任务 / 归档',exact:true}).click()
  await p.getByLabel('备注',{exact:true}).fill('切回前台时保留的草稿')
  const fetchedBefore=await p.getByText(/^最近成功获取：/).innerText()
  phone.mode('authOffline')
  await p.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')))
  await p.getByRole('region',{name:'登录连接状态'}).waitFor()
  assert.equal(await p.getByRole('button',{name:'登录',exact:true}).count(),0)
  assert.equal(await p.getByLabel('备注',{exact:true}).inputValue(),'切回前台时保留的草稿')
  await p.getByRole('heading',{name:'浏览器虚构理论力学',exact:true}).waitFor()
  await p.getByRole('button',{name:'获取最新数据',exact:true}).click()
  await p.getByRole('alert').filter({hasText:'获取失败'}).waitFor()
  assert.equal(await p.getByText(/^最近成功获取：/).innerText(),fetchedBefore)
  // A new page has no previously verified in-memory identity; never display
  // private data from the SDK's cached session without server verification.
  const cold=await phone.context.newPage()
  await cold.goto('http://127.0.0.1:5174/#tasks')
  await cold.getByRole('region',{name:'登录连接状态'}).waitFor()
  assert.equal(await cold.getByRole('button',{name:'登录',exact:true}).count(),0)
  assert.equal(await cold.getByRole('heading',{name:'浏览器虚构理论力学',exact:true}).count(),0)
  phone.mode('normal')
  await cold.getByRole('button',{name:'重试验证登录',exact:true}).click()
  await cold.getByRole('heading',{name:'浏览器虚构理论力学',exact:true}).waitFor()
  await cold.close()
  await p.getByRole('button',{name:'重试验证登录',exact:true}).click()
  await p.getByRole('region',{name:'登录连接状态'}).waitFor({state:'hidden'})
  assert.equal(await p.getByLabel('备注',{exact:true}).inputValue(),'切回前台时保留的草稿')
  await p.getByRole('button',{name:'取消编辑',exact:true}).click()
  await d.getByRole('button',{name:'获取最新数据',exact:true}).click()
  await d.getByRole('heading',{name:'浏览器虚构理论力学',exact:true}).waitFor()
  await d.getByRole('button',{name:'编辑任务 / 归档',exact:true}).click()
  await d.getByLabel('备注',{exact:true}).fill('旧电脑表单')
  await p.getByRole('button',{name:'编辑任务 / 归档',exact:true}).click()
  await p.getByLabel('备注',{exact:true}).fill('手机已更新')
  await p.getByRole('button',{name:'保存到云端',exact:true}).click();await saved(p)
  await d.getByRole('button',{name:'保存到云端',exact:true}).click()
  await d.getByRole('alert').filter({hasText:'云端已有更新'}).waitFor()
  assert.equal(await d.getByLabel('备注',{exact:true}).inputValue(),'旧电脑表单')
  d.on('dialog',dialog=>dialog.accept())
  await d.getByRole('button',{name:'获取最新数据',exact:true}).click()
  await d.getByRole('button',{name:'已核对，将此输入应用到最新版本',exact:true}).click()
  await d.getByRole('button',{name:'保存到云端',exact:true}).click();await saved(d)
  await p.getByRole('button',{name:'获取最新数据',exact:true}).click()
  await p.getByText('旧电脑表单',{exact:true}).waitFor()
  await p.getByRole('button',{name:'编辑任务 / 归档',exact:true}).click()
  await p.getByLabel('备注',{exact:true}).fill('已提交响应丢失')
  phone.mode('lost')
  await p.getByRole('button',{name:'保存到云端',exact:true}).click()
  phone.mode('badreceipt')
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click()
  await p.getByRole('alert').filter({hasText:'服务器回执格式不正确'}).waitFor()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor()
  phone.mode('normal')
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p)
  assert.equal((await db.query('select count(*)::int n from public.planner_tasks')).rows[0].n,1)
  phone.mode('offline')
  await p.getByRole('button',{name:'获取最新数据',exact:true}).click()
  await p.getByRole('alert').filter({hasText:'获取失败'}).waitFor()
  await p.getByRole('heading',{name:'浏览器虚构理论力学',exact:true}).waitFor()
  phone.mode('normal')
  await p.getByRole('button',{name:'获取最新数据',exact:true}).click()
  await checkCalendar({phone,desktop,saved,db})
  await p.getByRole('link',{name:'数据设置'}).click()
  const downloadPromise=p.waitForEvent('download')
  await p.getByRole('button',{name:'从云端导出完整 JSON',exact:true}).click()
  const download=await downloadPromise
  await download.saveAs('work/browser-backup.json')
  const backup=JSON.parse(await fs.readFile('work/browser-backup.json','utf8'))
  assert.equal(backup.data.tasks.length,1)
  await p.getByLabel('选择备份 / 本地数据迁移文件').setInputFiles('work/browser-backup.json')
  await p.getByRole('heading',{name:'备份恢复预览（v4）',exact:true}).waitFor()
  await p.getByLabel('我确认替换当前账号全部业务数据与设置').check()
  await p.getByRole('button',{name:'确认恢复到云端',exact:true}).click();await saved(p)
  await p.getByRole('link',{name:'任务池'}).click()
  await p.getByRole('button',{name:'编辑任务 / 归档',exact:true}).click()
  await p.getByLabel('归档任务',{exact:true}).check()
  await p.getByRole('button',{name:'保存到云端',exact:true}).click();await saved(p)
  await p.getByLabel('显示已归档分类与任务',{exact:true}).check()
  await p.getByRole('heading',{name:'浏览器虚构理论力学（已归档）',exact:true}).waitFor()
  await p.getByRole('button',{name:'编辑任务 / 归档',exact:true}).click()
  await p.getByLabel('备注',{exact:true}).fill('会话失效保留的输入')
  phone.mode('expired')
  await p.getByRole('button',{name:'保存到云端',exact:true}).click()
  await p.getByRole('button',{name:'登录',exact:true}).waitFor()
  assert.equal(await p.getByText('浏览器虚构理论力学（已归档）',{exact:true}).count(),0)
  phone.mode('normal')
  await p.getByLabel('邮箱',{exact:true}).fill(user.email)
  await p.getByLabel('密码',{exact:true}).fill('fixture-password')
  await p.getByRole('button',{name:'登录',exact:true}).click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p)
  for(const width of [320,360,430,1280]) {
    await p.setViewportSize({width,height:900})
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`overflow ${width}`)
  }
  await p.setViewportSize({width:360,height:900});await p.screenshot({path:'work/mobile-check.png',fullPage:true})
  await p.getByRole('button',{name:'退出登录',exact:true}).click()
  await p.getByRole('button',{name:'登录',exact:true}).waitFor()
  assert.equal(await p.getByText('浏览器虚构理论力学（已归档）',{exact:true}).count(),0)
  await p.getByLabel('邮箱',{exact:true}).fill(user.email)
  await p.getByLabel('密码',{exact:true}).fill('fixture-password')
  await p.getByRole('button',{name:'登录',exact:true}).click()
  await p.getByRole('button',{name:'新增分类',exact:true}).waitFor()
  await p.reload()
  await p.getByRole('button',{name:'新增分类',exact:true}).waitFor()
  for(const [label,title] of [['周期计划','周期与周预算尚未实现'],['复盘','复盘与预测尚未实现']]) {
    await p.getByRole('link',{name:label,exact:true}).click()
    await p.getByRole('heading',{name:title,exact:true}).waitFor()
  }
  await p.goBack()
  await p.getByRole('heading',{name:'周期与周预算尚未实现',exact:true}).waitFor()
  const storage=await p.evaluate(async()=>({databases:await indexedDB.databases(),keys:Object.keys(localStorage)}))
  assert.equal(storage.databases.length,0)
  assert.ok(storage.keys.every(key=>key.startsWith('sb-')))
  // An unverified cross-tab identity change may invalidate A, never authorize B
  // or leave A visible merely because the verification request is offline.
  phone.mode('authOffline')
  await p.evaluate(()=>{
    const channel=new BroadcastChannel('sb-test-auth-token')
    channel.postMessage({event:'SIGNED_IN',session:{user:{id:'10000000-0000-4000-8000-000000000002'}}})
    channel.close()
  })
  await p.getByRole('region',{name:'登录连接状态'}).waitFor()
  assert.equal(await p.getByRole('button',{name:'获取最新数据',exact:true}).count(),0)
  assert.equal(await p.getByText('fixture@example.invalid',{exact:true}).count(),0)
  assert.deepEqual(errors,[])
  console.log('PASS browser simulation: login, dual contexts, edit conflict/rebase, lost response retry, failed read, background Auth connection failure with retained draft, cold-load auth gating/reconnect and cross-account invalidation, backup download/restore, archive, expiry/relogin, logout, 320/360/430/1280 layouts. Auth and HTTP are fixtures; DB executes migration on PGlite. NOT cloud or Android validation.')
} catch(e) { for(let i=0;i<allPages.length;i++) { await allPages[i].screenshot({path:`work/failure-${i}.png`,fullPage:true}); await fs.writeFile(`work/failure-${i}.txt`,await allPages[i].locator('body').innerText()) } throw e } finally {await browser.close();await db.close();server.kill()}
