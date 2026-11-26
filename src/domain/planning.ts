import { shiftDate, sumMinutes, weekDates, weekStart, weekdayIndex } from './calendar'
import {
  PERIODS, quantityTicks, subjectKey, type Capacity, type Dataset, type LearningTask,
  type Subject, type Todo, type WeekItem, type WorkLog,
} from './model'
import { sumProgress, taskProgress, ticksQuantity } from './work-logs'

export const PRIORITY_LABEL = { normal: '普通', important: '重要', urgent: '紧急' }
export const WEEK_STATUS = { active: '本周计划', returned: '已退回待办', cancelled: '已取消', carried: '已结转下周' }
export const PERIOD_LABEL = { morning: '上午', afternoon: '下午', evening: '晚上' }

export type PoolEntry = (LearningTask & { kind: 'task' }) | (Todo & { kind: 'todo' })

export function poolEntries(data: Dataset): PoolEntry[] {
  return [...data.tasks.map(t => ({ ...t, kind: 'task' as const })), ...data.todos.map(t => ({ ...t, kind: 'todo' as const }))]
}

export function entrySubject(entry: PoolEntry): Subject {
  return { taskId: entry.kind === 'task' ? entry.id : null, todoId: entry.kind === 'todo' ? entry.id : null }
}

export function isOpen(entry: PoolEntry): boolean {
  return !entry.archived && (entry.kind === 'task' || !entry.completedOn)
}

export function isPlannable(entry: PoolEntry, data: Dataset): boolean {
  if (!isOpen(entry) || data.categories.find(c => c.id === entry.categoryId)?.archived ||
    data.projects.find(p => p.id === entry.projectId)?.archived) return false
  return entry.kind !== 'task' || entry.totalUnits === null ||
    taskProgress(entry, data.workLogs).completedTicks < quantityTicks(entry.totalUnits)
}

export function selectedEntry(data: Dataset, row: Subject): PoolEntry | undefined {
  const task = row.taskId && data.tasks.find(t => t.id === row.taskId)
  if (task) return { ...task, kind: 'task' }
  const todo = row.todoId && data.todos.find(t => t.id === row.todoId)
  if (todo) return { ...todo, kind: 'todo' }
}

