import { useEffect, useRef, type ReactNode } from 'react'
import { dateLabel, minutesLabel, sumMinutes, WEEKDAYS } from '../../domain/calendar'
import { subjectKey, type Command, type Dataset, type Subject } from '../../domain/model'
import { entrySubject, isPlannable, poolEntries, PRIORITY_LABEL, selectedEntry, sortPool } from '../../domain/planning'

type EditableCommand = Extract<Command, { type: 'saveCategory' | 'saveProject' | 'saveTask' | 'saveTodo'
  | 'saveSchedule' | 'saveWorkLog' | 'saveWeekItem' | 'carryWeekItem' | 'saveWeekCapacity' | 'saveCapacityTemplate' }>
export interface Editor {
  command: EditableCommand
  base: number
  existing?: boolean
  lockedSubject?: boolean
  title?: string
}

const titles: Record<EditableCommand['type'], string> = {
  saveCategory: '分类', saveProject: '项目', saveTask: '长期任务', saveTodo: '一次性待办',
  saveSchedule: '按天安排', saveWorkLog: '实际学习记录', saveWeekItem: '本周目标', carryWeekItem: '结转到下周',
  saveWeekCapacity: '本周可用时间', saveCapacityTemplate: '常规周容量模板',
}

function MinutesField({ label, value, max, onChange, required = true, min = 1 }: {
  label: string; value: number | null; max: number; onChange: (v: number | null) => void; required?: boolean; min?: number
}) {
  return <label>{label}<input type="number" inputMode="numeric" min={min} max={max} step={1} required={required}
    value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></label>
}

function TextField({ label, value, onChange, max = 200, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; max?: number; placeholder?: string
}) {
  return <label>{label}<input value={value} required maxLength={max} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <label>备注（可选）<textarea rows={3} value={value} maxLength={5000} onChange={e => onChange(e.target.value)} /></label>
}

function DateField({ label, value, onChange, required = false, max = '9999-12-31' }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; max?: string
}) {
  return <label>{label}<input type="date" min="0001-01-01" max={max} required={required} value={value} onChange={e => onChange(e.target.value)} /></label>
}

