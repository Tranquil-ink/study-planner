import type { Command, ScheduleBlock, ScheduleInput, SchedulePeriod, TaskInput, TodoInput, WeekItem } from '../../domain/model'
import type { Editor } from './PlannerEditor'
import type { PoolEntry } from '../../domain/planning'

export interface PlannerActions {
  disabled: boolean
  edit: (command: Editor['command'], options?: Omit<Editor, 'base' | 'command'>) => void
  run: (command: Command, confirmation?: string) => void
  plan: (week: string, entry?: PoolEntry) => void
  schedule: (date: string, period: SchedulePeriod) => void
  complete: (schedule: ScheduleBlock) => void
  record: (date: string) => void
}

export function editWeekItem(item: WeekItem): Editor['command'] {
  return { type: 'saveWeekItem', value: {
    id: item.id, weekStart: item.weekStart, taskId: item.taskId, todoId: item.todoId,
    minutes: item.minutes, targetUnits: item.targetUnits,
  } }
}

export function editSchedule(row: ScheduleBlock): ScheduleInput {
  const { id, date, period, taskId, todoId, title, plannedMinutes, plannedUnits, plannedRangeText, note } = row
  return { id, date, period, taskId, todoId, title, plannedMinutes, plannedUnits, plannedRangeText, note }
}

export function newTask(categoryId: string, projectId: string | null = null): TaskInput {
  return { id: crypto.randomUUID(), categoryId, projectId, title: '', unitName: '页', totalUnits: null, initialCompletedUnits: '0',
    initialProgressLabel: '', note: '', archived: false, priority: 'normal', dueDate: null }
}

export function newTodo(categoryId: string | null = null, projectId: string | null = null): TodoInput {
  return { id: crypto.randomUUID(), categoryId, projectId, title: '', priority: 'normal', dueDate: null, estimatedMinutes: null,
    note: '', archived: false }
}