export function sortPool(entries: PoolEntry[], now: string, dueThrough = now) {
  const priorities = { normal: 0, important: 1, urgent: 2 }
  const order = (e: PoolEntry) => e.dueDate && e.dueDate < now ? 0 : e.dueDate && e.dueDate <= dueThrough ? 1 : 2
  return [...entries].sort((a, b) => order(a) - order(b)
    || priorities[b.priority] - priorities[a.priority]
    || (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
    || a.title.localeCompare(b.title, 'zh-CN'))
}

export function dueWithinTwoWeeks(entry: PoolEntry, week: string) {
  const cutoff = shiftDate(week, 14)
  return entry.kind === 'todo' && entry.dueDate !== null && (cutoff === null || entry.dueDate < cutoff)
}

export function weekCandidates(data: Dataset, week: string, now: string) {
  if (week < weekStart(now)) return []
  const planned = new Set(data.weekItems.filter(item => item.weekStart === week &&
    (item.status === 'active' || item.status === 'carried')).map(subjectKey))
  return sortPool(poolEntries(data).filter(entry => isPlannable(entry, data) &&
    !planned.has(subjectKey(entrySubject(entry))) &&
    (entry.activated || dueWithinTwoWeeks(entry, week))), now, shiftDate(week, 13) ?? '9999-12-31')
}

export function capacityFor(data: Dataset, week: string, now: string) {
  return data.weeks.find(w => w.weekStart === week)?.capacity ??
    (week >= weekStart(now) ? data.settings.capacityTemplate : null)
}

export function emptyCapacity(): Capacity {
  return [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
}

export function daySummary(data: Dataset, day: string, now: string) {
  const schedules = data.schedules.filter(s => s.date === day)
    .sort((a, b) => PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period) || a.position - b.position)
  const logs = data.workLogs.filter(l => l.date === day && l.date <= now)
  const periodCapacity = capacityFor(data, weekStart(day), now)?.[weekdayIndex(day)] ?? null
  return {
    date: day, schedules, logs, periodCapacity,
    capacity: periodCapacity === null ? null : sumMinutes(periodCapacity, n => n),
    scheduledMinutes: sumMinutes(schedules, s => s.plannedMinutes),
    completedCount: schedules.filter(s => s.outcome === 'completed').length,
  }
}

export function progressBeforeWeek(task: LearningTask, logs: WorkLog[], week: string) {
  return quantityTicks(task.initialCompletedUnits) + sumProgress(logs.filter(log => log.taskId === task.id && log.date < week))
}

function compareGoal(goal: Pick<WeekItem, 'minutes' | 'targetUnits'>, entry: PoolEntry | undefined, through: string,
  actualMinutes: number, actualUnits: bigint) {
  if (entry?.kind === 'todo') {
    const completed = Boolean(entry.completedOn && entry.completedOn <= through)
    return { reached: completed, percent: completed ? 100 : 0 }
  }
  if (goal.targetUnits !== null) {
    const target = quantityTicks(goal.targetUnits)
    return { reached: actualUnits >= target, percent: Math.round(Number(actualUnits) * 100 / Number(target)) }
  }
  return { reached: actualMinutes >= goal.minutes, percent: Math.round(actualMinutes * 100 / goal.minutes) }
}

export function weekSummary(data: Dataset, date: string, now: string) {
  const week = weekStart(date), days = weekDates(week), end = days.at(-1) ?? week
  const through = now < end ? now : end
  const schedules = data.schedules.filter(s => s.date >= week && s.date <= end)
  const logs = data.workLogs.filter(l => l.date >= week && l.date <= through)
  const cap = capacityFor(data, week, now)
  const rows = data.weekItems.filter(i => i.weekStart === week)
  const active = new Set(rows.filter(i => i.status === 'active').map(subjectKey))
  const plannedActualMinutes = sumMinutes(logs.filter(l => active.has(subjectKey(l))), l => l.actualMinutes)
  const actualMinutes = sumMinutes(logs, l => l.actualMinutes)
  const saved = data.weeks.find(w => w.weekStart === week)
  const items = rows.map(item => {
    const key = subjectKey(item), entry = selectedEntry(data, item)
    const itemLogs = logs.filter(l => subjectKey(l) === key)
    const minutes = sumMinutes(itemLogs, l => l.actualMinutes), units = sumProgress(itemLogs)
    const current = compareGoal(item, entry, through, minutes, units)
    const original = item.baseline && compareGoal(item.baseline, entry, through, minutes, units)
    const plannedMinutes = sumMinutes(schedules.filter(s => subjectKey(s) === key), s => s.plannedMinutes)
    const budget = item.minutes - plannedMinutes
    let progress = null
    if (entry?.kind === 'task' && item.targetUnits !== null) {
      const starting = progressBeforeWeek(entry, data.workLogs, week)
      const target = quantityTicks(item.targetUnits)
      progress = { current: ticksQuantity(starting + units), target: ticksQuantity(starting + target), unit: entry.unitName,
        ratio: Number(units) / Number(target) }
    }
    return { item, entry, actualMinutes: minutes, actualUnits: ticksQuantity(units),
      plannedMinutes, budget, progress, current, original }
  })
  const original = items.filter(r => r.original)
  const current = items.filter(r => r.item.status === 'active')
  return {
    week, end, through, committedAt: saved?.committedAt ?? null, days: days.map(d => daySummary(data, d, now)), items,
    capacity: cap === null ? null : sumMinutes(cap, day => sumMinutes(day, n => n)),
    plannedMinutes: sumMinutes(current, r => r.item.minutes), scheduledMinutes: sumMinutes(schedules, s => s.plannedMinutes),
    actualMinutes, unplannedActualMinutes: actualMinutes - plannedActualMinutes,
    initialPlannedMinutes: original.length ? sumMinutes(original, r => r.item.baseline!.minutes) : null,
    initialReached: original.filter(r => r.original?.reached).length, initialCount: original.length,
    currentReached: current.filter(r => r.current.reached).length, currentCount: current.length,
    added: items.filter(r => !r.item.baseline && r.item.status === 'active').length,
  }
}
export type GoalRow = ReturnType<typeof weekSummary>['items'][number]

export function recentWeeks(data: Dataset, through: string, count: number, now: string) {
  const first = weekStart(through)
  return Array.from({ length: count }, (_, i) => shiftDate(first, (i - count + 1) * 7))
    .flatMap(d => d ? [weekSummary(data, d, now)] : [])
}

export function studyBreakdown(data: Dataset, from: string, through: string) {
  const byCategory = new Map<string, { id: string; name: string; color: string; minutes: number }>()
  for (const log of data.workLogs) {
    if (log.date < from || log.date > through) continue
    const entry = selectedEntry(data, log)
    const category = data.categories.find(c => c.id === entry?.categoryId)
    const id = category?.id ?? 'uncategorized'
    const current = byCategory.get(id)
    if (current) current.minutes += log.actualMinutes
    else byCategory.set(id, { id, name: category?.name ?? '未分类', color: category?.color ?? '#718096', minutes: log.actualMinutes })
  }
  return [...byCategory.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'zh-CN'))
}

export function averageGoalRates(weeks: ReturnType<typeof recentWeeks>) {
  const totals = new Map<string, { task: LearningTask; count: number; summedRatio: number }>()
  for (const { items, week, through } of weeks) {
    if (through < week) continue
    for (const { entry, item, progress } of items) {
      if (entry?.kind !== 'task' || !progress || (item.status !== 'active' && item.status !== 'carried')) continue
      const total = totals.get(entry.id)
      if (total) {
        total.count += 1
        total.summedRatio += progress.ratio
      } else {
        totals.set(entry.id, { task: entry, count: 1, summedRatio: progress.ratio })
      }
    }
  }
  return [...totals.values()].map(({ task, count, summedRatio }) => ({ task, count, ratio: summedRatio / count }))
    .sort((a, b) => b.ratio - a.ratio || a.task.title.localeCompare(b.task.title, 'zh-CN'))
}
