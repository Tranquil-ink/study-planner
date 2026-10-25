import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function checkWorkLogs({phone,desktop,saved,db,refresh}) {
  const p=phone.page,d=desktop.page,date='2026-10-26'
  const region=page=>page.getByRole('region',{name:'实际学习记录',exact:true})
  const edit=page=>region(page).getByRole('button',{name:'修改记录 / 删除',exact:true}).first().click()
  const save=async page=>{await page.getByRole('button',{name:'保存实际记录到云端',exact:true}).click();await saved(page)}
  const slot=page=>page.getByRole('button',{name:new RegExp(`^${date} 09:00 `)})
  const current=async()=> (await db.query('select public.planner_snapshot() value')).rows[0].value
  async function progress(page,value) {
    await page.getByRole('link',{name:'任务池',exact:true}).click()
    await page.getByLabel('进度统计截至日期',{exact:true}).fill(date)
    await page.getByText(`已完成 ${value} / 40 节`,{exact:true}).waitFor()
    await page.getByRole('link',{name:'日历',exact:true}).click()
  }
  for(const page of [p,d]) { await page.getByRole('link',{name:'日历',exact:true}).click();await page.getByLabel('选择日期',{exact:true}).fill(date) }
  await slot(p).click();await p.getByLabel('结束基础时段',{exact:true}).selectOption('3')
  await p.getByLabel('安排类型',{exact:true}).selectOption('task');await p.getByLabel('关联长期任务',{exact:true}).selectOption({label:'浏览器虚构理论力学'})
  await p.getByRole('button',{name:'保存日程到云端',exact:true}).click();await saved(p)
  await slot(p).click();await p.getByRole('button',{name:'记录此日程的实际学习',exact:true}).click()
  assert.equal(await p.getByLabel('实际分钟数',{exact:true}).inputValue(),'')
  await p.getByLabel('实际分钟数',{exact:true}).fill('80');await p.getByLabel('本次新增完成量（不是累计量）',{exact:true}).fill('1.5')
  await p.getByLabel('实际位置文字',{exact:true}).fill('2.2 节结束')
  await p.getByText('保存后累计预览：9.5 节（包含全部日期的记录）。',{exact:true}).waitFor()
  await p.getByRole('link',{name:'任务池',exact:true}).click();await p.getByRole('link',{name:'日历',exact:true}).click()
  assert.equal(await p.getByLabel('实际分钟数',{exact:true}).inputValue(),'80')
  for(const control of await p.getByRole('region',{name:'实际记录编辑表单',exact:true}).locator('button, input, select, textarea').all()) {
    const box=await control.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44,'实际记录控件不足 44px')
  }
  phone.mode('lost');await p.getByRole('button',{name:'保存实际记录到云端',exact:true}).click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor()
  const committed=await current();assert.equal(committed.workLogs.length,1)
  assert.equal(await p.getByLabel('实际分钟数',{exact:true}).inputValue(),'80')
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p)
  assert.equal((await current()).revision,committed.revision)
  assert.match(await slot(p).innerText(),/已有实际记录 · 80 分钟/)
  await refresh(d);await progress(d,'9.5')
  assert.match(await d.getByRole('heading',{name:'本周安排',exact:true}).locator('..').innerText(),/已排：120 分钟 \/ 实际：80 分钟/)
  await slot(p).click();assert.equal(await p.getByRole('button',{name:'拆分恢复基础时段',exact:true}).count(),0)
  await p.getByRole('button',{name:'取消日程编辑',exact:true}).click()
  // Two independent forms: edit, reject stale change, retain and explicitly rebase.
  await edit(p);await edit(d)
  await p.getByLabel('本次新增完成量（不是累计量）',{exact:true}).fill('1');await save(p);await progress(p,'9')
  await d.getByLabel('实际记录备注',{exact:true}).fill('旧表单保留的备注');await d.getByRole('button',{name:'保存实际记录到云端',exact:true}).click()
  await d.getByRole('alert').filter({hasText:'云端已有更新'}).waitFor();await refresh(d)
  assert.equal(await d.getByLabel('实际记录备注',{exact:true}).inputValue(),'旧表单保留的备注')
  await d.getByLabel('本次新增完成量（不是累计量）',{exact:true}).fill('1')
  await d.getByRole('button',{name:'已核对，将实际记录输入应用到最新版本',exact:true}).click();await save(d);await refresh(p)
  assert.equal((await current()).workLogs[0].createdOrder,committed.workLogs[0].createdOrder)
  await edit(p);await p.getByLabel('本次新增完成量（不是累计量）',{exact:true}).fill('33')
  assert.equal(await p.getByRole('button',{name:'保存实际记录到云端',exact:true}).isDisabled(),true)
  await p.getByLabel('本次新增完成量（不是累计量）',{exact:true}).fill('1')
  phone.mode('offline');await p.getByRole('button',{name:'删除此实际记录',exact:true}).click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor();assert.equal((await current()).workLogs.length,1)
  phone.mode('normal');await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p);await progress(p,'8')
  // Zero progress + actual minutes, then schedule task changes detach actuals.
  await slot(p).click();await p.getByRole('button',{name:'记录此日程的实际学习',exact:true}).click()
  await p.getByLabel('实际分钟数',{exact:true}).fill('90');await save(p)
  await slot(p).click();await p.getByLabel('安排类型',{exact:true}).selectOption('temporary');await p.getByLabel('临时任务名称',{exact:true}).fill('改后的计划')
  await p.getByRole('button',{name:'保存日程到云端',exact:true}).click();await saved(p)
  assert.equal((await current()).workLogs[0].scheduleBlockId,null);assert.equal((await current()).workLogs[0].progressDelta,'0')
  await slot(p).click();await p.getByRole('button',{name:'移除此日程',exact:true}).click();await saved(p)
  assert.equal((await current()).workLogs.length,1)
  await region(p).getByRole('button',{name:'补记实际学习',exact:true}).click();await p.getByLabel('实际事项名称',{exact:true}).fill('无计划的临时报告')
  assert.equal(await p.getByLabel('本次新增完成量（不是累计量）',{exact:true}).count(),0)
  await p.getByLabel('实际分钟数',{exact:true}).fill('45');await save(p)
  await refresh(d);assert.equal((await current()).workLogs.length,2)
  await p.getByRole('link',{name:'数据设置',exact:true}).click()
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'从云端导出完整 JSON',exact:true}).click()
  await (await download).saveAs('work/work-logs-v4.json')
  const backup=JSON.parse(await fs.readFile('work/work-logs-v4.json','utf8'));assert.equal(backup.data.workLogs.length,2)
  async function restore(path,heading) {
    await p.getByLabel('选择备份 / 本地数据迁移文件').setInputFiles(path);await p.getByRole('heading',{name:heading,exact:true}).waitFor()
    await p.getByLabel('我确认替换当前账号全部业务数据与设置').check();await p.getByRole('button',{name:'确认恢复到云端',exact:true}).click();await saved(p)
    await p.getByRole('button',{name:'取消预览',exact:true}).click()
  }
  await restore('work/work-logs-v4.json','备份恢复预览（v4）')
  assert.deepEqual((await current()).workLogs.map(l=>[l.id,l.createdOrder]),backup.data.workLogs.map(l=>[l.id,l.createdOrder]))
  const {workLogs:_logs,...old}=backup.data;void _logs
  await fs.writeFile('work/work-logs-v3.json',JSON.stringify({...backup,schemaVersion:3,data:old}))
  await p.getByLabel('选择备份 / 本地数据迁移文件').setInputFiles('work/work-logs-v3.json')
  await p.getByText(/旧备份没有实际记录。完整替换将清空/).waitFor()
  await p.getByRole('button',{name:'取消预览',exact:true}).click()
  await restore('work/work-logs-v3.json','旧格式迁移预览（v3 → v4）');assert.equal((await current()).workLogs.length,0)
  await restore('work/work-logs-v4.json','备份恢复预览（v4）')
  await p.getByRole('link',{name:'日历',exact:true}).click();await refresh(d)
  for(const width of [320,360,430,1280]) {
    await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
  }
  await p.setViewportSize({width:360,height:900});await p.screenshot({path:'work/work-logs-mobile.png',fullPage:true})
  await d.screenshot({path:'work/work-logs-desktop.png',fullPage:true})
  console.log('PASS stage-4 browser simulation: planned 120/actual 80, 8→9.5→9→8, progress preview, single-source merge regression, stable order, lost response/offline retry, stale edit/rebase and draft preservation, linked split protection, task-change detach, deletion retains actuals, zero progress, unscheduled temporary work, v4 full restore/v3 clearing warning, mobile controls/layout. NOT real Supabase/Android.')
}
