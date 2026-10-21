import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
export async function checkSlots({phone,desktop,saved,db,refresh}) {
  const p=phone.page,d=desktop.page,date='2026-11-03'
  for(const page of [p,d]) await page.getByLabel('选择日期',{exact:true}).fill(date)
  const slot=(page,time)=>page.getByRole('button',{name:new RegExp(`^${date} ${time} `)})
  const cancel=page=>page.getByRole('button',{name:'取消日程编辑',exact:true}).click()
  async function add(time,title,range,note) {
    await slot(p,time).click();await p.getByLabel('临时任务名称',{exact:true}).fill(title)
    await p.getByLabel('计划学习范围',{exact:true}).fill(range);await p.getByLabel('日程备注',{exact:true}).fill(note)
    await p.getByRole('button',{name:'保存日程到云端',exact:true}).click();await saved(p)
  }
  async function selectMerge(page,times) {
    await page.getByRole('button',{name:'选择时段合并',exact:true}).click()
    for(const time of times) await slot(page,time).click()
    await page.getByRole('button',{name:new RegExp('^合并所选安排')}).click()
  }
  await add('09:00','第一项','范围甲','备注甲');await add('10:00','第二项','范围乙','备注乙')
  await selectMerge(p,['09:00','10:00'])
  for(const control of await p.getByRole('region',{name:'日程编辑表单',exact:true}).locator('button, select, input:not([type=checkbox]), textarea, label.check').all()) {
    const box=await control.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44,'合并触控区域不足 44px')
  }
  const confirm=p.getByRole('button',{name:'确认合并到云端',exact:true})
  assert.equal(await confirm.isDisabled(),true)
  for(const label of ['合并后的任务选择','合并后的计划范围选择','合并后的备注选择']) await p.getByLabel(label,{exact:true}).selectOption({label:'手动填写下方最终内容'})
  await p.getByLabel('临时任务名称',{exact:true}).fill('明确选择的合并内容')
  await p.getByLabel('计划学习范围',{exact:true}).fill('保留甲和乙')
  await p.getByLabel('日程备注',{exact:true}).fill('明确保留两段备注')
  await p.getByLabel('我已明确选择并确认合并后的任务、计划范围和备注').check()
  const beforeOffline=(await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r
  phone.mode('offline');await confirm.click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor()
  assert.equal(await p.getByLabel('日程备注',{exact:true}).inputValue(),'明确保留两段备注')
  assert.equal((await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r,beforeOffline)
  phone.mode('normal');await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p);await refresh(d)
  assert.match(await slot(d,'09:00').innerText(),/120 分钟/)
  await slot(d,'09:00').click()
  await slot(p,'09:00').click()
  await p.getByLabel('拆分时复制计划范围和备注到每个基础时段').check()
  phone.mode('lost');await p.getByRole('button',{name:'拆分恢复基础时段',exact:true}).click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor()
  const revision=(await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p)
  assert.equal((await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r,revision)
  assert.match(await slot(p,'10:00').innerText(),/保留甲和乙/)
  await d.getByRole('button',{name:'保存日程到云端',exact:true}).click()
  await d.getByRole('alert').filter({hasText:'云端已有更新'}).waitFor();await cancel(d);await refresh(d)
  // Real-time gaps cannot be merged, even when slot numbers are adjacent.
  await add('11:00','午休前','','');await add('13:00','午休后','','')
  await selectMerge(p,['11:00','13:00']);await p.getByRole('alert').filter({hasText:'不能跨午休或晚饭'}).waitFor()
  await p.getByRole('button',{name:'取消选择时段',exact:true}).click()
  // Three evening slots sum to 210; merge response loss retries the same receipt.
  for(const time of ['18:30','20:00','21:00']) await add(time,'晚间计划','统一范围','统一备注')
  await selectMerge(p,['18:30','20:00','21:00'])
  await p.getByLabel('我已明确选择并确认合并后的任务、计划范围和备注').check()
  phone.mode('lost');await confirm.click()
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).waitFor()
  const mergeRevision=(await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r
  await p.getByRole('button',{name:'确认并重试原请求',exact:true}).click();await saved(p)
  assert.equal((await db.query('select revision::int r from public.planner_dataset_state')).rows[0].r,mergeRevision)
  assert.match(await slot(p,'18:30').innerText(),/210 分钟/)
  await refresh(d)
  // Two independent stale operations: split vs move the merged row.
  await slot(p,'18:30').click();await slot(d,'18:30').click()
  await d.getByLabel('日程日期',{exact:true}).fill('2026-11-04')
  await p.getByRole('button',{name:'拆分恢复基础时段',exact:true}).click();await saved(p)
  await d.getByRole('button',{name:'保存日程到云端',exact:true}).click()
  await d.getByRole('alert').filter({hasText:'云端已有更新'}).waitFor()
  assert.equal(await d.getByLabel('日程日期',{exact:true}).inputValue(),'2026-11-04');await cancel(d);await refresh(d)
  // Re-merge and backup full merged representation, restore through UI.
  await selectMerge(p,['18:30','20:00','21:00'])
  // Split with copy=false left text only in the first block, so explicitly choose all fields.
  for(const label of ['合并后的任务选择','合并后的计划范围选择','合并后的备注选择']) await p.getByLabel(label,{exact:true}).selectOption({label:'手动填写下方最终内容'})
  await p.getByLabel('我已明确选择并确认合并后的任务、计划范围和备注').check();await confirm.click();await saved(p)
  await p.getByRole('link',{name:'数据设置',exact:true}).click()
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'从云端导出完整 JSON',exact:true}).click()
  await (await download).saveAs('work/slots-backup.json')
  const backup=JSON.parse(await fs.readFile('work/slots-backup.json','utf8'))
  assert.equal(backup.schemaVersion,3);assert.ok(backup.data.schedules.some(s=>s.slotIds.length===3&&s.endMinute-s.startMinute===210))
  async function restore(path,heading) {
    await p.getByLabel('选择备份 / 本地数据迁移文件').setInputFiles(path)
    await p.getByRole('heading',{name:heading,exact:true}).waitFor()
    await p.getByLabel('我确认替换当前账号全部业务数据与设置').check()
    await p.getByRole('button',{name:'确认恢复到云端',exact:true}).click();await saved(p)
    await p.getByRole('button',{name:'取消预览',exact:true}).click()
  }
  await restore('work/slots-backup.json','备份恢复预览（v3）')
  // Valid stage-2 file, including old 105 minute historical snapshot; UI migration.
  const old={...backup,schemaVersion:2,data:{...backup.data,schedules:[{...backup.data.schedules[0],date,slotTemplateVersion:1,slotIds:[9],startMinute:1110,endMinute:1215}]}}
  old.data.schedules.push({...old.data.schedules[0],id:randomUUID(),slotIds:[10],startMinute:1215,endMinute:1320})
  await fs.writeFile('work/slots-v2.json',JSON.stringify(old))
  await restore('work/slots-v2.json','旧格式迁移预览（v2 → v3）')
  await refresh(d);assert.match(await slot(d,'18:30').innerText(),/105 分钟/)
  assert.match(await slot(d,'20:15').innerText(),/105 分钟/)
  const a=await slot(d,'18:30').boundingBox(),b=await slot(d,'20:15').boundingBox()
  assert.ok(a&&b&&a.y+a.height<=b.y,'历史晚间卡片不能遮挡重叠')
  await restore('work/slots-backup.json','备份恢复预览（v3）')
  await p.getByRole('link',{name:'日历',exact:true}).click();await refresh(d)
  for(const width of [320,360,430,1280]) {
    await p.setViewportSize({width,height:900})
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
  }
  await p.setViewportSize({width:360,height:900});await p.screenshot({path:'work/slots-mobile.png',fullPage:true})
  await d.screenshot({path:'work/slots-desktop.png',fullPage:true})
  assert.equal((await db.query('select initial_completed_units::text n from public.planner_tasks')).rows[0].n,'8')
  console.log('PASS stage-3 browser simulation: explicit three-field content selection, 120 merge/split conservation, 210 evening, lunch rejection, split/merge lost-response receipt retry, stale split/move conflict with retained input, v3 merged backup restore and v2 historical migration UI, mobile/desktop layouts. NOT real Supabase/Android.')
}
