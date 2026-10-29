// Called only by the local browser harness. No application mock storage exists.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { checkWorkLogs } from './work-logs-browser-check.mjs'
import { checkSlots } from './slots-browser-check.mjs'
export async function checkCalendar({ phone, desktop, saved, db }) {
  const p=phone.page,d=desktop.page
  const mainDate='2026-10-20'
  const button=(page,time)=>page.getByRole('button',{name:new RegExp(`^${mainDate} ${time} `)})
  const save=async page=>{await page.getByRole('button',{name:'保存日程到云端',exact:true}).click();await saved(page)}
  async function refresh(page) {
    const response=page.waitForResponse(r=>r.url().endsWith('/rpc/planner_snapshot'))
    await page.getByRole('button',{name:'获取最新数据',exact:true}).click()
    await response
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='获取最新数据'&&!b.disabled))
  }
  const cancel=page=>page.getByRole('button',{name:'取消日程编辑',exact:true}).click()
  async function temporary(page,time,title) {
    await button(page,time).click()
    await page.getByLabel('临时任务名称',{exact:true}).fill(title)
  }
  await p.getByRole('link',{name:'日历',exact:true}).click()
  await d.getByRole('link',{name:'日历',exact:true}).click()
  assert.equal(await p.getByRole('button',{name:'日视图',exact:true}).getAttribute('aria-pressed'),'true')
  assert.equal(await d.getByRole('button',{name:'周视图',exact:true}).getAttribute('aria-pressed'),'true')
  for(const page of [p,d]) await page.getByLabel('选择日期',{exact:true}).fill(mainDate)
  assert.equal(await p.locator('.calendar-slot').count(),11)
  assert.equal(await d.locator('.calendar-slot').count(),77)
  assert.equal(await p.locator('.calendar-break').allTextContents().then(rows=>rows.join('|')),'12:00–13:00 午休|17:00–18:30 晚饭间隔')
  // Phone task selection; view/date/page switches preserve the original edit target.
  await button(p,'09:00').click()
  await p.getByLabel('安排类型',{exact:true}).selectOption('task')
  await p.getByLabel('关联长期任务',{exact:true}).selectOption({label:'浏览器虚构理论力学'})
  await p.getByLabel('计划学习范围',{exact:true}).fill('2.1～2.3')
  await p.getByLabel('日程备注',{exact:true}).fill('手机计划草稿')
  await p.getByRole('button',{name:'周视图',exact:true}).click()
  await p.getByRole('button',{name:'下一周',exact:true}).click()
  await p.getByRole('link',{name:'任务池',exact:true}).click()
  await p.getByRole('link',{name:'日历',exact:true}).click()
  assert.equal(await p.getByLabel('日程日期',{exact:true}).inputValue(),mainDate)
  assert.equal(await p.getByLabel('日程备注',{exact:true}).inputValue(),'手机计划草稿')
  await p.getByRole('button',{name:'日视图',exact:true}).click()
  await p.getByLabel('选择日期',{exact:true}).fill(mainDate)
  await save(p)
  await refresh(d)
  await button(d,'09:00').click()
  await d.getByLabel('计划学习范围',{exact:true}).fill('2.2～2.4')
  await d.getByLabel('日程备注',{exact:true}).fill('电脑编辑')
  await save(d);await refresh(p)
  assert.match(await button(p,'09:00').innerText(),/2.2～2.4/)
  const original=await db.query('select initial_completed_units::text n from public.planner_tasks')
  assert.equal(original.rows[0].n,'8')
  // Late form rejection and explicit rebase, retaining text on fetch.
  await button(p,'09:00').click();await button(d,'09:00').click()
  await p.getByLabel('日程备注',{exact:true}).fill('手机更新')
  await save(p)
  await d.getByLabel('日程备注',{exact:true}).fill('电脑旧表单输入')
  await d.getByRole('button',{name:'保存日程到云端',exact:true}).click()
  await d.getByRole('alert').filter({hasText:'云端已有更新'}).waitFor()
  assert.equal(await d.getByLabel('日程备注',{exact:true}).inputValue(),'电脑旧表单输入')
  await refresh(d)
  await d.getByRole('button',{name:'已核对，将日程输入应用到最新版本',exact:true}).click()
  await save(d);await refresh(p)
  // Temporary report and true 105-minute evening snapshot.
  await temporary(p,'18:30','临时课程报告')
  await p.getByLabel('计划学习范围',{exact:true}).fill('整理报告提纲')
  await save(p)
  assert.match(await button(p,'18:30').innerText(),/90 分钟/)
  await refresh(d)
  // Two independently opened forms compete at one slot. Harness DB is serialized.
  await temporary(p,'10:00','手机竞争')
  await temporary(d,'10:00','电脑竞争')
  await Promise.all([p,d].map(page=>page.getByRole('button',{name:'保存日程到云端',exact:true}).click()))
  await Promise.all([p,d].map(page=>page.waitForFunction(()=>![...document.querySelectorAll('p[role=status]')].some(e=>e.textContent.includes('保存中')))))
  const pLost=await p.getByRole('region',{name:'日程编辑表单',exact:true}).count()>0
  const loser=pLost?p:d,winner=pLost?d:p
  await loser.getByRole('alert').filter({hasText:'云端已有更新'}).waitFor();await saved(winner)
  assert.match(await loser.getByLabel('临时任务名称',{exact:true}).inputValue(),/竞争/)
  assert.equal((await db.query("select count(*)::int n from public.planner_schedules where date='2026-10-20' and slot_ids=array[3]")).rows[0].n,1)
  await cancel(loser);await refresh(p);await refresh(d)
  // Offline reads preserve existing calendar; failed writes keep/lock the draft.
  const fetched=await p.getByText(/^最近成功获取：/).innerText()
  phone.mode('offline');await refresh(p)
  await p.getByRole('alert').filter({hasText:'获取失败'}).waitFor()
  assert.equal(await p.getByText(/^最近成功获取：/).innerText(),fetched)
  assert.match(await button(p,'09:00').innerText(),/理论力学/)
  await temporary(p,'11:00','断网保留的报告')
  await p.getByRole('button',{name:'保存日程到云端',exact:true}).click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor()
  assert.equal(await p.getByLabel('临时任务名称',{exact:true}).inputValue(),'断网保留的报告')
  assert.equal((await db.query("select count(*)::int n from public.planner_schedules where date='2026-10-20' and slot_ids=array[4]")).rows[0].n,0)
  phone.mode('normal');await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p)
  // Committed response lost: same request receipt, no duplicate row or revision.
  await temporary(p,'13:00','响应丢失的报告')
  phone.mode('lost');await p.getByRole('button',{name:'保存日程到云端',exact:true}).click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor()
  const revision=(await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p)
  assert.equal((await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r,revision)
  // Removal is cloud-confirmed and leaves the task unchanged.
  await button(p,'13:00').click();await p.getByRole('button',{name:'移除此日程',exact:true}).click();await saved(p)
  assert.match(await button(p,'13:00').innerText(),/安排/)
  await refresh(d)
  // Full JSON includes time snapshots; restore invalidates another device's form.
  await button(d,'09:00').click()
  await p.getByRole('link',{name:'数据设置',exact:true}).click()
  const downloadPromise=p.waitForEvent('download')
  await p.getByRole('button',{name:'从云端导出完整 JSON',exact:true}).click()
  await (await downloadPromise).saveAs('work/calendar-backup.json')
  const backup=JSON.parse(await fs.readFile('work/calendar-backup.json','utf8'))
  assert.equal(backup.schemaVersion,4);assert.equal(backup.data.schedules.length,4)
  assert.ok(backup.data.schedules.some(s=>s.startMinute===1110&&s.endMinute===1200))
  await p.getByLabel('选择备份 / 本地数据迁移文件').setInputFiles('work/calendar-backup.json')
  await p.getByRole('heading',{name:'备份恢复预览（v4）',exact:true}).waitFor()
  await p.getByLabel('我确认替换当前账号全部业务数据与设置').check()
  await p.getByRole('button',{name:'确认恢复到云端',exact:true}).click();await saved(p)
  await d.getByRole('button',{name:'保存日程到云端',exact:true}).click()
  await d.getByRole('alert').filter({hasText:'云端已有更新'}).waitFor();await cancel(d);await refresh(d)
  await p.getByRole('link',{name:'日历',exact:true}).click()
  // Cross-month navigation and explicit today return in Chinese business timezone.
  await p.getByLabel('选择日期',{exact:true}).fill('2024-02-29')
  await p.getByRole('button',{name:'下一日',exact:true}).click()
  assert.equal(await p.getByLabel('选择日期',{exact:true}).inputValue(),'2024-03-01')
  await p.getByRole('button',{name:'回到今天',exact:true}).click()
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  assert.equal(await p.getByLabel('选择日期',{exact:true}).inputValue(),today)
  await p.getByLabel('选择日期',{exact:true}).fill(mainDate)
  for(const width of [320,360,430,1280]) {
    await p.setViewportSize({width,height:900})
    for(const view of ['日视图','周视图']) {
      await p.getByRole('button',{name:view,exact:true}).click()
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`calendar overflow ${width}/${view}`)
    }
  }
  await p.setViewportSize({width:360,height:900});await p.getByRole('button',{name:'日视图',exact:true}).click()
  await button(p,'09:00').click()
  for(const element of await p.getByRole('region',{name:'日程编辑表单',exact:true}).locator('button, input, select, textarea').all()) {
    const box=await element.boundingBox();assert.ok(box&&box.height>=44&&box.width>=44,'calendar touch control under 44px')
  }
  await p.screenshot({path:'work/calendar-mobile-editor.png',fullPage:true});await cancel(p)
  await p.screenshot({path:'work/calendar-mobile.png',fullPage:true});await d.screenshot({path:'work/calendar-desktop.png',fullPage:true})
  assert.equal((await db.query('select initial_completed_units::text n from public.planner_tasks')).rows[0].n,'8')
  assert.match(await p.getByRole('region',{name:'日历排程',exact:true}).innerText(),/周预算：未设置/)
  console.log('PASS stage-2 browser simulation: mobile day/desktop week, 11 slots/breaks, task and report, bidirectional refresh/edit, competition, stale forms/rebase, offline draft/failed read, lost response idempotence, removal, JSON snapshots/atomic restore and stale form, leap date/navigation, preserved editor across views/pages, 320/360/430/1280 no page overflow, editor 44px controls. NOT real Supabase or Android.')
  await checkSlots({phone,desktop,saved,db,refresh})
  await checkWorkLogs({phone,desktop,saved,db,refresh})
  await p.getByRole('link',{name:'任务池',exact:true}).click()
}
