import { displayQuantity, quantityTicks, type LearningTask, type WorkLog } from './model'

export function ticksQuantity(ticks: bigint): string {
  return displayQuantity(`${ticks / 1_000_000n}.${String(ticks % 1_000_000n).padStart(6, '0')}`)
}
export function sumProgress(logs: WorkLog[]): bigint {
  return logs.reduce((total, log) => total + (log.progressDelta === null ? 0n : quantityTicks(log.progressDelta)), 0n)
}
/** A cutoff is a business date, never the server's clock or the last edit time. */
export function taskProgress(task: LearningTask, logs: WorkLog[], through = '9999-12-31') {
  const rows = logs.filter(l => l.taskId === task.id && l.date <= through)
  const completedTicks = quantityTicks(task.initialCompletedUnits) + sumProgress(rows)
  const latest = rows.filter(l => l.progressLabel.trim()).sort((a, b) => b.date.localeCompare(a.date) || b.createdOrder - a.createdOrder)[0]
  return { completedTicks, completedUnits: ticksQuantity(completedTicks), progressLabel: latest?.progressLabel ?? task.initialProgressLabel,
    actualMinutes: rows.reduce((sum, l) => sum + l.actualMinutes, 0) }
}
