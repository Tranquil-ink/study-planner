import { Fragment, useEffect, useRef, useState } from 'react'
import { addDays, clockTime, dateLabel, isBusinessDate, plannedMinutes, SLOTS, today, weekDates } from '../../domain/calendar'
import type { ScheduleInput, Snapshot } from '../../domain/model'
export interface ScheduleEditor { value: ScheduleInput; base: number; existing: boolean }
export function Calendar({ snapshot, editor, disabled, edit, save, remove, cancel }: {
  snapshot: Snapshot; editor: ScheduleEditor | null; disabled: boolean; edit: (value: ScheduleEditor) => void;
  save: () => void; remove: () => void; cancel: () => void;
}) {
  const editorRegion = useRef<HTMLElement>(null)
  const editingId = editor?.value.id
  useEffect(() => {
    if (editingId) {
      editorRegion.current?.focus({ preventScroll: true })
      editorRegion.current?.scrollIntoView({ block: 'start' })
    }
  }, [editingId])
  const [date, setDate] = useState(today)
  const [view, setView] = useState<'day' | 'week'>(() => window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week')
  const dates = view === 'day' ? [date] : weekDates(date)
  const week = weekDates(date)
  const weekly = snapshot.schedules.filter(s => week.includes(s.date))
  const summaries = new Map<string, { title: string; minutes: number }>()
  for (const task of snapshot.tasks) {
    if (!task.archived && !snapshot.categories.find(c => c.id === task.categoryId)?.archived) summaries.set(task.id, { title: task.title, minutes: 0 })
  }
  for (const block of weekly) {
    const key = block.taskId ?? `temporary:${block.id}`
    const entry = summaries.get(key) ?? { title: snapshot.tasks.find(t => t.id === block.taskId)?.title ?? block.title, minutes: 0 }
    entry.minutes += plannedMinutes(block); summaries.set(key, entry)
  }
  function adjacent(direction: number) { try { return addDays(date, direction * (view === 'day' ? 1 : 7)) } catch { return null } }
  function patch(value: Partial<ScheduleInput>) { if (editor) edit({ ...editor, value: { ...editor.value, ...value } }) }
  const missing = !!editor?.existing && !snapshot.schedules.some(s => s.id === editor.value.id)
  return <section aria-label="日历排程">
    <div className="panel calendar-toolbar">
      <div className="actions"><button aria-pressed={view === 'day'} onClick={() => setView('day')}>日视图</button><button aria-pressed={view === 'week'} onClick={() => setView('week')}>周视图</button></div>
      <label>选择日期<input type="date" min="0001-01-01" max="9999-12-31" value={date} onChange={e => { if (isBusinessDate(e.target.value)) setDate(e.target.value) }} /></label>
      <div className="actions"><button disabled={!adjacent(-1)} onClick={() => setDate(adjacent(-1)!)}>上一{view === 'day' ? '日' : '周'}</button><button onClick={() => setDate(today())}>回到今天</button><button disabled={!adjacent(1)} onClick={() => setDate(adjacent(1)!)}>下一{view === 'day' ? '日' : '周'}</button></div>
      <p>Asia/Shanghai · 周一开始 · {view === 'day' ? dateLabel(date) : `${dates[0]} ～ ${dates.at(-1)}`}</p>
    </div>
    {editor && <section ref={editorRegion} tabIndex={-1} className="panel" aria-label="日程编辑表单">
      <h2>{editor.existing ? '编辑日程' : '新建日程'}</h2>
      <p>{dateLabel(editor.value.date)} · {clockTime(editor.value.startMinute)}–{clockTime(editor.value.endMinute)} · 计划 {plannedMinutes(editor.value)} 分钟</p>
      <form onSubmit={e => { e.preventDefault(); save() }}>
        <fieldset disabled={disabled || missing}>
          <label>日程日期<input type="date" min="0001-01-01" max="9999-12-31" required value={editor.value.date} onChange={e => patch({ date: e.target.value })} /></label>
          <div><label htmlFor="schedule-slot">基础时段</label><select id="schedule-slot" value={editor.value.slotIds[0]} onChange={e => {
            const slot = SLOTS.find(s => s.id === Number(e.target.value))!
            patch({ slotIds: [slot.id], startMinute: slot.startMinute, endMinute: slot.endMinute })
          }}>{SLOTS.map(s => <option key={s.id} value={s.id}>{clockTime(s.startMinute)}–{clockTime(s.endMinute)}（{plannedMinutes(s)} 分钟）</option>)}</select></div>
          <div><label htmlFor="schedule-kind">安排类型</label><select id="schedule-kind" value={editor.value.taskId === null ? 'temporary' : 'task'} onChange={e => patch(e.target.value === 'temporary' ? { taskId: null, title: '' } : { taskId: '', title: '' })}><option value="temporary">临时任务</option><option value="task">任务池中的长期任务</option></select></div>
          {editor.value.taskId === null ? <label>临时任务名称<input required maxLength={200} value={editor.value.title} onChange={e => patch({ title: e.target.value })} /></label> : <div><label htmlFor="schedule-task">关联长期任务</label><select id="schedule-task" required value={editor.value.taskId} onChange={e => patch({ taskId: e.target.value, title: snapshot.tasks.find(t => t.id === e.target.value)?.title ?? '' })}><option value="">请选择任务</option>{snapshot.tasks.filter(t => (!t.archived && !snapshot.categories.find(c => c.id === t.categoryId)?.archived) || t.id === editor.value.taskId).map(t => <option value={t.id} key={t.id}>{t.title}{t.archived ? '（已归档）' : ''}</option>)}</select></div>}
          <label>计划学习范围<input maxLength={500} value={editor.value.plannedRangeText} placeholder="例如 2.1～2.3" onChange={e => patch({ plannedRangeText: e.target.value })} /></label>
          <div><label htmlFor="schedule-note">日程备注</label><textarea id="schedule-note" maxLength={5000} value={editor.value.note} onChange={e => patch({ note: e.target.value })} /></div>
        </fieldset>
        <p className="muted">排程仅保存计划，不增加任务进度或实际投入。输入在云端确认前保留。</p>
        {missing && <p role="alert">此日程已被移除或不在恢复后的数据中。请复制需要的输入，取消后另建日程。</p>}
        {editor.base !== snapshot.revision && <div className="notice"><p>云端版本已变化，请对照下方最新日历核对；旧表单不会自动覆盖。</p><button type="button" disabled={disabled || missing} onClick={() => { if (window.confirm('已核对最新日程与当前输入？继续后将以当前输入更新最新版本。')) edit({ ...editor, base: snapshot.revision }) }}>已核对，将日程输入应用到最新版本</button></div>}
        <div className="actions"><button disabled={disabled || missing || editor.base !== snapshot.revision}>保存日程到云端</button>{editor.existing && <button type="button" disabled={disabled || missing || editor.base !== snapshot.revision} onClick={remove}>移除此日程</button>}<button type="button" disabled={disabled} onClick={cancel}>取消日程编辑</button></div>
      </form>
    </section>}
    {view === 'week' && <p className="muted">周历可在下方区域横向滚动；手机可切换日视图完成全部编辑。</p>}
    <div className="calendar-scroll" tabIndex={view === 'week' ? 0 : undefined} aria-label="日历时段区域">
      <div className={`calendar-grid ${view}`} style={{ gridTemplateColumns: `100px repeat(${dates.length}, minmax(0, 1fr))` }}>
        <div className="calendar-heading">时间</div>{dates.map(d => <div className={`calendar-heading ${d === today() ? 'is-today' : ''}`} key={d}>{dateLabel(d)}{d === today() && ' · 今天'}</div>)}
        {SLOTS.map(slot => <Fragment key={slot.id}>
          {(slot.id === 5 || slot.id === 9) && <div className="calendar-break" style={{ gridColumn: '1 / -1' }}>{slot.id === 5 ? '12:00–13:00 午休' : '17:00–18:30 晚饭间隔'}</div>}
          <div className="calendar-time">{clockTime(slot.startMinute)}<br />–{clockTime(slot.endMinute)}<small>{plannedMinutes(slot)} 分钟</small></div>
          {dates.map(d => {
            const block = snapshot.schedules.find(s => s.date === d && s.slotIds[0] === slot.id)
            const task = snapshot.tasks.find(t => t.id === block?.taskId)
            const category = snapshot.categories.find(c => c.id === task?.categoryId)
            const title = task?.title ?? block?.title
            return <button className={`calendar-slot ${block ? 'occupied' : ''}`} key={d} disabled={disabled || !!editor} aria-label={`${d} ${clockTime(slot.startMinute)} ${block ? `编辑 ${title}` : '安排日程'}`} style={category ? { borderLeftColor: category.color } : undefined} onClick={() => edit({ base: snapshot.revision, existing: !!block, value: block ? { id: block.id, date: block.date, slotTemplateVersion: block.slotTemplateVersion, slotIds: block.slotIds, startMinute: block.startMinute, endMinute: block.endMinute, taskId: block.taskId, title: block.title, plannedRangeText: block.plannedRangeText, note: block.note } : { id: crypto.randomUUID(), date: d, slotTemplateVersion: 1, slotIds: [slot.id], startMinute: slot.startMinute, endMinute: slot.endMinute, taskId: null, title: '', plannedRangeText: '', note: '' } })}>
              {block ? <><strong>{title}</strong><span>{category?.name ?? '临时任务'}{task?.archived ? ' · 已归档' : ''}</span><span>{block.plannedRangeText || '未填写范围'}</span><span>计划 {plannedMinutes(block)} 分钟</span><small>实际记录尚未开放</small></> : <span>＋ 安排</span>}
            </button>
          })}
        </Fragment>)}
      </div>
    </div>
    <section className="panel"><h2>本周安排</h2><p>{week[0]} ～ {week.at(-1)} · 已排 {weekly.reduce((sum, s) => sum + plannedMinutes(s), 0)} 分钟</p><p>周预算：未设置 · 实际投入：尚未开放</p>{[...summaries].map(([id, row]) => <p key={id}>{row.title} · 周预算：未设置 / 已排：{row.minutes} 分钟 / 实际：尚未开放</p>)}</section>
  </section>
}
