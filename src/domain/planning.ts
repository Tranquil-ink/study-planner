import { shiftDate, sumMinutes, weekDates, weekStart, weekdayIndex } from './calendar'
import { quantityTicks, subjectKey, type Dataset, type LearningTask, type ScheduleBlock, type Subject, type Todo, type WeekItem, type WorkLog } from './model'
import { taskProgress, ticksQuantity } from './work-logs'

export const PRIORITY_LABEL = { normal: '普通', important: '重要', urgent: '紧急' }
export const WEEK_STATUS = { active: '本周计划', returned: '已退回待办', cancelled: '已取消', carried: '已结转下周' }

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
    quantityTicks(taskProgress(entry, data.workLogs).completedUnits) < quantityTicks(entry.totalUnits)
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

export function capacityFor(data: Dataset, week: string, now: string) {
  const saved = data.weeks.find(w => w.weekStart === week)
  if (saved) return saved.capacity
  return week >= weekStart(now) ? data.settings.capacityTemplate : null
}

export function daySummary(data: Dataset, day: string, now: string) {
  const schedules = data.schedules.filter(s => s.date === day)
  const logs = data.workLogs.filter(l => l.date === day && l.date <= now)
  return {
    date: day, schedules, logs, capacity: capacityFor(data, weekStart(day), now)?.[weekdayIndex(day)] ?? null,
    scheduledMinutes: sumMinutes(schedules, s => s.plannedMinutes), actualMinutes: sumMinutes(logs, l => l.actualMinutes),
  }
}

const sumProgress = (logs: WorkLog[]) => logs.reduce((total, l) => total + (l.progressDelta === null ? 0n : quantityTicks(l.progressDelta)), 0n)
const nonnegative = (n: bigint) => n < 0n ? 0n : n
const boundedPercent = (numerator: bigint, denominator: bigint) =>
  denominator > 0n ? Number((numerator * 100n + denominator / 2n) / denominator) : null

function compareGoal(goal: Pick<WeekItem, 'minutes' | 'targetUnits'>, entry: PoolEntry | undefined, through: string,
  actualMinutes: number, actualUnits: bigint) {
  if (entry?.kind === 'todo') {
    const completed = Boolean(entry.completedOn && entry.completedOn <= through)
    return { reached: completed, percent: completed ? 100 : 0 }
  }
  if (goal.targetUnits !== null) {
    const target = quantityTicks(goal.targetUnits)
    return { reached: actualUnits >= target, percent: boundedPercent(actualUnits, target) }
  }
  return { reached: actualMinutes >= goal.minutes, percent: Math.round(actualMinutes * 100 / goal.minutes) }
}

export function unresolved(s: ScheduleBlock, data: Dataset, now: string): boolean {
  if (s.resolved) return false
  const entry = selectedEntry(data, s)
  return entry?.kind !== 'todo' || !entry.completedOn || entry.completedOn > now
}

