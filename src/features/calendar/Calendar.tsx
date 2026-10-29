import { Fragment, useEffect, useRef, useState, type ComponentProps } from 'react'
import { addDays, clockTime, dateLabel, isBusinessDate, plannedMinutes, slotsFor, SLOT_TEMPLATE_VERSION, today, weekDates } from '../../domain/calendar'
import { WorkLogs } from '../work-logs/WorkLogs'
import type { ScheduleBlock, ScheduleInput, Snapshot } from '../../domain/model'
export interface ScheduleEditor { value: ScheduleInput; base: number; existing: boolean; mergeIds?: string[]; contentConfirmed?: boolean; contentSourceId?: string }
export function Calendar({ snapshot, editor, disabled, edit, save, remove, split, cancel, workLogs, record }: {
  snapshot: Snapshot; editor: ScheduleEditor | null; disabled: boolean; edit: (value: ScheduleEditor) => void;
  workLogs: Omit<ComponentProps<typeof WorkLogs>, 'snapshot' | 'date'>; record: (block: ScheduleBlock) => void;
  save: () => void; remove: () => void; split: (copyPlanText: boolean) => void; cancel: () => void;
}) {
  const editorRegion = useRef<HTMLElement>(null)
  const editingId = editor?.value.id
  useEffect(() => {
    if (editingId) {
      editorRegion.current?.focus({ preventScroll: true })
      editorRegion.current?.scrollIntoView({ block: 'start' })
    }
  }, [editingId])
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [selectionError, setSelectionError] = useState('')
  const [copyPlanText, setCopyPlanText] = useState(false)
  const [date, setDate] = useState(today)
  const [view, setView] = useState<'day' | 'week'>(() => window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week')
  const dates = view === 'day' ? [date] : weekDates(date)
  const week = weekDates(date)
  const weekly = snapshot.schedules.filter(s => week.includes(s.date))
  const summaries = new Map<string, { title: string; minutes: number; actual: number }>()
  for (const task of snapshot.tasks) {
    if (!task.archived && !snapshot.categories.find(c => c.id === task.categoryId)?.archived) summaries.set(task.id, { title: task.title, minutes: 0, actual: 0 })
  }
  for (const block of weekly) {
    const key = block.taskId ?? `temporary:${block.id}`
    const entry = summaries.get(key) ?? { title: snapshot.tasks.find(t => t.id === block.taskId)?.title ?? block.title, minutes: 0, actual: 0 }
    entry.minutes += plannedMinutes(block); summaries.set(key, entry)
  }
  const actualWeek = snapshot.workLogs.filter(l => week.includes(l.date))
  for (const log of actualWeek) {
    const key = log.taskId ?? (log.scheduleBlockId ? `temporary:${log.scheduleBlockId}` : `actual:${log.titleSnapshot}`)
    const entry = summaries.get(key) ?? { title: snapshot.tasks.find(t => t.id === log.taskId)?.title ?? log.titleSnapshot, minutes: 0, actual: 0 }
    entry.actual += log.actualMinutes; summaries.set(key, entry)
  }
  const hasLogs = !!editor && snapshot.workLogs.some(l => l.scheduleBlockId === editor.value.id)
  function adjacent(direction: number) { try { return addDays(date, direction * (view === 'day' ? 1 : 7)) } catch { return null } }
  function patch(value: Partial<ScheduleInput>) { if (editor) edit({ ...editor, value: { ...editor.value, ...value } }) }
  const missing = !!editor && (editor.mergeIds ? editor.mergeIds.some(id => !snapshot.schedules.some(s => s.id === id)) : editor.existing && !snapshot.schedules.some(s => s.id === editor.value.id))
  const sources = editor?.mergeIds?.map(id => snapshot.schedules.find(s => s.id === id)).filter(s => !!s) ?? []
  const differing = sources.some(s => s.taskId !== sources[0].taskId || s.title !== sources[0].title || s.plannedRangeText !== sources[0].plannedRangeText || s.note !== sources[0].note)
  const decisionsMade = !differing || sources.some(s => s.id === editor?.contentSourceId)
  const editorSlots = slotsFor(editor?.value.slotTemplateVersion ?? SLOT_TEMPLATE_VERSION)
  // Include the historical 20:15 boundary only where needed to render immutable old snapshots.
  const template = SLOT_TEMPLATE_VERSION
  const slots = slotsFor(template)
  const historicalEvening = snapshot.schedules.some(s => dates.includes(s.date) && s.slotTemplateVersion === 1 && s.endMinute > 1110)
  const displaySlots = slots.flatMap(s => historicalEvening && s.id === 10 ? [{ ...s, endMinute: 1215 }, { ...s, startMinute: 1215 }] : [s])
  const gridRow = (index: number) => index + 2 + (displaySlots[index].startMinute >= 780 ? 1 : 0) + (displaySlots[index].startMinute >= 1110 ? 1 : 0)
  function beginMerge() {
    const rows = selected.map(id => snapshot.schedules.find(s => s.id === id)).filter(s => !!s).sort((a, b) => a.startMinute - b.startMinute)
    if (rows.length < 2 || rows.some((s, i) => s.date !== rows[0].date || (i > 0 && rows[i - 1].endMinute !== s.startMinute))) {
      setSelectionError('请选择同一天、真实时间连续的至少两个安排；不能跨午休或晚饭。'); return
    }
    if (rows.some(s => snapshot.workLogs.some(l => l.scheduleBlockId === s.id))) { setSelectionError('已有实际记录的日程不能合并；仍可修改实际记录。'); return }
    const first = rows[0]
    const { createdAt: _created, updatedAt: _updated, ...value } = first
    void _created; void _updated
    edit({ base: snapshot.revision, existing: false, mergeIds: rows.map(s => s.id), contentConfirmed: false,
      value: { ...value, slotIds: rows.flatMap(s => s.slotIds), endMinute: rows.at(-1)!.endMinute } })
    setSelecting(false); setSelected([]); setSelectionError('')
  }
  return <section aria-label="日历排程">
    <div className="panel calendar-toolbar">
      <div className="actions"><button aria-pressed={view === 'day'} onClick={() => setView('day')}>日视图</button><button aria-pressed={view === 'week'} onClick={() => setView('week')}>周视图</button></div>
      <label>选择日期<input type="date" min="0001-01-01" max="9999-12-31" value={date} onChange={e => { if (isBusinessDate(e.target.value)) setDate(e.target.value) }} /></label>
      <div className="actions"><button disabled={!adjacent(-1)} onClick={() => setDate(adjacent(-1)!)}>上一{view === 'day' ? '日' : '周'}</button><button onClick={() => setDate(today())}>回到今天</button><button disabled={!adjacent(1)} onClick={() => setDate(adjacent(1)!)}>下一{view === 'day' ? '日' : '周'}</button></div>
      <p>Asia/Shanghai · 周一开始 · {view === 'day' ? dateLabel(date) : `${dates[0]} ～ ${dates.at(-1)}`}</p>
    </div>
    <WorkLogs {...workLogs} snapshot={snapshot} date={date} />
    {editor && <section ref={editorRegion} tabIndex={-1} className="panel" aria-label="日程编辑表单">
      <h2>{editor.mergeIds ? '合并时段：确认最终内容' : editor.existing ? '编辑日程' : '新建日程'}</h2>
      <p>{dateLabel(editor.value.date)} · {clockTime(editor.value.startMinute)}–{clockTime(editor.value.endMinute)} · 计划 {plannedMinutes(editor.value)} 分钟</p>
      <form onSubmit={e => { e.preventDefault(); if (!editor.mergeIds || (editor.contentConfirmed && decisionsMade)) save() }}>
        <fieldset disabled={disabled || missing}>
          {editor.mergeIds ? <div>
            <p>请选择合并后要保留的内容。</p>
            {sources.map(row => <p key={row.id}>{clockTime(row.startMinute)}–{clockTime(row.endMinute)} · {snapshot.tasks.find(t => t.id === row.taskId)?.title ?? row.title} · 范围：{row.plannedRangeText || '空'} · 备注：{row.note || '空'}</p>)}
            {differing && <div><label htmlFor="merge-task">合并后保留哪个任务的内容</label><select id="merge-task" value={editor.contentSourceId ?? ''} onChange={e => {
              const row = sources.find(r => r.id === e.target.value)
              if (row) edit({ ...editor, contentSourceId: row.id, contentConfirmed: false, value: { ...editor.value, taskId: row.taskId, title: row.title, plannedRangeText: row.plannedRangeText, note: row.note } })
            }}><option value="">请选择一个原日程</option>{sources.map(row => <option key={row.id} value={row.id}>{clockTime(row.startMinute)}：{snapshot.tasks.find(t => t.id === row.taskId)?.title ?? row.title}</option>)}</select><p>任务、计划范围和备注一起沿用所选日程。</p></div>}
            <p>合并结果：{snapshot.tasks.find(t => t.id === editor.value.taskId)?.title ?? editor.value.title} · 范围：{editor.value.plannedRangeText || '空'} · 备注：{editor.value.note || '空'}</p>
          </div> : <>
          <label>日程日期<input type="date" min="0001-01-01" max="9999-12-31" required value={editor.value.date} onChange={e => patch({ date: e.target.value })} /></label>
          <div><label htmlFor="schedule-slot">基础时段（起点）</label><select id="schedule-slot" value={editor.value.slotIds[0]} onChange={e => {
            const index = editorSlots.findIndex(s => s.id === Number(e.target.value))
            const span = editorSlots.slice(index, index + editor.value.slotIds.length)
            patch({ slotIds: span.map(s => s.id), startMinute: span[0].startMinute, endMinute: span.at(-1)!.endMinute })
          }}>{editorSlots.map((s, index) => <option key={s.id} value={s.id} disabled={index + editor.value.slotIds.length > editorSlots.length}>{clockTime(s.startMinute)}–{clockTime(s.endMinute)}（{plannedMinutes(s)} 分钟）</option>)}</select></div>
          {!editor.existing && <div><label htmlFor="schedule-end">结束基础时段</label><select id="schedule-end" value={editor.value.slotIds.at(-1)} onChange={e => {
            const span = editorSlots.filter(s => s.id >= editor.value.slotIds[0] && s.id <= Number(e.target.value))
            patch({ slotIds: span.map(s => s.id), endMinute: span.at(-1)!.endMinute })
          }}>{editorSlots.filter(s => s.id >= editor.value.slotIds[0]).map(s => <option key={s.id} value={s.id}>{clockTime(s.endMinute)}</option>)}</select></div>}
          </>}
          {!editor.mergeIds && <><div><label htmlFor="schedule-kind">安排类型</label><select id="schedule-kind" value={editor.value.taskId === null ? 'temporary' : 'task'} onChange={e => patch(e.target.value === 'temporary' ? { taskId: null, title: '' } : { taskId: '', title: '' })}><option value="temporary">临时任务</option><option value="task">任务池中的长期任务</option></select></div>
          {editor.value.taskId === null ? <label>临时任务名称<input required maxLength={200} value={editor.value.title} onChange={e => patch({ title: e.target.value })} /></label> : <div><label htmlFor="schedule-task">关联长期任务</label><select id="schedule-task" required value={editor.value.taskId} onChange={e => patch({ taskId: e.target.value, title: snapshot.tasks.find(t => t.id === e.target.value)?.title ?? '' })}><option value="">请选择任务</option>{snapshot.tasks.filter(t => (!t.archived && !snapshot.categories.find(c => c.id === t.categoryId)?.archived) || t.id === editor.value.taskId).map(t => <option value={t.id} key={t.id}>{t.title}{t.archived ? '（已归档）' : ''}</option>)}</select></div>}
          <label>计划学习范围<input maxLength={500} value={editor.value.plannedRangeText} placeholder="例如 2.1～2.3" onChange={e => patch({ plannedRangeText: e.target.value })} /></label>
          <div><label htmlFor="schedule-note">日程备注</label><textarea id="schedule-note" maxLength={5000} value={editor.value.note} onChange={e => patch({ note: e.target.value })} /></div></>}
        </fieldset>
        {editor.mergeIds && <label className="check"><input type="checkbox" disabled={disabled || !decisionsMade} checked={editor.contentConfirmed ?? false} onChange={e => edit({ ...editor, contentConfirmed: e.target.checked })} />我已明确选择并确认合并后的任务、计划范围和备注</label>}
        {editor.existing && !hasLogs && editor.value.slotIds.length > 1 && <div className="notice"><label className="check"><input type="checkbox" disabled={disabled} checked={copyPlanText} onChange={e => setCopyPlanText(e.target.checked)} />拆分时复制计划范围和备注到每个基础时段</label><p>不勾选时，文字只保留在第一个时段。任务关联保留，计划总分钟数不变。拆分以云端已保存内容为准，表单修改请先保存。</p><button type="button" disabled={disabled || missing || editor.base !== snapshot.revision} onClick={() => { if (window.confirm('将云端已保存日程拆分为基础时段？未保存的表单修改不会包含在拆分中。')) split(copyPlanText) }}>拆分恢复基础时段</button></div>}
        {editor.existing && <div className="notice"><p>{hasLogs ? '已有实际记录，不能合并或拆分。移动日期不移动实际记录；更换任务或移除日程将保留实际记录并解除关联。' : '可按已保存的日程填写实际学习；本表单未保存的修改不会带入。'}</p><button type="button" disabled={disabled || missing || editor.base !== snapshot.revision} onClick={() => { const block = snapshot.schedules.find(s => s.id === editor.value.id); if (block && window.confirm('转到实际记录？将使用云端已保存的日程，放弃本表单未保存的修改。')) record(block) }}>记录此日程的实际学习</button></div>}
        <p className="muted">排程仅保存计划，不增加任务进度或实际投入。输入在云端确认前保留。</p>
        {missing && <p role="alert">此日程已被移除或不在恢复后的数据中。请复制需要的输入，取消后另建日程。</p>}
        {editor.base !== snapshot.revision && <div className="notice"><p>云端版本已变化，请对照下方最新日历核对；旧表单不会自动覆盖。</p><button type="button" disabled={disabled || missing} onClick={() => { if (window.confirm('已核对最新日程与当前输入？继续后将以当前输入更新最新版本。')) {
          const source = sources.find(s => s.id === editor.contentSourceId) ?? sources[0]
          edit({ ...editor, base: snapshot.revision, contentConfirmed: false, contentSourceId: undefined, value: source ? { ...editor.value, taskId: source.taskId, title: source.title, plannedRangeText: source.plannedRangeText, note: source.note } : editor.value })
        } }}>已核对，将日程输入应用到最新版本</button></div>}
        <div className="actions"><button disabled={disabled || missing || editor.base !== snapshot.revision || (!!editor.mergeIds && (!editor.contentConfirmed || !decisionsMade))}>{editor.mergeIds ? '确认合并到云端' : '保存日程到云端'}</button>{editor.existing && <button type="button" disabled={disabled || missing || editor.base !== snapshot.revision} onClick={remove}>移除此日程</button>}<button type="button" disabled={disabled} onClick={cancel}>取消日程编辑</button></div>
      </form>
    </section>}
    {snapshot.schedules.some(s => dates.includes(s.date) && s.slotTemplateVersion === 1) && <p className="notice">此日期范围含历史安排，卡片保留原时间；新安排使用晚间 90／60／60 分钟，与历史安排重叠时不可保存。</p>}
    {!editor && <div className="panel"><button disabled={disabled} onClick={() => { setSelecting(!selecting); setSelected([]); setSelectionError('') }}>{selecting ? '取消选择时段' : '选择时段合并'}</button>{selecting && <><p>点击已有安排选择／取消；合并块可再次合并。空白连续时段可通过“安排”的结束基础时段一次创建。</p><button disabled={disabled || selected.length < 2} onClick={beginMerge}>合并所选安排（{selected.length}）</button></>}{selectionError && <p role="alert">{selectionError}</p>}</div>}
    {view === 'week' && <p className="muted">周历可在下方区域横向滚动；手机可切换日视图完成全部编辑。</p>}
    <div className="calendar-scroll" tabIndex={view === 'week' ? 0 : undefined} aria-label="日历时段区域">
      <div className={`calendar-grid ${view}`} style={{ gridTemplateColumns: `100px repeat(${dates.length}, minmax(0, 1fr))` }}>
        <div className="calendar-heading">时间</div>{dates.map(d => <div className={`calendar-heading ${d === today() ? 'is-today' : ''}`} key={d}>{dateLabel(d)}{d === today() && ' · 今天'}</div>)}
        {displaySlots.map((slot, index) => <Fragment key={slot.startMinute}>
          {(slot.id === 5 || slot.id === 9) && <div className="calendar-break" style={{ gridColumn: '1 / -1', gridRow: gridRow(index) - 1 }}>{slot.id === 5 ? '12:00–13:00 午休' : '17:00–18:30 晚饭间隔'}</div>}
          <div className="calendar-time" style={{ gridColumn: 1, gridRow: gridRow(index) }}>{clockTime(slot.startMinute)}<br />–{clockTime(slot.endMinute)}<small>{plannedMinutes(slot)} 分钟</small></div>
          {dates.map((d, column) => {
            const block = snapshot.schedules.find(s => s.date === d && s.startMinute < slot.endMinute && slot.startMinute < s.endMinute)
            if (block && block.startMinute < slot.startMinute) return null
            const baseSlot = slots.find(s => s.id === slot.id)!
            const span = block ? displaySlots.filter(s => s.startMinute >= block.startMinute && s.endMinute <= block.endMinute).length : 1
            const task = snapshot.tasks.find(t => t.id === block?.taskId)
            const category = snapshot.categories.find(c => c.id === task?.categoryId)
            const title = task?.title ?? block?.title
            return <button className={`calendar-slot ${block ? 'occupied' : ''}`} key={d} aria-pressed={selecting ? !!block && selected.includes(block.id) : undefined} disabled={disabled || !!editor || (selecting && !block)} aria-label={`${d} ${clockTime(slot.startMinute)} ${block ? `编辑 ${title}` : '安排日程'}`} style={{ borderLeftColor: category?.color, gridColumn: column + 2, gridRow: `${gridRow(index)} / span ${span}` }} onClick={() => { if (selecting && block) { setSelected(selected.includes(block.id) ? selected.filter(id => id !== block.id) : [...selected, block.id]); return } edit({ base: snapshot.revision, existing: !!block, value: block ? { id: block.id, date: block.date, slotTemplateVersion: block.slotTemplateVersion, slotIds: block.slotIds, startMinute: block.startMinute, endMinute: block.endMinute, taskId: block.taskId, title: block.title, plannedRangeText: block.plannedRangeText, note: block.note } : { id: crypto.randomUUID(), date: d, slotTemplateVersion: template as 1 | 2, slotIds: [baseSlot.id], startMinute: baseSlot.startMinute, endMinute: baseSlot.endMinute, taskId: null, title: '', plannedRangeText: '', note: '' } }); setCopyPlanText(false) }}>
              {block ? <><strong>{title}</strong><span>{category?.name ?? '临时任务'}{task?.archived ? ' · 已归档' : ''}</span><span>{block.plannedRangeText || '未填写范围'}</span><span>{clockTime(block.startMinute)}–{clockTime(block.endMinute)} · 计划 {plannedMinutes(block)} 分钟{block.slotIds.length > 1 ? '（合并安排）' : ''}</span><small>{snapshot.workLogs.some(l => l.scheduleBlockId === block.id) ? `已有实际记录 · ${snapshot.workLogs.filter(l => l.scheduleBlockId === block.id).reduce((sum, l) => sum + l.actualMinutes, 0)} 分钟` : '未记录实际学习'}</small></> : <span>＋ 安排</span>}
            </button>
          })}
        </Fragment>)}
      </div>
    </div>
    <section className="panel"><h2>本周安排</h2><p>{week[0]} ～ {week.at(-1)} · 已排 {weekly.reduce((sum, s) => sum + plannedMinutes(s), 0)} 分钟</p><p>周预算：未设置 · 实际投入：{actualWeek.reduce((sum, l) => sum + l.actualMinutes, 0)} 分钟</p>{[...summaries].map(([id, row]) => <p key={id}>{row.title} · 周预算：未设置 / 已排：{row.minutes} 分钟 / 实际：{row.actual} 分钟</p>)}</section>
  </section>
}
