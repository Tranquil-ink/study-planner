export const pages = [
  { id: 'today', label: '今天', description: '看到接下来要做的事，随手记录实际学习。' },
  { id: 'tasks', label: '任务池', description: '收集待办，整理课程与长期任务。' },
  { id: 'planning', label: '本周', description: '选出本周重点，看看时间够不够。' },
  { id: 'calendar', label: '日历', description: '按天安排任务，比较计划与实际投入。' },
  { id: 'review', label: '复盘', description: '对照周初目标，查看你实际推进了多少。' },
  { id: 'settings', label: '数据设置', description: '导出和恢复学习数据。' },
] as const

export type Page = (typeof pages)[number]
