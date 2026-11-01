import { weekDates } from './calendar'
import type { Snapshot } from './model'
import type { Availability, WeekEntry } from './planning-schema'
export function unionAvailability(intervals: Availability): Availability {
  const result: Availability = []
  for (const interval of [...intervals].sort((a, b) => a.day - b.day || a.startMinute - b.startMinute)) {
    const last = result.at(-1)
    if (last && last.day === interval.day && last.endMinute >= interval.startMinute) last.endMinute = Math.max(last.endMinute, interval.endMinute)
    else result.push({ ...interval })
  }
  return result
}
export function capacityMinutes(intervals: Availability) { return unionAvailability(intervals).reduce((sum, s) => sum + s.endMinute - s.startMinute, 0) }
export function weekSummary(snapshot: Snapshot, week: string, availability: Availability, entries: WeekEntry[]) {
  const dates = weekDates(week), intervals = unionAvailability(availability)
  const schedules = snapshot.schedules.filter(s => dates.includes(s.date))
  const scheduled = schedules.reduce((sum, s) => sum + s.endMinute - s.startMinute, 0)
  const covered = schedules.reduce((sum, s) => sum + intervals.filter(i => i.day === dates.indexOf(s.date)).reduce((n, i) => n + Math.max(0, Math.min(i.endMinute, s.endMinute) - Math.max(i.startMinute, s.startMinute)), 0), 0)
  return { capacity: capacityMinutes(availability), planned: entries.filter(e => !e.cancelled).reduce((sum, e) => sum + e.estimatedMinutes, 0), scheduled,
    actual: snapshot.workLogs.filter(l => dates.includes(l.date)).reduce((sum, l) => sum + l.actualMinutes, 0), extra: scheduled - covered }
}
export function carryDraft(entries: WeekEntry[], existing: WeekEntry[], makeId: () => string): WeekEntry[] {
  return entries.filter(e => e.carryToNextWeek && !e.cancelled && !existing.some(x => (x.taskId ?? x.todoId) === (e.taskId ?? e.todoId))).map(e => ({ ...e, id: makeId() }))
}
