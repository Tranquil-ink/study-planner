import { useEffect, useRef, useState } from 'react'
import { quantitySchema, quantityTicks, displayQuantity, type Snapshot, type WorkLogInput } from '../../domain/model'
import { taskProgress, ticksQuantity } from '../../domain/work-logs'
import { plannedMinutes } from '../../domain/calendar'

export interface WorkLogEditor { value: WorkLogInput; base: number; existing: boolean }
export function WorkLogs({ snapshot, date, editor, disabled, edit, save, remove, cancel }: {
  snapshot: Snapshot; date: string; editor: WorkLogEditor | null; disabled: boolean;
  edit: (editor: WorkLogEditor) => void; save: () => void; remove: () => void; cancel: () => void;
}) {
  const [showAll, setShowAll] = useState(false)
  const region = useRef<HTMLElement>(null)
  const id = editor?.value.id
  useEffect(() => { if (id) { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'start' }) } }, [id])
  const rows = snapshot.workLogs.filter(l => showAll || l.date === date).sort((a, b) => b.date.localeCompare(a.date) || b.createdOrder - a.createdOrder)
  const missing = !!editor?.existing && !snapshot.workLogs.some(l => l.id === editor.value.id)
  const task = snapshot.tasks.find(t => t.id === editor?.value.taskId)
  const schedule = snapshot.schedules.find(s => s.id === editor?.value.scheduleBlockId)
  const invalidLink = !!editor?.value.scheduleBlockId && (!schedule || schedule.taskId !== editor.value.taskId)
  const delta = editor?.value.progressDelta
  const remainingLogs = snapshot.workLogs.filter(l => l.id !== editor?.value.id)
  const preview = task && delta != null && quantitySchema.safeParse(delta).success
    ? quantityTicks(task.initialCompletedUnits) + remainingLogs.filter(l => l.taskId === task.id).reduce((sum, l) => sum + quantityTicks(l.progressDelta!), 0n) + quantityTicks(delta) : null
  const overTotal = preview !== null && task?.totalUnits != null && preview > quantityTicks(task.totalUnits)
  function patch(value: Partial<WorkLogInput>) { if (editor) edit({ ...editor, value: { ...editor.value, ...value } }) }
  return <section className="panel" aria-label="实际学习记录">
    <h2>实际学习记录</h2>
    <p>记录真正投入的时间和本次新增进度，计划时间不会自动记为实际。</p>
    <button disabled={disabled || !!editor} onClick={() => edit({ base: snapshot.revision, existing: false, value: { id: crypto.randomUUID(), date, taskId: null, scheduleBlockId: null, titleSnapshot: '', actualMinutes: 0, progressDelta: null, progressLabel: '', note: '' } })}>补记实际学习</button>
    {editor && <section ref={region} tabIndex={-1} aria-label="实际记录编辑表单">
      <h3>{editor.existing ? '修改实际记录' : '新增实际记录'}</h3>
      <form onSubmit={e => { e.preventDefault(); if (!overTotal && !invalidLink && !missing) save() }}>
        <fieldset disabled={disabled || missing}>
          <label>实际学习日期<input type="date" min="0001-01-01" max="9999-12-31" required value={editor.value.date} onChange={e => patch({ date: e.target.value })} /></label>
          <label>实际事项类型<select value={editor.value.taskId === null ? 'temporary' : 'task'} onChange={e => patch({ taskId: e.target.value === 'temporary' ? null : '', titleSnapshot: '', progressDelta: e.target.value === 'temporary' ? null : '0', progressLabel: '', scheduleBlockId: null })}><option value="temporary">临时事项</option><option value="task">长期任务</option></select></label>
          {editor.value.taskId === null ? <label>实际事项名称<input maxLength={200} required value={editor.value.titleSnapshot} onChange={e => patch({ titleSnapshot: e.target.value })} /></label> : <label>实际关联任务<select required value={editor.value.taskId} onChange={e => patch({ taskId: e.target.value, titleSnapshot: snapshot.tasks.find(t => t.id === e.target.value)?.title ?? '', scheduleBlockId: null })}><option value="">请选择任务</option>{snapshot.tasks.map(t => <option key={t.id} value={t.id}>{t.title}{t.archived || snapshot.categories.find(c => c.id === t.categoryId)?.archived ? '（已归档，可补记）' : ''}</option>)}</select></label>}
          <label>关联日程（可不关联）<select value={editor.value.scheduleBlockId ?? ''} onChange={e => patch({ scheduleBlockId: e.target.value || null })}><option value="">不关联日程</option>{snapshot.schedules.filter(s => s.taskId === editor.value.taskId).map(s => <option key={s.id} value={s.id}>{s.date} · {s.title} · 计划 {plannedMinutes(s)} 分钟</option>)}{invalidLink && <option value={editor.value.scheduleBlockId!}>原关联已失效，请解除或重新选择</option>}</select></label>
          {schedule && <p>关联计划 {plannedMinutes(schedule)} 分钟。实际日期可不同；移动计划不会移动本记录。</p>}
          <label>实际分钟数<input type="number" min={1} max={2147483647} step={1} required value={editor.value.actualMinutes || ''} onChange={e => patch({ actualMinutes: e.target.value === '' ? 0 : Number(e.target.value) })} /></label>
          {editor.value.taskId !== null && <label>本次新增完成量（不是累计量）<input inputMode="decimal" required value={editor.value.progressDelta ?? ''} onChange={e => patch({ progressDelta: e.target.value })} /></label>}
          <label>实际位置文字<input maxLength={200} value={editor.value.progressLabel} placeholder="例如 2.2 节结束" onChange={e => patch({ progressLabel: e.target.value })} /></label>
          <div><label htmlFor="work-log-note">实际记录备注</label><textarea id="work-log-note" maxLength={5000} value={editor.value.note} onChange={e => patch({ note: e.target.value })} /></div>
        </fieldset>
        {preview !== null && task && <p>保存后累计预览：{ticksQuantity(preview)} {task.unitName}（包含全部日期的记录）。</p>}
        {overTotal && <p role="alert">初始量与实际记录累计进度超过任务总量，请核对新增完成量。</p>}
        {invalidLink && <p role="alert">原关联日程已移除或更换任务，请选择“不关联日程”或新的日程。</p>}
        {missing && <p role="alert">此记录已被删除或不在恢复后的数据中。请复制需要的输入，取消后重新补记。</p>}
        {editor.base !== snapshot.revision && <div className="notice"><p>云端版本已变化，请核对最新记录和当前输入。</p><button type="button" disabled={disabled || missing} onClick={() => { if (window.confirm('已核对最新实际记录？继续后将以当前输入更新最新版本。')) edit({ ...editor, base: snapshot.revision }) }}>已核对，将实际记录输入应用到最新版本</button></div>}
        <div className="actions"><button disabled={disabled || missing || invalidLink || overTotal || editor.base !== snapshot.revision}>保存实际记录到云端</button>{editor.existing && <button type="button" disabled={disabled || missing || editor.base !== snapshot.revision} onClick={remove}>删除此实际记录</button>}<button type="button" disabled={disabled} onClick={cancel}>取消实际记录编辑</button></div>
      </form>
    </section>}
    <label className="check"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />查看全部日期的实际记录</label>
    <p>{showAll ? '全部记录' : date} · {rows.length} 条 · 实际 {rows.reduce((sum, l) => sum + l.actualMinutes, 0)} 分钟</p>
    {!rows.length && <p>此范围还没有实际记录。</p>}
    {rows.map(l => {
      const task = snapshot.tasks.find(t => t.id === l.taskId)
      return <article className="task-card" key={l.id}>
        <h3>{task?.title ?? l.titleSnapshot}</h3><p>{l.date} · 实际 {l.actualMinutes} 分钟{task && ` · 本次新增 ${displayQuantity(l.progressDelta!)} ${task.unitName}`}</p>
        <p>实际位置：{l.progressLabel || '未填写'} · {l.scheduleBlockId ? '已关联日程' : '无日程关联'}</p>
        {task && <p>截至该日累计：{taskProgress(task, snapshot.workLogs, l.date).completedUnits} {task.unitName}</p>}
        {l.note && <p className="preserve-lines">{l.note}</p>}
        <button disabled={disabled || !!editor} onClick={() => edit({ base: snapshot.revision, existing: true, value: { id: l.id, date: l.date, taskId: l.taskId, scheduleBlockId: l.scheduleBlockId, titleSnapshot: l.titleSnapshot, actualMinutes: l.actualMinutes, progressDelta: l.progressDelta, progressLabel: l.progressLabel, note: l.note } })}>修改记录 / 删除</button>
      </article>
    })}
  </section>
}
