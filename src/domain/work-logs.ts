import { displayQuantity, quantityTicks, type LearningTask, type WorkLog } from './model'

export function ticksQuantity(ticks: bigint): string {
  return displayQuantity(`${ticks / 1_000_000n}.${String(ticks % 1_000_000n).padStart(6, '0')}`)
}
/** A cutoff is a business date, never the server's clock or the last edit time. */
export function taskProgress(task: LearningTask, logs: WorkLog[], through = '9999-12-31') {
  const rows = logs.filter(l => l.taskId === task.id && l.date <= through)
  const completed = rows.reduce((sum, l) => sum + quantityTicks(l.progressDelta!), quantityTicks(task.initialCompletedUnits))
  const latest = rows.filter(l => l.progressLabel.trim()).sort((a, b) => b.date.localeCompare(a.date) || b.createdOrder - a.createdOrder)[0]
  return { completedUnits: ticksQuantity(completed), progressLabel: latest?.progressLabel ?? task.initialProgressLabel, actualMinutes: rows.reduce((sum, l) => sum + l.actualMinutes, 0) }
}
