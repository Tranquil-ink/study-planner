import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dateLabel, isBusinessDate, minutesLabel, monthDay, shiftDate } from '../../domain/calendar'
import { PRIORITY_LABEL, type GoalRow, type PoolEntry } from '../../domain/planning'
import type { Dataset } from '../../domain/model'

export type PageToolbar = (controls?: ReactNode) => ReactNode

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
    <label className="date-picker" title={end ? `跳转日期 · ${dateLabel(date)} 至 ${dateLabel(end)}` : `跳转日期 · ${dateLabel(date)}`}>
      <span className="date-range" aria-hidden="true">{date.replaceAll('-', '/')}{end && ` – ${monthDay(end)}`}</span>
      <span className="date-picker-arrow" aria-hidden="true">⌄</span>
      <input type="date" aria-label="跳转日期" min="0001-01-01" max="9999-12-31" value={date} onChange={e => {
        if (isBusinessDate(e.target.value)) onChange(e.target.value)
      }} />
    </label>
  </div>
}

export function ActionMenu({ label, trigger = '⋯', children, className = '' }: {
  label: string; trigger?: ReactNode; children: ReactNode; className?: string
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const menu = details.current
    if (!open || !menu) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [open])
  return <details ref={details} className={`action-menu ${className}`}
    onToggle={event => setOpen(event.currentTarget.open)}
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && event.currentTarget.open) {
        event.preventDefault()
        event.currentTarget.open = false
        summary.current?.focus()
      }
    }}>
    <summary ref={summary} aria-label={label} title={label}>{trigger}</summary>
    <div className="menu-panel" onClick={event => {
      if (event.target instanceof Element && event.target.closest('button, a') && details.current) {
        details.current.open = false
        summary.current?.focus()
      }
    }}>{children}</div>
  </details>
}

export function Metric({ label, minutes, tone }: { label: string; minutes: number | null; tone?: 'accent' | 'warning' }) {
  return <div className={`metric ${tone ? `metric-${tone}` : ''}`}><span>{label}</span><strong>{minutes === null ? '未设置' : minutesLabel(minutes)}</strong></div>
}

export function EntryTag({ entry, data, now, compact = false }: {
  entry?: PoolEntry; data: Dataset; now: string; compact?: boolean
}) {
  if (!entry) return null
  const category = data.categories.find(c => c.id === entry.categoryId)
  const project = data.projects.find(p => p.id === entry.projectId)
  return <div className="tags">
    {category && <span className="tag"><span className="color-dot" style={{ background: category.color }} />{category.name}{!compact && project && ` / ${project.title}`}</span>}
    {entry.kind === 'recurring' && <span className="tag">周期任务</span>}
    {entry.priority !== 'normal' && <span className="tag tag-accent">{PRIORITY_LABEL[entry.priority]}</span>}
    {entry.dueDate && <span className={`tag ${entry.dueDate < now && (entry.kind === 'task' || !entry.completedOn) ? 'tag-warning' : ''}`}>{monthDay(entry.dueDate)}截止</span>}
  </div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function AddButton({ children, disabled, onClick, label }: {
  children?: ReactNode; disabled: boolean; onClick: () => void; label?: string
}) {
  return <button className={children ? 'add-button' : 'icon-button add-button'} type="button" disabled={disabled}
    onClick={onClick} aria-label={label} title={label}>
    <span className="add-plus" aria-hidden="true">+</span>{children}
  </button>
}

export function ProgressBar({ label, detail, ratio, tone }: {
  label: string; detail?: string; ratio: number | null; tone?: 'warning'
}) {
  return <div className={`progress-stat ${tone ? `progress-${tone}` : ''}`}>
    <div className="progress-caption"><span>{label}</span><strong>{detail ?? (ratio === null ? '未设置' : `${Math.round(ratio * 100)}%`)}</strong></div>
    <progress aria-label={label} aria-valuetext={detail}
      max={1} value={ratio === null ? 0 : Math.min(1, ratio)} />
  </div>
}

export function GoalProgress({ row }: { row: GoalRow }) {
  if (row.progress) {
    const { current, target, unit, ratio } = row.progress
    const position = unit === '页' ? `p${current} / p${target}` : `${current} / ${target} ${unit}`
    return <ProgressBar label="周进度" detail={`${position} · ${Math.round(ratio * 100)}%`} ratio={ratio} />
  }
  if (row.entry?.kind === 'todo' || row.entry?.kind === 'recurring') {
    const label = row.entry.kind === 'recurring' ? '未完成' : '尚未完成'
    return <p className={row.current.reached ? 'goal-done' : 'muted'}>{row.current.reached ? '已完成' : label}</p>
  }
  return <p className="muted">未设进度目标</p>
}
