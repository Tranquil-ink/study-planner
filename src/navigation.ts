// 这里只描述导航和未实现页面，不保存任务、日程或统计数据。
export const pages = [
  {
    id: 'calendar',
    label: '日历',
    description: '为每天的学习留出合适的时间。',
    pendingTitle: '日历排程尚未实现',
    pendingDescription: '周历、日视图和手动安排任务将在后续阶段开放。目前不能创建或编辑日程。',
  },
  {
    id: 'tasks',
    label: '任务池',
    description: '把想学的内容整理成长期任务。',
    pendingTitle: '任务管理尚未实现',
    pendingDescription: '分类、长期任务与进度管理将在后续阶段开放。目前不能添加或保存学习任务。',
  },
  {
    id: 'planning',
    label: '周期计划',
    description: '从周期目标出发，规划每周投入。',
    pendingTitle: '周期与周预算尚未实现',
    pendingDescription: '月计划、半学期目标和每周投入预算将在后续阶段开放。目前不能创建或调整计划。',
  },
  {
    id: 'review',
    label: '复盘',
    description: '对照计划与实际，了解学习进展。',
    pendingTitle: '复盘与预测尚未实现',
    pendingDescription: '实际投入汇总、进度统计和完成日期预测将在后续阶段开放。目前没有学习报告。',
  },
  {
    id: 'settings',
    label: '数据设置',
    description: '管理云端学习数据与完整 JSON 备份。',
    pendingTitle: '数据保存与备份尚未实现',
    pendingDescription: '浏览器内保存、完整备份导出和恢复将在后续阶段开放。当前版本不会读取或写入学习数据。',
  },
] as const

export type Page = (typeof pages)[number]
