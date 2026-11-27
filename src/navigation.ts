export const pages = [
  { id: 'today', label: '今天' },
  { id: 'tasks', label: '任务池' },
  { id: 'planning', label: '本周目标' },
  { id: 'calendar', label: '日程' },
  { id: 'review', label: '复盘' },
  { id: 'settings', label: '数据设置' },
] as const

export type Page = (typeof pages)[number]
