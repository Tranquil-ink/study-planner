import type { Command, ScheduleBlock, Subject, WeekItem } from '../../domain/model'
import type { Editor } from './PlannerEditor'
import type { PoolEntry } from '../../domain/planning'

export interface PlannerActions {
  disabled: boolean
  edit: (command: Editor['command'], options?: Omit<Editor, 'base' | 'command'>) => void
  run: (command: Command, confirmation?: string) => void
  plan: (entry?: PoolEntry) => void
  schedule: (date: string, subject?: Subject, minutes?: number, units?: string | null) => void
  record: (date: string, schedule?: ScheduleBlock, subject?: Subject) => void
}

export function editWeekItem(item: WeekItem): Editor['command'] {
  return { type: 'saveWeekItem', value: { id: item.id, weekStart: item.weekStart, taskId: item.taskId, todoId: item.todoId,
    minutes: item.minutes, targetUnits: item.targetUnits } }
}
