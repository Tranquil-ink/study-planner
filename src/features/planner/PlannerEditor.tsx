import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dateLabel, hoursInput, hoursLabel, minutesLabel, parseHours, sumMinutes, WEEKDAYS } from '../../domain/calendar'
import { PERIODS, quantitySchema, quantityTicks, subjectKey, type Capacity, type Command, type Dataset, type ScheduleInput,
  type SchedulePeriod, type Subject } from '../../domain/model'
import { entrySubject, isPlannable, PERIOD_LABEL, poolEntries, PRIORITY_LABEL, progressBeforeWeek, selectedEntry, sortPool,
  weekCandidates } from '../../domain/planning'
import { taskProgress, ticksQuantity } from '../../domain/work-logs'
import { newTask, newTodo } from './actions'

type EditableCommand = Extract<Command, { type: 'saveCategory' | 'saveProject' | 'saveTask' | 'saveTodo'
  | 'saveSchedule' | 'createScheduledEntry' | 'moveSchedule' | 'completeSchedule' | 'saveWorkLog'
  | 'saveWeekItem' | 'saveWeekCapacity' | 'saveCapacityTemplate' }>
type EntryCommand = Extract<EditableCommand, { type: 'saveTask' | 'saveTodo' }>
type ScheduleCommand = Extract<EditableCommand, { type: 'saveSchedule' | 'createScheduledEntry' }>
type CapacityCommand = Extract<EditableCommand, { type: 'saveWeekCapacity' | 'saveCapacityTemplate' }>
export interface Editor {
  command: EditableCommand
  base: number
  existing?: boolean
  dirty?: boolean
  lockedSubject?: boolean
  title?: string
}

const titles: Record<EditableCommand['type'], string> = {
  saveCategory: '分类', saveProject: '项目', saveTask: '长期任务', saveTodo: '一次性待办',
  saveSchedule: '日程安排', createScheduledEntry: '新增安排', moveSchedule: '移动安排', completeSchedule: '记录完成情况',
  saveWorkLog: '实际学习记录', saveWeekItem: '本周目标', saveWeekCapacity: '本周可用时间', saveCapacityTemplate: '默认配置',
}

function MinutesField({ label, value, max, onChange, required = true, min = 1 }: {
  label: string; value: number | null; max: number; onChange: (v: number | null) => void; required?: boolean; min?: number
}) {
  return <label>{label}<input type="number" inputMode="numeric" min={min} max={max} step={1} required={required}
    value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></label>
}

function HoursField({ label, value, min = 1, max, onChange, compact }: {
  label: string; value: number; min?: number; max: number; onChange: (minutes: number) => void; compact?: boolean
}) {
  return <label><span className={compact ? 'sr-only' : undefined}>{label}</span>
    <input inputMode="decimal" required defaultValue={value > 0 || min === 0 ? hoursInput(value) : ''}
      placeholder={compact ? undefined : '2.5'} onChange={e => {
        const field = e.currentTarget
        const minutes = parseHours(field.value)
        const valid = minutes !== null && minutes >= min && minutes <= max
        field.setCustomValidity(valid || !field.value ? '' : `请填写有效时长，例如 2.5 或 2:30，范围 ${hoursLabel(min)} – ${hoursLabel(max)}。`)
        onChange(valid ? minutes : 0)
      }} />
  </label>
}

function TextField({ label, value, onChange, max = 200, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; max?: number; placeholder?: string
}) {
  return <label>{label}<input value={value} required maxLength={max} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>
}

