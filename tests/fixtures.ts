import type { CategoryInput, Dataset, TaskInput } from '../src/domain/model'
export const ownerA = '10000000-0000-4000-8000-000000000001'
export const ownerB = '10000000-0000-4000-8000-000000000002'
export const category: CategoryInput = { id: '20000000-0000-4000-8000-000000000001', name: '虚构物理分类', color: '#32796b', archived: false }
export const task: TaskInput = { id: '30000000-0000-4000-8000-000000000001', categoryId: category.id, title: '虚构理论力学', unitName: '节', totalUnits: '40', initialCompletedUnits: '8', initialProgressLabel: '2.1.1', note: '', archived: false }
export const audit = { createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' }
export function fixtureData(): Dataset { return { categories: [{ ...category, ...audit }], tasks: [{ ...task, ...audit }], schedules: [], workLogs: [], settings: { timezone: 'Asia/Shanghai', dateFormat: 'YYYY-MM-DD' } } }

export const schedule = { id: '50000000-0000-4000-8000-000000000001', date: '2026-10-20', slotTemplateVersion: 1 as const, slotIds: [2], startMinute: 540, endMinute: 600, taskId: task.id, title: task.title, plannedRangeText: '2.1～2.3', note: '虚构日程' }
