import { z } from 'zod'
import { isBusinessDate, weekStart, weekdayIndex } from './calendar'

// Keep quantities exact across the browser, PostgreSQL and JSON backups.
export const quantitySchema = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/, '进度须为非负数，最多 9 位整数、6 位小数')
export function quantityTicks(value: string): bigint {
  quantitySchema.parse(value)
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}
export function displayQuantity(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}
const positiveQuantity = quantitySchema.refine(v => /[1-9]/.test(v), '目标量须大于零')
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'ID 格式不正确')
const text = (max: number) => z.string().max(max).refine(v => v.trim().length > 0, '请填写内容')
const day = z.string().refine(isBusinessDate, '日期不正确')
const monday = day.refine(d => weekdayIndex(d) === 0, '请选择有效的周一日期')
const priority = z.enum(['normal', 'important', 'urgent'])
const duration = z.number().int().min(1, '请填写大于零的分钟数').max(1440)
const weeklyDuration = z.number().int().min(1, '请填写大于零的周分钟数').max(10080)
const clock = z.iso.datetime({ offset: true })
const audit = { createdAt: clock, updatedAt: clock }
const activated = { activated: z.boolean() }
const auditOrder = (row: { createdAt: string; updatedAt: string }) => Date.parse(row.updatedAt) >= Date.parse(row.createdAt)
const subjectFields = { taskId: uuid.nullable(), todoId: uuid.nullable() }
export type Subject = { taskId: string | null; todoId: string | null }
const atMostOneSubject = (row: Subject) => !row.taskId || !row.todoId