function NoteField({ value, onChange, label = '备注（可选）' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return <label>{label}<textarea rows={3} value={value} maxLength={5000} onChange={e => onChange(e.target.value)} /></label>
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

function PeriodField({ value, onChange }: { value: SchedulePeriod; onChange: (p: SchedulePeriod) => void }) {
  return <label>时段<select aria-label="时段" value={value} onChange={e => onChange(e.target.value as SchedulePeriod)}>
    {PERIODS.map(period => <option key={period} value={period}>{PERIOD_LABEL[period]}</option>)}
  </select></label>
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

function EntryFields({ command, data, existing, embedded, onChange }: {
  command: EntryCommand; data: Dataset; existing?: boolean; embedded?: boolean; onChange: (c: EntryCommand) => void
}) {
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
      <NoteField label={embedded ? '任务备注（可选）' : undefined} value={v.note} onChange={note => patch({ note })} />
      {existing && <label className="check"><input type="checkbox" checked={v.archived} onChange={e => patch({ archived: e.target.checked })} />归档任务</label>}
    </>
  }
  const v = command.value
  const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
  return <>
    <TextField label="待办名称" value={v.title} onChange={title => patch({ title })} />
    <ParentFields data={data} categoryId={v.categoryId} projectId={v.projectId} onChange={(categoryId, projectId) => patch({ categoryId, projectId })} />
    <PriorityFields priority={v.priority} dueDate={v.dueDate} onChange={patch} />
    <MinutesField label="预计分钟数（可选）" value={v.estimatedMinutes} max={10080} onChange={estimatedMinutes => patch({ estimatedMinutes })} required={false} />
    <NoteField label={embedded ? '任务备注（可选）' : undefined} value={v.note} onChange={note => patch({ note })} />
    {existing && <label className="check"><input type="checkbox" checked={v.archived} onChange={e => patch({ archived: e.target.checked })} />归档待办</label>}
  </>
}

function ScheduleFields({ command, data, now, existing, onChange }: {
  command: ScheduleCommand; data: Dataset; now: string; existing?: boolean; onChange: (c: ScheduleCommand) => void
}) {
  const v = command.type === 'saveSchedule' ? command.value : command.value.schedule
  const draft = command.type === 'createScheduledEntry' ? command.value.entry : null
  const [kind, setKind] = useState<'task' | 'todo' | 'standalone'>(v.taskId ? 'task' : v.todoId ? 'todo' : 'standalone')
  const key = subjectKey(v)
  const entries = sortPool(poolEntries(data).filter(e => e.kind === kind &&
    (subjectKey(entrySubject(e)) === key || isPlannable(e, data))), now)
  const category = data.categories.find(row => !row.archived)
  const patch = (p: Partial<ScheduleInput>) => {
    const schedule = { ...v, ...p }
    if (draft) onChange({ type: 'createScheduledEntry', value: { entry: draft, schedule } })
    else onChange({ type: 'saveSchedule', value: schedule })
  }
  function changeKind(next: typeof kind) {
    setKind(next)
    onChange({ type: 'saveSchedule', value: { ...v, taskId: null, todoId: null, title: '', plannedUnits: null } })
  }
  function chooseSubject(value: string) {
    if (value === 'new') {
      const entry: EntryCommand = kind === 'task' ? { type: 'saveTask', value: newTask(category?.id ?? '') }
        : { type: 'saveTodo', value: newTodo() }
      const schedule = { ...v, taskId: entry.type === 'saveTask' ? entry.value.id : null,
        todoId: entry.type === 'saveTodo' ? entry.value.id : null, title: '', plannedUnits: null }
      onChange({ type: 'createScheduledEntry', value: { entry, schedule } })
      return
    }
    const entry = entries.find(e => subjectKey(entrySubject(e)) === value)
    const subject = entry ? entrySubject(entry) : { taskId: null, todoId: null }
    const estimate = entry?.kind === 'todo' ? Math.min(entry.estimatedMinutes ?? 0, 1440) : 0
    onChange({ type: 'saveSchedule', value: { ...v, ...subject, title: entry?.title ?? '', plannedUnits: null,
      plannedMinutes: v.plannedMinutes || estimate } })
  }
  const unit = draft?.type === 'saveTask' ? draft.value.unitName : data.tasks.find(t => t.id === v.taskId)?.unitName
  const choiceLabel = kind === 'task' ? '选择长期任务' : '选择临时待办'
  return <>
    <label>任务类型<select aria-label="任务类型" value={kind} onChange={e => changeKind(e.target.value as typeof kind)}>
      <option value="standalone">独立任务</option><option value="task">长期任务</option><option value="todo">临时待办</option>
    </select></label>
    {kind === 'standalone' ? <TextField label="安排名称" value={v.title} onChange={title => patch({ title })} /> : <>
      <label>{choiceLabel}<select aria-label={choiceLabel} value={draft ? 'new' : key ?? ''} required onChange={e => chooseSubject(e.target.value)}>
        <option value="">请选择</option>
        {!existing && (kind === 'todo' || category) && <option value="new">{kind === 'task' ? '＋ 新增长期任务' : '＋ 新增临时待办'}</option>}
        {entries.map(e => <option key={e.id} value={subjectKey(entrySubject(e)) ?? ''}>{e.title}</option>)}
      </select></label>
      {kind === 'task' && !category && !entries.length && <p className="muted">在任务池创建分类后可新增长期任务。</p>}
    </>}
    {draft && <div className="schedule-entry-fields">
      <EntryFields key={draft.value.id} command={draft} data={data} embedded onChange={entry => onChange({
        type: 'createScheduledEntry', value: { entry, schedule: { ...v, title: entry.value.title } },
      })} />
    </div>}
    <div className="form-pair">
      <DateField label="安排日期" required value={v.date} onChange={date => patch({ date })} />
      <PeriodField value={v.period} onChange={period => patch({ period })} />
    </div>
    <HoursField key={key ?? 'standalone'} label="计划时长（h）" value={v.plannedMinutes} max={1440} onChange={plannedMinutes => patch({ plannedMinutes })} />
    <div className={unit ? 'form-pair' : undefined}>
      {unit && <label>目标新增（{unit}，可选）<input inputMode="decimal" value={v.plannedUnits ?? ''} onChange={e => patch({ plannedUnits: e.target.value || null })} /></label>}
      <label>目标位置（可选）<input value={v.plannedRangeText} maxLength={500} placeholder="例如第 3 章" onChange={e => patch({ plannedRangeText: e.target.value })} /></label>
    </div>
    <NoteField label="安排备注（可选）" value={v.note} onChange={note => patch({ note })} />
  </>
}

function CapacityFields({ command, template, onChange }: {
  command: CapacityCommand; template: Capacity | null; onChange: (c: CapacityCommand) => void
}) {
  const { capacity } = command.value
  const [loadedDefaults, setLoadedDefaults] = useState(0)
  const setCapacity = (next: Capacity) => {
    if (command.type === 'saveWeekCapacity') onChange({ ...command, value: { ...command.value, capacity: next } })
    else onChange({ ...command, value: { capacity: next } })
  }
  return <>
    {command.type === 'saveWeekCapacity' && template && <div>
      <button type="button" className="button-text" onClick={() => {
        setCapacity(template)
        setLoadedDefaults(times => times + 1)
      }}>载入默认值</button>
    </div>}
    <div className="capacity-matrix" key={loadedDefaults}>
      <div className="capacity-row capacity-heading"><span>小时</span>
        {PERIODS.map(period => <strong key={period}>{PERIOD_LABEL[period]}</strong>)}
      </div>
      {WEEKDAYS.map((label, day) => <div className="capacity-row" key={label}>
        <strong>{label}</strong>
        {PERIODS.map((period, index) => <HoursField key={period} label={`${label}${PERIOD_LABEL[period]}（h）`}
          value={capacity[day][index]} min={0} max={1440} compact onChange={minutes => {
            const next = structuredClone(capacity)
            next[day][index] = minutes
            setCapacity(next)
          }} />)}
      </div>)}
    </div>
    <strong>一周共 {hoursLabel(sumMinutes(capacity, day => sumMinutes(day, n => n)))}</strong>
  </>
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
  if (command.type === 'saveTask' || command.type === 'saveTodo') {
    return <EntryFields command={command} data={data} existing={editor.existing} onChange={onChange} />
  }
  if (command.type === 'saveWeekItem') {
    const v = command.value
    const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
    const entry = selectedEntry(data, v)
    const items = data.weekItems.filter(item => item.weekStart === v.weekStart)
    const visibleSubjects = [
      ...items.filter(item => item.id !== v.id && (item.status === 'active' || item.status === 'carried')).map(subjectKey),
      ...weekCandidates(data, v.weekStart, now).map(candidate => subjectKey(entrySubject(candidate))),
    ]
    const target = quantitySchema.safeParse(v.targetUnits)
    const starting = entry?.kind === 'task' ? progressBeforeWeek(entry, data.workLogs, v.weekStart) : null
    return <>
      <p className="muted">{dateLabel(v.weekStart)}起</p>
      <SubjectField now={now} data={data} value={v} omit={new Set(visibleSubjects)} locked={editor.lockedSubject || editor.existing}
        onChange={(subject) => {
          const next = selectedEntry(data, subject)
          const previous = items.find(item => subjectKey(item) === subjectKey(subject))
          patch({ ...subject, id: previous?.id ?? crypto.randomUUID(),
            minutes: previous?.minutes ?? (next?.kind === 'todo' ? next.estimatedMinutes ?? 0 : 0),
            targetUnits: previous?.targetUnits ?? null })
        }} />
      <HoursField key={v.id} label="本周计划时长（h）" value={v.minutes} max={10080} onChange={minutes => patch({ minutes })} />
      {entry?.kind === 'task' && <>
        <label>本周目标新增（{entry.unitName}，可选）<input inputMode="decimal" value={v.targetUnits ?? ''} onChange={e => patch({ targetUnits: e.target.value || null })} /></label>
        {starting !== null && <p className="muted">周初 {ticksQuantity(starting)} {entry.unitName}
          {target.success && ` → 目标 ${ticksQuantity(starting + quantityTicks(target.data))} ${entry.unitName}`}</p>}
      </>}
    </>
  }
  if (command.type === 'saveSchedule' || command.type === 'createScheduledEntry') {
    return <ScheduleFields command={command} data={data} now={now} existing={editor.existing} onChange={onChange} />
  }
  if (command.type === 'moveSchedule') {
    const v = command.value
    const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
    const row = data.schedules.find(s => s.id === v.id)
    return <>
      {row && <p className="form-context">{selectedEntry(data, row)?.title ?? row.title}</p>}
      <div className="form-pair">
        <DateField label="移动到日期" required value={v.date} onChange={date => patch({ date, beforeId: null })} />
        <PeriodField value={v.period} onChange={period => patch({ period, beforeId: null })} />
      </div>
      <label>放在<select aria-label="放在" value={v.beforeId ?? ''} onChange={e => patch({ beforeId: e.target.value || null })}>
        <option value="">时段末尾</option>
        {data.schedules.filter(s => s.id !== v.id && s.date === v.date && s.period === v.period)
          .sort((a, b) => a.position - b.position)
          .map(s => <option key={s.id} value={s.id}>{selectedEntry(data, s)?.title ?? s.title}之前</option>)}
      </select></label>
    </>
  }
  if (command.type === 'completeSchedule') {
    const v = command.value
    const patch = (value: Partial<typeof v>) => onChange({ ...command, value: { ...v, ...value } })
    const schedule = data.schedules.find(s => s.id === v.id)
    if (!schedule) return <p role="alert">这项安排已从日程移除。</p>
    const entry = selectedEntry(data, schedule)
    const progress = entry?.kind === 'task' ? taskProgress(entry, data.workLogs, v.date) : null
    const previous = data.workLogs.find(l => l.id === v.logId)
    return <>
      <div className="form-context completion-context">
        <strong>{entry?.title ?? schedule.title}</strong>
        <span>计划 {hoursLabel(schedule.plannedMinutes)}</span>
      </div>
      <div className="form-pair">
        <HoursField label="实际时长（h）" value={v.actualMinutes} max={Math.max(previous?.actualMinutes ?? 0, 1440)}
          onChange={actualMinutes => patch({ actualMinutes })} />
        <DateField label="实际学习日期" required value={v.date} max={now} onChange={date => patch({ date })} />
      </div>
      {entry?.kind === 'task' && progress && <>
        <label>完成到（{entry.unitName}）<input inputMode="decimal" value={v.reachedUnits ?? ''}
          placeholder={progress.completedUnits} onChange={e => patch({ reachedUnits: e.target.value || null })} /></label>
        <p className="muted">当天已记进度 {progress.completedUnits} {entry.unitName}。填写累计到达值，例如 275。</p>
        <label>章或节的位置（可选）<input value={v.progressLabel} maxLength={200} placeholder="例如第 3.2 节"
          onChange={e => patch({ progressLabel: e.target.value })} /></label>
      </>}
      {previous && <p className="muted">保存时会更新这项安排最近一条实际记录。</p>}
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
  return <CapacityFields command={command} template={data.settings.capacityTemplate} onChange={onChange} />
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
  return <dialog ref={dialog} className={`planner-dialog ${editor.command.type === 'completeSchedule' || editor.command.type === 'moveSchedule' ? 'planner-modal' : ''}`} aria-labelledby="planner-form-title" onCancel={e => { e.preventDefault(); onCancel() }}>
    <div className="drawer-heading">
      <h2 id="planner-form-title">{editor.title ?? titles[editor.command.type]}</h2>
      <button type="button" className="button-text" onClick={onCancel} disabled={disabled} aria-label="关闭表单">关闭</button>
    </div>
    <form onSubmit={e => { e.preventDefault(); onSubmit() }}>
      <fieldset disabled={disabled}>
        <EditorFields editor={editor} data={data} now={now} onChange={command => onChange({ ...editor, command, dirty: true })} />
      </fieldset>
      {error && <p className="notice notice-warning" role="alert">{error}</p>}
      {status && <p className="save-status" role="status">{status}</p>}
      {retry}
      {outOfDate && <div className="notice">
        <p>云端已有更新。请核对表单后再用当前版本保存。</p>
        <button type="button" disabled={disabled} onClick={onRebase}>以最新版本继续编辑</button>
      </div>}
      <div className="drawer-actions">
        <button className="button-primary" disabled={disabled || outOfDate}>
          {editor.command.type === 'completeSchedule' ? '保存并完成' : editor.command.type === 'moveSchedule' ? '移动' : '保存'}
        </button>
        <button type="button" disabled={disabled} onClick={onCancel}>取消</button>
        {onRemove && <button type="button" className="button-danger" disabled={disabled || outOfDate} onClick={onRemove}>删除{editor.command.type === 'saveSchedule' ? '安排' : '记录'}</button>}
      </div>
    </form>
  </dialog>
}
