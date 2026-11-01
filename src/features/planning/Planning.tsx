import { useState } from 'react'
import { addDays, clockTime, dateLabel, isBusinessDate, SLOTS, today, weekStart } from '../../domain/calendar'
import type { Snapshot } from '../../domain/model'
import { entriesSchema, type Availability, type TodoInput, type WeekEntry, type WeekInput } from '../../domain/planning-schema'
import { capacityMinutes, carryDraft, unionAvailability, weekSummary } from '../../domain/planning'
export type PlanningEditor = { base: number } & ({ kind: 'todo'; value: TodoInput } | { kind: 'week'; value: WeekInput } | { kind: 'template'; value: { availability: Availability } })
const hours = (m: number) => `${Number((m / 60).toFixed(2))} 小时`
function AvailabilityPicker({ value, change }: { value: Availability; change: (value: Availability) => void }) {
  const merged = unionAvailability(value)
  function toggle(day: number, startMinute: number, endMinute: number, selected: boolean) {
    change(selected ? merged.flatMap(s => s.day !== day || s.endMinute <= startMinute || s.startMinute >= endMinute ? [s] : [
      ...(s.startMinute < startMinute ? [{ ...s, endMinute: startMinute }] : []), ...(s.endMinute > endMinute ? [{ ...s, startMinute: endMinute }] : []),
    ]) : unionAvailability([...merged, { day, startMinute, endMinute }]))
  }
  return <div className="availability-picker"><p>勾选准备供学习使用的时段；重叠时间只计一次。可用合计：{hours(capacityMinutes(value))}</p>
    {Array.from({ length: 7 }, (_, day) => <details key={day}><summary>周{'一二三四五六日'[day]} · {hours(capacityMinutes(value.filter(s => s.day === day)))}</summary>
      <div className="availability-slots">{SLOTS.map(slot => {
        const selected = merged.some(s => s.day === day && s.startMinute <= slot.startMinute && s.endMinute >= slot.endMinute)
        return <label className="check" key={slot.id}><input type="checkbox" checked={selected} onChange={() => toggle(day, slot.startMinute, slot.endMinute, selected)} />{clockTime(slot.startMinute)}–{clockTime(slot.endMinute)}</label>
      })}</div>
      <p>当前时段：{merged.filter(s => s.day === day).map(s => `${clockTime(s.startMinute)}–${clockTime(s.endMinute)}`).join('、') || '未选择'}</p>
      <button type="button" onClick={() => change(value.filter(s => s.day !== day))}>清空周{'一二三四五六日'[day]}可用时间</button>
    </details>)}
  </div>
}
function EntrySummary({ entry }: { entry: WeekEntry }) {
  return <li>{entry.titleSnapshot}：{entry.goalType === 'progress' ? `新增 ${entry.targetUnits} ${entry.unitName}；预计投入` : entry.goalType === 'time' ? '投入目标' : '预计耗时'} {hours(entry.estimatedMinutes)}{entry.deadline && `；截止 ${entry.deadline}`}{entry.cancelled && '（已取消）'}</li>
}
export function Planning({ snapshot, editor, edit, disabled, save, cancel }: {
  snapshot: Snapshot; editor: PlanningEditor | null; edit: (editor: PlanningEditor | null) => void; disabled: boolean; save: () => void; cancel: () => void
}) {
  const [week, setWeek] = useState(() => weekStart(today()))
  const [view, setView] = useState<'week' | 'all'>('week')
  const [source, setSource] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const weekEditor = editor?.kind === 'week' ? editor : null
  const shownWeek = weekEditor?.value.weekStart ?? week
  const saved = snapshot.weekPlans.find(w => w.weekStart === shownWeek)
  const availability = weekEditor?.value.availability ?? saved?.availability ?? snapshot.availabilityTemplate
  const entries = weekEditor?.value.entries ?? saved?.entries ?? []
  const summary = weekSummary(snapshot, shownWeek, availability, entries)
  function newWeek(target = week) {
    const plan = snapshot.weekPlans.find(w => w.weekStart === target)
    edit({ kind: 'week', base: snapshot.revision, value: { weekStart: target, availability: structuredClone(plan?.availability ?? snapshot.availabilityTemplate), entries: structuredClone(plan?.entries ?? []), confirm: false } })
  }
  function patchEntry(id: string, patch: Partial<WeekEntry>) {
    if (weekEditor) edit({ ...weekEditor, value: { ...weekEditor.value, entries: entries.map(e => e.id === id ? { ...e, ...patch } : e) } })
  }
  function addEntry() {
    if (!weekEditor) return
    const task = snapshot.tasks.find(t => `task:${t.id}` === source), todo = snapshot.todos.find(t => `todo:${t.id}` === source)
    if (!task && !todo) return
    const entry: WeekEntry = { id: crypto.randomUUID(), taskId: task?.id ?? null, todoId: todo?.id ?? null, titleSnapshot: (task ?? todo)!.title,
      goalType: task ? 'progress' : 'todo', estimatedMinutes: todo?.estimatedMinutes ?? 0, targetUnits: task ? '' : null, unitName: task?.unitName ?? '', importance: 'normal', deadline: null, carryToNextWeek: false, cancelled: false }
    edit({ ...weekEditor, value: { ...weekEditor.value, entries: [...entries, entry] } }); setSource('')
  }
  const validation = weekEditor ? entriesSchema.safeParse(entries) : null
  return <section aria-label="待办与周计划">
    <div className="actions"><button disabled={!!editor} aria-pressed={view === 'week'} onClick={() => setView('week')}>本周计划</button><button disabled={!!editor} aria-pressed={view === 'all'} onClick={() => setView('all')}>全部待办</button>
      <button disabled={disabled || !!editor} onClick={() => edit({ kind: 'todo', base: snapshot.revision, value: { id: crypto.randomUUID(), title: '', estimatedMinutes: null, note: '', archived: false } })}>收集一次性待办</button></div>
    {editor && <section className="panel" aria-label="计划编辑器"><form onSubmit={e => { e.preventDefault(); save() }}><fieldset disabled={disabled}>
      <h2>{editor.kind === 'todo' ? '一次性待办' : editor.kind === 'template' ? '常规周可用时间模板' : `${editor.value.weekStart} 周计划编辑`}</h2>
      {editor.base !== snapshot.revision && <p role="alert">云端版本已改变，当前输入保留。请核对最新计划后重新应用。</p>}
      {editor.kind === 'todo' && <>
        <label>待办名称<input required maxLength={200} value={editor.value.title} onChange={e => edit({ ...editor, value: { ...editor.value, title: e.target.value } })} /></label>
        <label>预计分钟（可留空待估算）<input type="number" min={1} max={2147483647} step={1} value={editor.value.estimatedMinutes ?? ''} onChange={e => edit({ ...editor, value: { ...editor.value, estimatedMinutes: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
        <label>待办备注<textarea aria-label="待办备注" maxLength={5000} value={editor.value.note} onChange={e => edit({ ...editor, value: { ...editor.value, note: e.target.value } })} /></label>
        <label className="check"><input type="checkbox" checked={editor.value.archived} onChange={e => edit({ ...editor, value: { ...editor.value, archived: e.target.checked } })} />归档待办</label>
      </>}
      {editor.kind === 'template' && <><p>模板用于尚未保存的新周；已保存周及其例外保持原样。</p><AvailabilityPicker value={editor.value.availability} change={availability => edit({ ...editor, value: { availability } })} /></>}
      {weekEditor && <>
        <p>可用 {hours(summary.capacity)} · 计划投入 {hours(summary.planned)}。{summary.planned > summary.capacity ? `超出 ${hours(summary.planned - summary.capacity)}，仍可保存。` : `预留机动 ${hours(summary.capacity - summary.planned)}。`}</p>
        <label>从任务池或待办加入本周重点<select aria-label="从任务池或待办加入本周重点" value={source} onChange={e => setSource(e.target.value)}><option value="">选择一项任务</option>
          {snapshot.tasks.filter(t => !t.archived && !entries.some(e => e.taskId === t.id)).map(t => <option key={t.id} value={`task:${t.id}`}>{t.title} · {snapshot.categories.find(c => c.id === t.categoryId)?.name}</option>)}
          {snapshot.todos.filter(t => !t.archived && !entries.some(e => e.todoId === t.id)).map(t => <option key={t.id} value={`todo:${t.id}`}>{t.title} · 一次性待办</option>)}
        </select></label><button type="button" disabled={!source} onClick={addEntry}>加入本周重点</button>
        {entries.map(entry => <section className="panel" key={entry.id} aria-label={`编辑 ${entry.titleSnapshot}`}><h3>{entry.titleSnapshot}</h3>{entry.taskId && <p className="muted">{snapshot.categories.find(c => c.id === snapshot.tasks.find(t => t.id === entry.taskId)?.categoryId)?.name}</p>}
          {entry.taskId && <label>主要目标<select aria-label="主要目标" value={entry.goalType} onChange={e => patchEntry(entry.id, { goalType: e.target.value as 'progress' | 'time' })}><option value="progress">进度型</option><option value="time">投入型</option></select></label>}
          <label>{entry.goalType === 'time' ? '投入目标（分钟）' : '预计投入（分钟）'}<input required type="number" min={1} max={2147483647} step={1} value={entry.estimatedMinutes || ''} onChange={e => patchEntry(entry.id, { estimatedMinutes: Number(e.target.value) })} /></label>
          {entry.taskId && <label>本周新增量（{entry.unitName}，{entry.goalType === 'progress' ? '必填' : '可选参照'}）<input required={entry.goalType === 'progress'} inputMode="decimal" value={entry.targetUnits ?? ''} onChange={e => patchEntry(entry.id, { targetUnits: e.target.value || null })} /></label>}
          <label>重要程度<select aria-label="重要程度" value={entry.importance} onChange={e => patchEntry(entry.id, { importance: e.target.value as WeekEntry['importance'] })}><option value="normal">普通</option><option value="important">重要</option><option value="critical">最重要</option></select></label>
          <label>截止日期（可选）<input type="date" min="0001-01-01" max="9999-12-31" value={entry.deadline ?? ''} onChange={e => patchEntry(entry.id, { deadline: e.target.value || null })} /></label>
          <label className="check"><input type="checkbox" checked={entry.carryToNextWeek} onChange={e => patchEntry(entry.id, { carryToNextWeek: e.target.checked })} />下周可带入草稿（须重新确认目标）</label>
          <label className="check"><input type="checkbox" checked={entry.cancelled} onChange={e => patchEntry(entry.id, { cancelled: e.target.checked })} />取消本周承诺（保留历史与实际）</label>
          {!saved?.entries.some(e => e.id === entry.id) && <button type="button" onClick={() => edit({ ...weekEditor, value: { ...weekEditor.value, entries: entries.filter(e => e.id !== entry.id) } })}>移除未保存条目</button>}
        </section>)}
        {validation && !validation.success && <p role="alert">{validation.error.issues[0].message}</p>}
        <details><summary>本周可用时间例外</summary><p>仅修改这一周；保存后保留独立容量。</p><AvailabilityPicker value={availability} change={availability => edit({ ...weekEditor, value: { ...weekEditor.value, availability } })} /></details>
        {!snapshot.weekPlans.find(w => w.weekStart === shownWeek)?.confirmedAt && <label className="check"><input type="checkbox" checked={weekEditor.value.confirm} onChange={e => edit({ ...weekEditor, value: { ...weekEditor.value, confirm: e.target.checked } })} />确认初始计划，留存此次目标作为周初参照</label>}
        <p>未勾选确认时保存为草稿；确认后修改会追加调整历史。</p>
      </>}
      <div className="actions"><button type="submit" disabled={(!!validation && !validation.success) || editor.base !== snapshot.revision}>保存到云端</button><button type="button" onClick={cancel}>取消计划编辑</button>
        {editor.base !== snapshot.revision && <button type="button" onClick={() => { if (window.confirm('已核对最新列表和当前全部输入？继续将以当前输入更新最新版本。')) edit({ ...editor, base: snapshot.revision }) }}>已核对，将此输入应用到最新版本</button>}</div>
    </fieldset></form></section>}
    {view === 'all' ? <section className="panel"><h2>全部待办</h2><label className="check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />显示归档待办</label>
      {snapshot.todos.filter(t => showArchived || !t.archived).map(t => <article className="panel" key={t.id}><h3>{t.title}{t.archived && '（已归档）'}</h3><p>{t.estimatedMinutes === null ? '待估算' : `预计 ${hours(t.estimatedMinutes)}`}</p><p>{t.note}</p>
        <p>执行周：{snapshot.weekPlans.filter(w => w.entries.some(e => e.todoId === t.id && !e.cancelled)).map(w => w.weekStart).join('、') || '尚未指定'}</p>
        <button disabled={disabled || !!editor} onClick={() => { const { id, title, estimatedMinutes, note, archived } = t; edit({ kind: 'todo', base: snapshot.revision, value: { id, title, estimatedMinutes, note, archived } }) }}>编辑待办</button>
      </article>)}{!snapshot.todos.length && <p>尚无一次性待办，可先收集，再到本周计划选择执行周。</p>}</section> : <>
      <div className="actions"><button disabled={!!editor || week <= '0001-01-07'} onClick={() => setWeek(addDays(week, -7))}>上一周</button><label>选择执行周<input type="date" min="0001-01-01" max="9999-12-31" disabled={!!editor} value={shownWeek} onChange={e => { if (isBusinessDate(e.target.value)) setWeek(weekStart(e.target.value)) }} /></label><button disabled={!!editor || week >= '9999-12-24'} onClick={() => setWeek(addDays(week, 7))}>下一周</button><button disabled={!!editor} onClick={() => setWeek(weekStart(today()))}>回到本周</button></div>
      <section className="panel"><h2>{dateLabel(shownWeek)} 起的周计划</h2><p>{saved ? saved.confirmedAt ? '已确认初始计划' : '已保存草稿，尚未确认' : '尚未保存；可用时间暂按常规模板预览'}</p>
        <div className="planning-metrics"><p>可用时间<br /><strong>{hours(summary.capacity)}</strong></p><p>计划投入<br /><strong>{hours(summary.planned)}</strong></p><p>已排时间<br /><strong>{hours(summary.scheduled)}</strong></p><p>实际投入<br /><strong>{hours(summary.actual)}</strong></p></div>
        <p className="notice">{summary.planned > summary.capacity ? `计划超出 ${hours(summary.planned - summary.capacity)}，可以调整或保留。` : `预留机动 ${hours(summary.capacity - summary.planned)}。`}建议初期承诺约 80% 可用时间，不作为硬性上限。</p><p>可用时段外的额外安排：{hours(summary.extra)}。实际投入包含未纳入周计划的学习。</p>
        <ul>{entries.map(entry => <EntrySummary key={entry.id} entry={entry} />)}</ul>{saved?.initialEntries && <p>确认后新增：{entries.filter(e => !saved.initialEntries!.some(i => i.id === e.id)).map(e => e.titleSnapshot).join('、') || '无'}</p>}
        {!entries.length && <p>本周尚无重点任务。</p>}
        <div className="actions"><button disabled={disabled || !!editor} onClick={() => newWeek()}>编辑本周计划</button><button disabled={disabled || !!editor} onClick={() => edit({ kind: 'template', base: snapshot.revision, value: { availability: structuredClone(snapshot.availabilityTemplate) } })}>编辑常规可用时间模板</button>
          <button disabled={disabled || !!editor || !!saved?.confirmedAt || week <= '0001-01-07'} onClick={() => {
            const previous = snapshot.weekPlans.find(w => w.weekStart === addDays(week, -7))
            edit({ kind: 'week', base: snapshot.revision, value: { weekStart: week, availability: structuredClone(availability), entries: [...entries, ...carryDraft(previous?.entries ?? [], entries, () => crypto.randomUUID())], confirm: false } })
          }}>从上周带入已勾选的草稿</button></div>
      </section>
      {saved && <section className="panel"><h2>初始计划与调整历史</h2>{saved.initialEntries ? <><p>初始确认：{new Date(saved.confirmedAt!).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p><ul>{saved.initialEntries.map(entry => <EntrySummary key={entry.id} entry={entry} />)}</ul></> : <p>尚未确认初始计划。</p>}
        {saved.history.map((h, i) => <details key={i}><summary>版本 {i + 1} · {new Date(h.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}{h.at === saved.confirmedAt ? ' · 初始确认' : saved.confirmedAt && Date.parse(h.at) > Date.parse(saved.confirmedAt) ? ' · 确认后调整' : ' · 草稿'}</summary><p>可用 {hours(capacityMinutes(h.availability))}</p><ul>{h.entries.map(entry => <EntrySummary key={entry.id} entry={entry} />)}</ul></details>)}
      </section>}
    </>}
  </section>
}