const categoryFields = { id: uuid, name: text(100), color: z.string().regex(/^#[\da-fA-F]{6}$/), archived: z.boolean() }
const projectFields = { id: uuid, categoryId: uuid, title: text(200), archived: z.boolean() }
const taskFields = {
  id: uuid, categoryId: uuid, projectId: uuid.nullable(), title: text(200), unitName: text(20),
  totalUnits: quantitySchema.nullable(), initialCompletedUnits: quantitySchema,
  initialProgressLabel: z.string().max(200), note: z.string().max(5000), archived: z.boolean(), priority, dueDate: day.nullable(),
}
const todoFields = {
  id: uuid, categoryId: uuid.nullable(), projectId: uuid.nullable(), title: text(200), priority,
  dueDate: day.nullable(), estimatedMinutes: weeklyDuration.nullable(), note: z.string().max(5000), archived: z.boolean(),
}
function withinTotal(t: { totalUnits: string | null; initialCompletedUnits: string }) {
  if (!quantitySchema.safeParse(t.initialCompletedUnits).success || (t.totalUnits !== null && !quantitySchema.safeParse(t.totalUnits).success)) return false
  return t.totalUnits === null || quantityTicks(t.initialCompletedUnits) <= quantityTicks(t.totalUnits)
}
const progressRule = { message: '初始已完成量不能超过总量', path: ['initialCompletedUnits'] }
const todoParent = (v: { categoryId: string | null; projectId: string | null }) => !v.projectId || !!v.categoryId

export const categoryInputSchema = z.strictObject(categoryFields)
export const projectInputSchema = z.strictObject(projectFields)
export const taskInputSchema = z.strictObject(taskFields).refine(withinTotal, progressRule)
export const todoInputSchema = z.strictObject({ ...todoFields, recursWeekly: z.boolean().optional() })
  .refine(todoParent, '项目需要所属分类')
  .refine(v => !v.recursWeekly || (!!v.categoryId && v.estimatedMinutes !== null && v.dueDate === null),
    '周期任务需要分类和每周时长')
export const categorySchema = categoryInputSchema.extend(audit).refine(auditOrder)
export const projectSchema = projectInputSchema.extend(audit).refine(auditOrder)
const todoAudit = { ...audit, completedOn: day.nullable() }
const taskSchema = z.strictObject({ ...taskFields, ...audit, ...activated }).refine(withinTotal, progressRule).refine(auditOrder)
const todoSnapshotFields = { ...todoFields, ...todoAudit, ...activated }
const todoSchema = z.discriminatedUnion('recursWeekly', [
  z.strictObject({ ...todoSnapshotFields, recursWeekly: z.literal(false), recurringNextWeek: z.null() }),
  z.strictObject({
    ...todoSnapshotFields, recursWeekly: z.literal(true), recurringNextWeek: monday.nullable(),
    categoryId: uuid, dueDate: z.null(), completedOn: z.null(), estimatedMinutes: weeklyDuration,
  }).refine(v => v.activated === (v.recurringNextWeek !== null)),
]).refine(todoParent).refine(auditOrder)

const capacityMinutes = z.number().int().min(0).max(1440)
const dayCapacity = z.tuple([capacityMinutes, capacityMinutes, capacityMinutes])
  .refine(minutes => minutes.reduce((sum, value) => sum + value, 0) <= 1440, '每天可用时间最多 24 小时')
const sevenDays = <T extends z.ZodType>(value: T) => z.tuple([value, value, value, value, value, value, value])
const capacitySchema = sevenDays(dayCapacity)
const weekFields = { weekStart: monday, committedAt: clock.nullable() }
const weekSchema = z.strictObject({ ...weekFields, capacity: capacitySchema.nullable() })
const weekItemFields = {
  id: uuid, weekStart: monday, ...subjectFields, minutes: weeklyDuration, targetUnits: positiveQuantity.nullable(),
}
const validWeekSubject = (row: Subject & { targetUnits: string | null }) =>
  (!!row.taskId !== !!row.todoId) && (!row.targetUnits || !!row.taskId)
const baseline = z.strictObject({ minutes: weeklyDuration, targetUnits: positiveQuantity.nullable() })
const weekItemStatus = z.enum(['active', 'returned', 'cancelled', 'carried'])
export const weekItemInputSchema = z.strictObject(weekItemFields).refine(validWeekSubject, '请选择一项任务')
const weekItemSnapshotFields = { ...weekItemFields, ...audit, status: weekItemStatus, baseline: baseline.nullable() }
const weekItemSchema = z.strictObject({ ...weekItemSnapshotFields, recurringCompletedOn: day.nullable() })
  .refine(validWeekSubject).refine(v => !!v.taskId || !v.baseline?.targetUnits).refine(auditOrder)

const scheduleFields = {
  id: uuid, date: day, ...subjectFields, title: text(200), plannedMinutes: duration,
  plannedUnits: positiveQuantity.nullable(), plannedRangeText: z.string().max(500), note: z.string().max(5000),
}
export const PERIODS = ['morning', 'afternoon', 'evening'] as const
const periodSchema = z.enum(PERIODS)
const scheduleOutcome = z.enum(['pending', 'completed', 'skipped'])
const scheduleInputFields = { ...scheduleFields, period: periodSchema }
const validSchedule = (row: Subject & { plannedUnits: string | null }) => atMostOneSubject(row) && (!row.plannedUnits || !!row.taskId)
const scheduleInputSchema = z.strictObject(scheduleInputFields).refine(validSchedule, '计划量仅用于长期任务')
const scheduleSchema = z.strictObject({
  ...scheduleInputFields, ...audit, position: z.number().int().min(0).max(2147483647), outcome: scheduleOutcome,
}).refine(validSchedule).refine(auditOrder)

const workLogFields = {
  id: uuid, date: day, ...subjectFields, scheduleBlockId: uuid.nullable(),
  titleSnapshot: text(200), actualMinutes: z.number().int().min(1, '请填写实际分钟数').max(2147483647),
  progressDelta: quantitySchema.nullable(), progressLabel: z.string().max(200), note: z.string().max(5000),
}
const validLogProgress = (v: Subject & { progressDelta: string | null }) =>
  atMostOneSubject(v) && (v.taskId === null) === (v.progressDelta === null)
export const workLogInputSchema = z.strictObject(workLogFields).refine(validLogProgress, '仅长期任务可以记录新增完成量')
const workLogSchema = z.strictObject({ ...workLogFields, createdOrder: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1), ...audit })
  .refine(validLogProgress).refine(auditOrder)
const settingsFields = { timezone: z.literal('Asia/Shanghai'), dateFormat: z.literal('YYYY-MM-DD') }
const settingsSchema = z.strictObject({ ...settingsFields, capacityTemplate: capacitySchema.nullable() })

export function subjectKey(row: Subject): string | null {
  return row.taskId ? `task:${row.taskId}` : row.todoId ? `todo:${row.todoId}` : null
}

const commonDatasetFields = {
  categories: z.array(categorySchema), projects: z.array(projectSchema), tasks: z.array(taskSchema),
  weeks: z.array(weekSchema), schedules: z.array(scheduleSchema),
  workLogs: z.array(workLogSchema), settings: settingsSchema,
}
const legacyWeekItems = z.array(z.strictObject(weekItemSnapshotFields))
export const v6DatasetSchema = z.strictObject({
  ...commonDatasetFields,
  todos: z.array(z.strictObject(todoSnapshotFields)),
  weekItems: legacyWeekItems,
})
export const v5DatasetSchema = z.strictObject({
  ...commonDatasetFields,
  weekItems: legacyWeekItems,
  tasks: z.array(z.strictObject({ ...taskFields, ...audit })),
  todos: z.array(z.strictObject({ ...todoFields, ...todoAudit })),
  weeks: z.array(z.strictObject({ ...weekFields, capacity: sevenDays(capacityMinutes).nullable() })),
  schedules: z.array(z.strictObject({ ...scheduleFields, ...audit, resolved: z.boolean() })),
  settings: z.strictObject({ ...settingsFields, capacityTemplate: sevenDays(capacityMinutes).nullable() }),
})
export const datasetSchema = z.strictObject({
  ...commonDatasetFields, todos: z.array(todoSchema), weekItems: z.array(weekItemSchema),
}).superRefine((data, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  for (const rows of [data.categories, data.projects, data.tasks, data.todos, data.weekItems, data.schedules, data.workLogs]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) issue('存在重复 ID')
  }
  const weeks = new Map(data.weeks.map(w => [w.weekStart, w]))
  if (weeks.size !== data.weeks.length) issue('同一周有重复的周计划')
  const categoryIds = new Set(data.categories.map(c => c.id))
  const projects = new Map(data.projects.map(p => [p.id, p]))
  const validParent = (row: { categoryId: string | null; projectId: string | null }) =>
    (!row.categoryId || categoryIds.has(row.categoryId)) && (!row.projectId || projects.get(row.projectId)?.categoryId === row.categoryId)
  if (data.projects.some(p => !categoryIds.has(p.categoryId)) || [...data.tasks, ...data.todos].some(row => !validParent(row))) issue('分类或项目引用不正确')
  const taskIds = new Set(data.tasks.map(t => t.id)), todos = new Map(data.todos.map(t => [t.id, t]))
  const exists = (row: Subject) => (!row.taskId || taskIds.has(row.taskId)) && (!row.todoId || todos.has(row.todoId))
  if ([...data.weekItems, ...data.schedules, ...data.workLogs].some(row => !exists(row))) issue('任务或待办引用不存在')
  const weekSubjects = new Set<string>()
  for (const row of data.weekItems) {
    const key = `${row.weekStart}/${subjectKey(row)}`
    if (weekSubjects.has(key)) issue('同一任务在同一周只有一条目标')
    weekSubjects.add(key)
    if (!weeks.has(row.weekStart) || (row.baseline && !weeks.get(row.weekStart)?.committedAt)) issue('周目标与周计划或周初基线不一致')
    if (row.recurringCompletedOn && (!row.todoId || !todos.get(row.todoId)?.recursWeekly ||
      weekStart(row.recurringCompletedOn) !== row.weekStart)) issue('周期任务的完成日期与周目标不一致')
  }
  if (new Set(data.workLogs.map(l => l.createdOrder)).size !== data.workLogs.length) issue('实际记录创建顺序重复')
  const positions = new Set(data.schedules.map(s => `${s.date}/${s.period}/${s.position}`))
  if (positions.size !== data.schedules.length) issue('同一时段存在重复的安排顺序')
  const schedules = new Map(data.schedules.map(s => [s.id, s])), totals = new Map<string, bigint>()
  for (const log of data.workLogs) {
    if (log.scheduleBlockId) {
      const schedule = schedules.get(log.scheduleBlockId)
      if (!schedule || subjectKey(schedule) !== subjectKey(log)) issue('实际记录与关联安排不一致')
    }
    if (log.taskId && log.progressDelta !== null && quantitySchema.safeParse(log.progressDelta).success) {
      totals.set(log.taskId, (totals.get(log.taskId) ?? 0n) + quantityTicks(log.progressDelta))
    }
  }
  for (const task of data.tasks) {
    if (task.totalUnits !== null && withinTotal(task) && quantityTicks(task.initialCompletedUnits) + (totals.get(task.id) ?? 0n) > quantityTicks(task.totalUnits)) {
      issue('初始量与实际记录累计进度超过任务总量')
    }
  }
})
export const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1)
export const snapshotSchema = datasetSchema.safeExtend({ revision: revisionSchema })
export const receiptSchema = z.strictObject({ requestId: uuid, revision: revisionSchema })
const idInput = z.strictObject({ id: uuid })
const weekInput = z.strictObject({ weekStart: monday })
const newEntrySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('saveTask'), value: taskInputSchema }),
  z.strictObject({ type: z.literal('saveTodo'), value: todoInputSchema }),
])
const scheduledEntrySchema = z.strictObject({ entry: newEntrySchema, schedule: scheduleInputSchema })
  .refine(({ entry, schedule }) => (entry.type === 'saveTask' ? schedule.taskId : schedule.todoId) === entry.value.id,
    '新增任务须与日程关联一致')
