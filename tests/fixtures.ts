import type { CategoryInput, Dataset, ScheduleBlock, ScheduleInput, TaskInput, TodoInput, WeekItemInput } from '../src/domain/model'
export const ownerA = '10000000-0000-4000-8000-000000000001'
export const ownerB = '10000000-0000-4000-8000-000000000002'
export const category: CategoryInput = { id: '20000000-0000-4000-8000-000000000001', name: '虚构物理分类', color: '#32796b', archived: false }
export const legacyTask = { id: '30000000-0000-4000-8000-000000000001', categoryId: category.id, title: '虚构理论力学', unitName: '页',
  totalUnits: '40', initialCompletedUnits: '8', initialProgressLabel: '2.1.1', note: '', archived: false }
export const task: TaskInput = { ...legacyTask, projectId: null, priority: 'normal', dueDate: null }
export const todo: TodoInput = { id: '30000000-0000-4000-8000-000000000002', categoryId: null, projectId: null, title: '虚构课程报告',
  priority: 'important', dueDate: null, estimatedMinutes: 80, note: '', archived: false }
export const audit = { createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' }
export const schedule: ScheduleInput = { id: '50000000-0000-4000-8000-000000000001', date: '2026-10-20', taskId: task.id, todoId: null,
  title: task.title, plannedMinutes: 60, plannedUnits: '10', plannedRangeText: '2.1～2.3', note: '虚构日程', period: 'morning' }
export const scheduled: ScheduleBlock = { ...schedule, ...audit, outcome: 'pending', position: 0 }
export const goal: WeekItemInput = { id: '60000000-0000-4000-8000-000000000001', weekStart: '2026-10-19',
  taskId: task.id, todoId: null, minutes: 240, targetUnits: '30' }

export function fixtureData(): Dataset {
  return { categories: [{ ...category, ...audit }], projects: [], tasks: [{ ...task, ...audit, activated: false }],
    todos: [{ ...todo, ...audit, activated: false, completedOn: null }],
    weeks: [], weekItems: [], schedules: [], workLogs: [], settings: { timezone: 'Asia/Shanghai', dateFormat: 'YYYY-MM-DD', capacityTemplate: null } }
}