export function weekSummary(data: Dataset, date: string, now: string) {
  const week = weekStart(date), days = weekDates(week), end = days.at(-1) ?? week
  const through = now < end ? now : end
  const between = (d: string) => d >= week && d <= end
  const schedules = data.schedules.filter(s => between(s.date))
  const logs = data.workLogs.filter(l => l.date >= week && l.date <= through)
  const cap = capacityFor(data, week, now)
  const rows = data.weekItems.filter(i => i.weekStart === week)
  const active = new Set(rows.filter(i => i.status === 'active').map(subjectKey))
  const plannedActualMinutes = sumMinutes(logs.filter(l => active.has(subjectKey(l))), l => l.actualMinutes)
  const actualMinutes = sumMinutes(logs, l => l.actualMinutes)
  const items = rows.map(item => {
    const key = subjectKey(item), entry = selectedEntry(data, item)
    const itemSchedules = schedules.filter(s => subjectKey(s) === key)
    const itemLogs = logs.filter(l => subjectKey(l) === key)
    const minutes = sumMinutes(itemLogs, l => l.actualMinutes), units = sumProgress(itemLogs)
    const current = compareGoal(item, entry, through, minutes, units)
    const original = item.baseline && compareGoal(item.baseline, entry, through, minutes, units)
    const future = itemSchedules.filter(s => s.date >= now && unresolved(s, data, now))
    const upcoming = future.map(s => {
      const recorded = itemLogs.filter(l => l.scheduleBlockId === s.id)
      return {
        minutes: Math.max(s.plannedMinutes - sumMinutes(recorded, l => l.actualMinutes), 0),
        units: s.plannedUnits ? nonnegative(quantityTicks(s.plannedUnits) - sumProgress(recorded)) : 0n,
      }
    })
    const leftMinutes = current.reached ? 0 : Math.max(item.minutes - minutes, 0)
    const leftUnits = item.targetUnits === null ? null : nonnegative(quantityTicks(item.targetUnits) - units)
    const futureMinutes = sumMinutes(upcoming, s => s.minutes)
    const futureUnits = upcoming.reduce((total, s) => total + s.units, 0n)
    const missingMinutes = Math.max(leftMinutes - futureMinutes, 0)
    const missingUnits = leftUnits === null ? null : nonnegative(leftUnits - futureUnits)
    const nothingPlanned = missingUnits !== null ? futureUnits === 0n : futureMinutes === 0
    const needsMore = missingUnits !== null ? missingUnits > 0n : missingMinutes > 0
    const scheduling = current.reached ? '目标已达成' : needsMore ? (nothingPlanned ? '待排程' : '部分已排') :
      (entry?.kind === 'todo' && leftMinutes === 0 ? '已达到估时' : '已充分排程')
    return { item, entry, actualMinutes: minutes, actualUnits: ticksQuantity(units),
      plannedMinutes: sumMinutes(itemSchedules, s => s.plannedMinutes), futureMinutes, futureUnits: ticksQuantity(futureUnits),
      leftMinutes, leftUnits: leftUnits === null ? null : ticksQuantity(leftUnits), missingMinutes,
      missingUnits: missingUnits === null ? null : ticksQuantity(missingUnits), needsMore,
      scheduling, current, original, missed: itemSchedules.filter(s => s.date < now && unresolved(s, data, now)).length,
    }
  })
  const original = items.filter(r => r.original)
  const current = items.filter(r => r.item.status === 'active')
  const dayStats = days.map(d => daySummary(data, d, now))
  const leftCapacity = cap === null ? null : dayStats.filter(d => d.date >= now)
    .reduce((total, d) => total + Math.max((d.capacity ?? 0) - d.scheduledMinutes, 0), 0)
  return {
    week, end, committedAt: data.weeks.find(w => w.weekStart === week)?.committedAt ?? null, days: dayStats, items,
    capacity: cap === null ? null : sumMinutes(cap, n => n), leftCapacity,
    plannedMinutes: sumMinutes(current, r => r.item.minutes), scheduledMinutes: sumMinutes(schedules, s => s.plannedMinutes),
    actualMinutes, plannedActualMinutes, unplannedActualMinutes: actualMinutes - plannedActualMinutes,
    initialPlannedMinutes: original.length ? sumMinutes(original, r => r.item.baseline!.minutes) : null,
    initialReached: original.filter(r => r.original?.reached).length, initialCount: original.length,
    currentReached: current.filter(r => r.current.reached).length, currentCount: current.length,
    missed: schedules.filter(s => s.date < now && unresolved(s, data, now)).length,
    added: items.filter(r => !r.item.baseline && r.item.status === 'active').length,
    carried: items.filter(r => r.item.status === 'carried').length,
    uncommitted: current.length > 0 && !data.weeks.find(w => w.weekStart === week)?.committedAt,
  }
}

export function recentWeeks(data: Dataset, through: string, count: number, now: string) {
  const first = weekStart(through)
  return Array.from({ length: count }, (_, i) => shiftDate(first, (i - count + 1) * 7))
    .flatMap(d => d ? [weekSummary(data, d, now)] : [])
}

export function studyBreakdown(data: Dataset, from: string, through: string) {
  const byCategory = new Map<string, number>()
  for (const log of data.workLogs) {
    if (log.date < from || log.date > through) continue
    const entry = selectedEntry(data, log)
    const category = data.categories.find(c => c.id === entry?.categoryId)?.name ?? '未分类'
    const project = data.projects.find(p => p.id === entry?.projectId)?.title
    const label = project ? `${category} / ${project}` : category
    byCategory.set(label, (byCategory.get(label) ?? 0) + log.actualMinutes)
  }
  return [...byCategory.entries()].sort((a, b) => b[1] - a[1])
}