const moveScheduleSchema = idInput.extend({ date: day, period: periodSchema, beforeId: uuid.nullable() })
  .refine(v => v.beforeId !== v.id, '请选择另一项作为移动位置')
const completeScheduleSchema = idInput.extend({
  logId: uuid, date: day, actualMinutes: workLogFields.actualMinutes, reachedUnits: quantitySchema.nullable(),
  progressLabel: workLogFields.progressLabel, note: workLogFields.note,
})
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('saveCategory'), value: categoryInputSchema }),
  z.strictObject({ type: z.literal('saveProject'), value: projectInputSchema }),
  z.strictObject({ type: z.literal('saveTask'), value: taskInputSchema }),
  z.strictObject({ type: z.literal('saveTodo'), value: todoInputSchema }),
  z.strictObject({ type: z.literal('setSubjectActivated'), value: idInput.extend({ kind: z.enum(['task', 'todo', 'recurring']), activated: z.boolean() }) }),
  z.strictObject({ type: z.literal('saveWeekItem'), value: weekItemInputSchema }),
  z.strictObject({ type: z.literal('setWeekItemStatus'), value: idInput.extend({ status: z.enum(['active', 'returned', 'cancelled']) }) }),
  z.strictObject({ type: z.literal('commitWeek'), value: weekInput }),
  z.strictObject({ type: z.literal('saveWeekCapacity'), value: weekInput.extend({ capacity: capacitySchema }) }),
  z.strictObject({ type: z.literal('saveCapacityTemplate'), value: z.strictObject({ capacity: capacitySchema }) }),
  z.strictObject({ type: z.literal('saveSchedule'), value: scheduleInputSchema }),
  z.strictObject({ type: z.literal('createScheduledEntry'), value: scheduledEntrySchema }),
  z.strictObject({ type: z.literal('moveSchedule'), value: moveScheduleSchema }),
  z.strictObject({ type: z.literal('completeSchedule'), value: completeScheduleSchema }),
  z.strictObject({ type: z.literal('setScheduleOutcome'), value: idInput.extend({ outcome: z.enum(['pending', 'skipped']) }) }),
  z.strictObject({ type: z.literal('removeSchedule'), value: idInput }),
  z.strictObject({ type: z.literal('saveWorkLog'), value: workLogInputSchema }),
  z.strictObject({ type: z.literal('removeWorkLog'), value: idInput }),
  z.strictObject({ type: z.literal('restore'), value: datasetSchema }),
])
export type CategoryInput = z.infer<typeof categoryInputSchema>
export type ProjectInput = z.infer<typeof projectInputSchema>
export type TaskInput = z.infer<typeof taskInputSchema>
export type TodoInput = z.infer<typeof todoInputSchema>
export type Capacity = z.infer<typeof capacitySchema>
export type DayCapacity = z.infer<typeof dayCapacity>
export type SchedulePeriod = z.infer<typeof periodSchema>
export type Week = z.infer<typeof weekSchema>
export type WeekItem = z.infer<typeof weekItemSchema>
export type WeekItemInput = z.infer<typeof weekItemInputSchema>
export type ScheduleInput = z.infer<typeof scheduleInputSchema>
export type ScheduleBlock = z.infer<typeof scheduleSchema>
export type WorkLogInput = z.infer<typeof workLogInputSchema>
export type WorkLog = z.infer<typeof workLogSchema>
export type Category = z.infer<typeof categorySchema>
export type Project = z.infer<typeof projectSchema>
export type LearningTask = z.infer<typeof taskSchema>
export type Todo = z.infer<typeof todoSchema>
export type Dataset = z.infer<typeof datasetSchema>
export type Snapshot = z.infer<typeof snapshotSchema>
export type Receipt = z.infer<typeof receiptSchema>
export type Command = z.infer<typeof commandSchema>
export interface Operation { requestId: string; expectedRevision: number; command: Command }

export function businessData(s: Snapshot): Dataset {
  return { categories: s.categories, projects: s.projects, tasks: s.tasks, todos: s.todos, weeks: s.weeks,
    weekItems: s.weekItems, schedules: s.schedules, workLogs: s.workLogs, settings: s.settings }
}

export function validateCommand(command: Command): Command {
  return commandSchema.parse(command)
}
