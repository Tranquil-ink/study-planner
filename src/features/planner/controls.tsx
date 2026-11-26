import type { ReactNode } from 'react'
import { dateLabel, isBusinessDate, minutesLabel, monthDay, shiftDate } from '../../domain/calendar'
import { PRIORITY_LABEL, type GoalRow, type PoolEntry } from '../../domain/planning'
import type { Dataset } from '../../domain/model'

export function DateToolbar({ date, end, now, step, onChange }: {
  date: string; end?: string; now: string; step: number; onChange: (date: string) => void
}) {
  const previous = shiftDate(date, -step), next = shiftDate(date, step), unit = step === 7 ? '周' : '天'
  return <div className="date-toolbar">
    <div className="date-controls">
      <button type="button" aria-label={`上一${unit}`} disabled={!previous} onClick={() => previous && onChange(previous)}>‹</button>
      <button type="button" onClick={() => onChange(now)}>{step === 7 ? '本周' : '今天'}</button>
      <button type="button" aria-label={`下一${unit}`} disabled={!next} onClick={() => next && onChange(next)}>›</button>
    </div>
    <strong className="date-range">{end ? `${date} — ${monthDay(end)}` : dateLabel(date)}</strong>
    <input type="date" aria-label="跳转日期" min="0001-01-01" max="9999-12-31" value={date} onChange={e => {
      if (isBusinessDate(e.target.value)) onChange(e.target.value)
    }} />
  </div>
}

export function Metric({ label, minutes, tone }: { label: string; minutes: number | null; tone?: 'accent' | 'warning' }) {
  return <div className={`metric ${tone ? `metric-${tone}` : ''}`}><span>{label}</span><strong>{minutes === null ? '未设置' : minutesLabel(minutes)}</strong></div>
}

export function EntryTag({ entry, data, now }: { entry?: PoolEntry; data: Dataset; now: string }) {
  if (!entry) return null
  const category = data.categories.find(c => c.id === entry.categoryId)
  const project = data.projects.find(p => p.id === entry.projectId)
  return <div className="tags">
    {category && <span className="tag"><span className="color-dot" style={{ background: category.color }} />{category.name}{project && ` / ${project.title}`}</span>}
    {entry.priority !== 'normal' && <span className="tag tag-accent">{PRIORITY_LABEL[entry.priority]}</span>}
    {entry.dueDate && <span className={`tag ${entry.dueDate < now && (entry.kind === 'task' || !entry.completedOn) ? 'tag-warning' : ''}`}>{monthDay(entry.dueDate)}截止</span>}
  </div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function AddButton({ children, disabled, onClick, label }: {
  children: ReactNode; disabled: boolean; onClick: () => void; label?: string
}) {
  return <button className="add-box" type="button" disabled={disabled} onClick={onClick} aria-label={label}>
    <span className="add-plus" aria-hidden="true">+</span>{children}
  </button>
}

export function ProgressBar({ label, detail, ratio, tone }: {
  label: string; detail?: string; ratio: number | null; tone?: 'warm' | 'warning'
}) {
  return <div className={`progress-stat ${tone ? `progress-${tone}` : ''}`}>
    <div className="progress-caption"><span>{label}</span><strong>{detail ?? (ratio === null ? '未设置' : `${Math.round(ratio * 100)}%`)}</strong></div>
    <progress aria-label={label} aria-valuetext={detail}
      max={1} value={ratio === null ? 0 : Math.min(1, ratio)} />
  </div>
}

export function GoalProgress({ row, through }: { row: GoalRow; through: string }) {
  if (row.progress) {
    const { current, target, unit, ratio } = row.progress
    const position = unit === '页' ? `p${current} / p${target}` : `${current} / ${target} ${unit}`
    return <ProgressBar label="周进度" detail={`${position} · ${Math.round(ratio * 100)}%`} ratio={ratio} />
  }
  if (row.entry?.kind === 'todo') {
    const done = row.entry.completedOn && row.entry.completedOn <= through
    return <p className={done ? 'goal-done' : 'muted'}>{done ? '已完成' : '尚未完成'}</p>
  }
  return <p className="muted">未设进度目标</p>
}