function PriorityFields({ priority, dueDate, onChange }: {
  priority: keyof typeof PRIORITY_LABEL; dueDate: string | null;
  onChange: (patch: { priority?: keyof typeof PRIORITY_LABEL; dueDate?: string | null }) => void
}) {
  return <div className="form-pair">
    <label>重要程度<select aria-label="重要程度" value={priority} onChange={e => onChange({ priority: e.target.value as keyof typeof PRIORITY_LABEL })}>
      {Object.entries(PRIORITY_LABEL).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select></label>
    <DateField label="截止日期（可选）" value={dueDate ?? ''} onChange={v => onChange({ dueDate: v || null })} />
  </div>
}

function ParentFields({ data, categoryId, projectId, onChange, required }: {
  data: Dataset; categoryId: string | null; projectId: string | null; required?: boolean;
  onChange: (category: string | null, project: string | null) => void
}) {
  return <div className="form-pair">
    <label>分类<select aria-label="分类" value={categoryId ?? ''} required={required} onChange={e => onChange(e.target.value || null, null)}>
      <option value="">{required ? '请选择分类' : '收件箱（未分类）'}</option>
      {data.categories.filter(c => !c.archived || c.id === categoryId).map(c => <option value={c.id} key={c.id}>{c.name}{c.archived && '（已归档）'}</option>)}
    </select></label>
    <label>项目（可选）<select aria-label="项目（可选）" value={projectId ?? ''} disabled={!categoryId} onChange={e => onChange(categoryId, e.target.value || null)}>
      <option value="">无项目</option>
      {data.projects.filter(p => p.categoryId === categoryId && (!p.archived || p.id === projectId)).map(p => <option key={p.id} value={p.id}>{p.title}{p.archived && '（已归档）'}</option>)}
    </select></label>
  </div>
}

function SubjectField({ data, value, now, onChange, standalone, all, omit, locked }: {
  data: Dataset; value: Subject; now: string; onChange: (value: Subject, title: string) => void;
  standalone?: boolean; all?: boolean; omit?: Set<string | null>; locked?: boolean
}) {
  const selected = subjectKey(value)
  const entries = sortPool(poolEntries(data).filter(entry => {
    const key = subjectKey(entrySubject(entry))
    return key === selected || (!omit?.has(key) && (all || isPlannable(entry, data)))
  }), now)
  if (locked) return <p className="form-context">{selectedEntry(data, value)?.title ?? '独立记录'}</p>
  return <label>选择任务<select aria-label="选择任务" value={selected ?? (standalone ? 'standalone' : '')} required={!standalone} onChange={e => {
    const entry = entries.find(item => subjectKey(entrySubject(item)) === e.target.value)
    if (entry) onChange(entrySubject(entry), entry.title)
    else onChange({ taskId: null, todoId: null }, '')
  }}>
    <option value={standalone ? 'standalone' : ''}>{standalone ? '独立事项' : '请选择待办或长期任务'}</option>
    {entries.map(entry => <option key={subjectKey(entrySubject(entry))} value={subjectKey(entrySubject(entry)) ?? ''}>
      {entry.kind === 'task' ? '长期 · ' : '待办 · '}{entry.title}
    </option>)}
  </select></label>
}

function EditorFields({ editor, data, now, onChange }: {
  editor: Editor; data: Dataset; now: string; onChange: (command: EditableCommand) => void
}) {
  const command = editor.command
  if (command.type === 'saveCategory') {
    const v = command.value
    return <>
      <TextField label="分类名称" value={v.name} max={100} onChange={name => onChange({ ...command, value: { ...v, name } })} />
      <label className="color-label">分类颜色<input type="color" value={v.color} onChange={e => onChange({ ...command, value: { ...v, color: e.target.value } })} /></label>
      {editor.existing && <label className="check"><input type="checkbox" checked={v.archived} onChange={e => onChange({ ...command, value: { ...v, archived: e.target.checked } })} />归档分类</label>}
    </>
  }
  if (command.type === 'saveProject') {
    const v = command.value
    const hasChildren = [...data.tasks, ...data.todos].some(row => row.projectId === v.id)
    return <>
      <TextField label="项目名称" value={v.title} onChange={title => onChange({ ...command, value: { ...v, title } })} />
      <label>所属分类<select aria-label="所属分类" required value={v.categoryId} disabled={hasChildren} onChange={e => onChange({ ...command, value: { ...v, categoryId: e.target.value } })}>
        <option value="">请选择分类</option>
        {data.categories.filter(c => !c.archived || c.id === v.categoryId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      {editor.existing && <label className="check"><input type="checkbox" checked={v.archived} onChange={e => onChange({ ...command, value: { ...v, archived: e.target.checked } })} />归档项目</label>}
    </>
  }
  if (command.type === 'saveTask') {
    const v = command.value
    const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
    const unitLocked = data.workLogs.some(l => l.taskId === v.id)
      || data.weekItems.some(i => i.taskId === v.id && (i.targetUnits || i.baseline?.targetUnits))
      || data.schedules.some(s => s.taskId === v.id && s.plannedUnits)
    return <>
      <TextField label="任务名称" value={v.title} onChange={title => patch({ title })} />
      <ParentFields data={data} categoryId={v.categoryId} projectId={v.projectId} required onChange={(categoryId, projectId) => patch({ categoryId: categoryId ?? '', projectId })} />
      <PriorityFields priority={v.priority} dueDate={v.dueDate} onChange={patch} />
      <div className="form-pair">
        <label>进度单位<input value={v.unitName} maxLength={20} placeholder="页、节、题" required disabled={unitLocked} onChange={e => patch({ unitName: e.target.value })} /></label>
        <label>总量（可选）<input inputMode="decimal" value={v.totalUnits ?? ''} onChange={e => patch({ totalUnits: e.target.value || null })} /></label>
      </div>
      <div className="form-pair">
        <label>初始已完成量<input inputMode="decimal" value={v.initialCompletedUnits} required onChange={e => patch({ initialCompletedUnits: e.target.value })} /></label>
        <label>初始位置<input value={v.initialProgressLabel} maxLength={200} placeholder="例如第 2.1 节" onChange={e => patch({ initialProgressLabel: e.target.value })} /></label>
      </div>
      <NoteField value={v.note} onChange={note => patch({ note })} />
      {editor.existing && <label className="check"><input type="checkbox" checked={v.archived} onChange={e => patch({ archived: e.target.checked })} />归档任务</label>}
    </>
  }
  if (command.type === 'saveTodo') {
    const v = command.value
    const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
    return <>
      <TextField label="待办名称" value={v.title} onChange={title => patch({ title })} />
      <ParentFields data={data} categoryId={v.categoryId} projectId={v.projectId} onChange={(categoryId, projectId) => patch({ categoryId, projectId })} />
      <PriorityFields priority={v.priority} dueDate={v.dueDate} onChange={patch} />
      <MinutesField label="预计分钟数（可选）" value={v.estimatedMinutes} max={10080} onChange={estimatedMinutes => patch({ estimatedMinutes })} required={false} />
      <NoteField value={v.note} onChange={note => patch({ note })} />
      {editor.existing && <label className="check"><input type="checkbox" checked={v.archived} onChange={e => patch({ archived: e.target.checked })} />归档待办</label>}
    </>
  }
  if (command.type === 'saveWeekItem' || command.type === 'carryWeekItem') {
    const v = command.type === 'carryWeekItem' ? command.value.next : command.value
    const patch = (value: Partial<typeof v>) => {
      const next = { ...v, ...value }
      onChange(command.type === 'carryWeekItem' ? { ...command, value: { ...command.value, next } } : { ...command, value: next })
    }
    const entry = selectedEntry(data, v)
    const omit = new Set(data.weekItems.filter(item => item.weekStart === v.weekStart && item.id !== v.id).map(subjectKey))
    return <>
      <p className="muted">{dateLabel(v.weekStart)}起</p>
      <SubjectField now={now} data={data} value={v} omit={omit} locked={editor.lockedSubject || editor.existing || command.type === 'carryWeekItem'} onChange={subject => {
        const next = selectedEntry(data, subject)
        patch({ ...subject, minutes: next?.kind === 'todo' ? next.estimatedMinutes ?? 0 : 0, targetUnits: null })
      }} />
      <MinutesField label="本周计划分钟数" value={v.minutes || null} max={10080} onChange={minutes => patch({ minutes: minutes ?? 0 })} />
      {entry?.kind === 'task' && <label>本周新增目标（{entry.unitName}，可选）<input inputMode="decimal" value={v.targetUnits ?? ''} onChange={e => patch({ targetUnits: e.target.value || null })} /></label>}
      {entry && <p className="muted">{entry.kind === 'todo' ? '待办由你确认完成。' : v.targetUnits ? '本周按实际新增进度判断是否达成。' : '本周按实际投入分钟数判断是否达成。'}</p>}
      {command.type === 'carryWeekItem' && <p className="muted">本周的结果和日历记录会保留。请确认下周的投入和目标量。</p>}
    </>
  }
  if (command.type === 'saveSchedule') {
    const v = command.value
    const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
    const entry = selectedEntry(data, v)
    return <>
      <SubjectField now={now} data={data} value={v} standalone locked={editor.lockedSubject} onChange={(subject, title) => {
        const next = selectedEntry(data, subject)
        patch({ ...subject, title, plannedUnits: null,
          plannedMinutes: v.plannedMinutes || (next?.kind === 'todo' ? Math.min(next.estimatedMinutes ?? 0, 1440) : 0) })
      }} />
      {!entry && <TextField label="安排名称" value={v.title} onChange={title => patch({ title })} />}
      <div className="form-pair">
        <DateField label="安排日期" required value={v.date} onChange={date => patch({ date })} />
        <MinutesField label="计划分钟数" value={v.plannedMinutes || null} max={1440} onChange={plannedMinutes => patch({ plannedMinutes: plannedMinutes ?? 0 })} />
      </div>
      {entry?.kind === 'task' && <div className="form-pair">
        <label>计划新增量（{entry.unitName}，可选）<input inputMode="decimal" value={v.plannedUnits ?? ''} onChange={e => patch({ plannedUnits: e.target.value || null })} /></label>
        <label>计划范围（可选）<input value={v.plannedRangeText} maxLength={500} onChange={e => patch({ plannedRangeText: e.target.value })} /></label>
      </div>}
      {editor.existing && v.resolved && <label className="check"><input type="checkbox" checked={v.resolved} onChange={e => patch({ resolved: e.target.checked })} />这次安排已处理</label>}
      <NoteField value={v.note} onChange={note => patch({ note })} />
    </>
  }
  if (command.type === 'saveWorkLog') {
    const v = command.value
    const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
    const entry = selectedEntry(data, v), schedule = data.schedules.find(s => s.id === v.scheduleBlockId)
    return <>
      <SubjectField now={now} data={data} value={v} all standalone locked={!!v.scheduleBlockId}
        onChange={(subject, titleSnapshot) => patch({ ...subject, titleSnapshot, progressDelta: subject.taskId ? '0' : null, progressLabel: '' })} />
      {!entry && !schedule && <TextField label="学习事项" value={v.titleSnapshot} onChange={titleSnapshot => patch({ titleSnapshot })} />}
      {schedule && <div className="linked-info"><span>{dateLabel(schedule.date)}的安排 · 计划 {minutesLabel(schedule.plannedMinutes)}{!entry && ` · ${schedule.title}`}</span>
        <button type="button" className="button-text" onClick={() => patch({ scheduleBlockId: null })}>解除关联</button></div>}
      <div className="form-pair">
        <DateField label="实际发生日期" required value={v.date} max={v.date > now && editor.existing ? v.date : now} onChange={date => patch({ date })} />
        <MinutesField label="实际分钟数" value={v.actualMinutes || null} max={Math.max(1440, editor.existing ? v.actualMinutes : 0)}
          onChange={actualMinutes => patch({ actualMinutes: actualMinutes ?? 0 })} />
      </div>
      {entry?.kind === 'task' && <div className="form-pair">
        <label>本次新增量（{entry.unitName}）<input inputMode="decimal" required value={v.progressDelta ?? ''} onChange={e => patch({ progressDelta: e.target.value })} /></label>
        <label>学到的位置（可选）<input value={v.progressLabel} maxLength={200} onChange={e => patch({ progressLabel: e.target.value })} /></label>
      </div>}
      <NoteField value={v.note} onChange={note => patch({ note })} />
    </>
  }
  const v = command.value
  return <>
    <p className="muted">{command.type === 'saveWeekCapacity' ? '只调整所选周。每天填写可用分钟数，休息日填 0。' : '新规划的周默认沿用。已保存的周可单独调整。'}</p>
    <div className="capacity-fields">
      {WEEKDAYS.map((label, index) => <MinutesField key={label} label={`${label}可用（分钟）`} value={v.capacity[index]} min={0} max={1440}
        onChange={minutes => {
          const capacity = [...v.capacity] as typeof v.capacity
          capacity[index] = minutes ?? 0
          onChange(command.type === 'saveWeekCapacity' ? { ...command, value: { ...command.value, capacity } } : { ...command, value: { capacity } })
        }} />)}
    </div>
    <strong>一周共 {minutesLabel(sumMinutes(v.capacity, n => n))}</strong>
  </>
}

export function PlannerEditor({ editor, data, now, disabled, error, status, retry, onChange, onSubmit, onCancel, onRebase, onRemove }: {
  editor: Editor; data: Dataset & { revision: number }; now: string; disabled: boolean; error: string; status: string;
  retry?: ReactNode; onChange: (editor: Editor) => void; onSubmit: () => void; onCancel: () => void;
  onRebase: () => void; onRemove?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = dialog.current
    if (el && !el.open) el.showModal()
    return () => { el?.close() }
  }, [])
  const outOfDate = editor.base !== data.revision
  return <dialog ref={dialog} className="planner-dialog" aria-labelledby="planner-form-title" onCancel={e => { e.preventDefault(); onCancel() }}>
    <div className="drawer-heading">
      <h2 id="planner-form-title">{editor.title ?? titles[editor.command.type]}</h2>
      <button type="button" className="button-text" onClick={onCancel} disabled={disabled} aria-label="关闭表单">关闭</button>
    </div>
    <form onSubmit={e => { e.preventDefault(); onSubmit() }}>
      <fieldset disabled={disabled}>
        <EditorFields editor={editor} data={data} now={now} onChange={command => onChange({ ...editor, command })} />
      </fieldset>
      {error && <p className="notice notice-warning" role="alert">{error}</p>}
      {status && <p className="save-status" role="status">{status}</p>}
      {retry}
      {outOfDate && <div className="notice">
        <p>云端已有更新。请核对表单后再用当前版本保存。</p>
        <button type="button" disabled={disabled} onClick={onRebase}>以最新版本继续编辑</button>
      </div>}
      <div className="drawer-actions">
        <button className="button-primary" disabled={disabled || outOfDate}>保存</button>
        <button type="button" disabled={disabled} onClick={onCancel}>取消</button>
        {onRemove && <button type="button" className="button-danger" disabled={disabled || outOfDate} onClick={onRemove}>删除{editor.command.type === 'saveSchedule' ? '安排' : '记录'}</button>}
      </div>
    </form>
  </dialog>
}
