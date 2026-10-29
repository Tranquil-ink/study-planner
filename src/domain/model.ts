import { z } from 'zod'
import { isBusinessDate, overlaps, validSlotSnapshot } from './calendar'

// Decimal strings round-trip to PostgreSQL numeric without IEEE-754 rounding.
export const quantitySchema = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/, '进度须为非负数，最多 9 位整数、6 位小数')
export function quantityTicks(value: string): bigint {
  quantitySchema.parse(value)
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}
export function displayQuantity(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'ID 格式不正确')
const text = (max: number) => z.string().max(max).refine(v => v.trim().length > 0, '请填写内容')
const audit = {
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}
const categoryFields = { id: uuid, name: text(100), color: z.string().regex(/^#[\da-fA-F]{6}$/), archived: z.boolean() }
const taskFields = {
  id: uuid, categoryId: uuid, title: text(200), unitName: text(20),
  totalUnits: quantitySchema.nullable(), initialCompletedUnits: quantitySchema,
  initialProgressLabel: z.string().max(200), note: z.string().max(5000), archived: z.boolean(),
}
function withinTotal(t: { totalUnits: string | null; initialCompletedUnits: string }) {
  if (!quantitySchema.safeParse(t.initialCompletedUnits).success || (t.totalUnits !== null && !quantitySchema.safeParse(t.totalUnits).success)) return false
  return t.totalUnits === null || quantityTicks(t.initialCompletedUnits) <= quantityTicks(t.totalUnits)
}
const progressRule = { message: '初始已完成量不能超过总量', path: ['initialCompletedUnits'] }
export const categoryInputSchema = z.strictObject(categoryFields)
export const taskInputSchema = z.strictObject(taskFields).refine(withinTotal, progressRule)
export const categorySchema = z.strictObject({ ...categoryFields, ...audit }).refine(v => Date.parse(v.updatedAt) >= Date.parse(v.createdAt), '修改时间早于创建时间')
export const taskSchema = z.strictObject({ ...taskFields, ...audit }).refine(withinTotal, progressRule).refine(v => Date.parse(v.updatedAt) >= Date.parse(v.createdAt), '修改时间早于创建时间')
const scheduleFields = {
  id: uuid, date: z.string().refine(isBusinessDate, '日期不正确'),
  slotTemplateVersion: z.union([z.literal(1), z.literal(2)]), slotIds: z.array(z.number().int().min(1).max(11)).min(1).max(11),
  startMinute: z.number().int(), endMinute: z.number().int(),
  taskId: uuid.nullable(), title: text(200), plannedRangeText: z.string().max(500), note: z.string().max(5000),
}
export const scheduleInputSchema = z.strictObject(scheduleFields).refine(validSlotSnapshot, '基础时段与时间快照不一致')
export const scheduleSchema = z.strictObject({ ...scheduleFields, ...audit }).refine(validSlotSnapshot, '基础时段与时间快照不一致').refine(v => Date.parse(v.updatedAt) >= Date.parse(v.createdAt), '修改时间早于创建时间')
export const mergeSchedulesSchema = z.strictObject({
  ids: z.array(uuid).min(2).max(11).refine(ids => new Set(ids).size === ids.length),
  result: scheduleInputSchema, contentConfirmed: z.literal(true),
})
export const splitScheduleSchema = z.strictObject({ id: uuid, copyPlanText: z.boolean() })
export const removeScheduleSchema = z.strictObject({ id: uuid })
export type ScheduleInput = z.infer<typeof scheduleInputSchema>
export type ScheduleBlock = z.infer<typeof scheduleSchema>
const workLogFields = {
  id: uuid, date: z.string().refine(isBusinessDate, '日期不正确'), taskId: uuid.nullable(), scheduleBlockId: uuid.nullable(),
  titleSnapshot: text(200), actualMinutes: z.number().int().min(1).max(2147483647),
  progressDelta: quantitySchema.nullable(), progressLabel: z.string().max(200), note: z.string().max(5000),
}
const validLogProgress = (v: { taskId: string | null; progressDelta: string | null }) => (v.taskId === null) === (v.progressDelta === null)
export const workLogInputSchema = z.strictObject(workLogFields).refine(validLogProgress, '长期任务须填写新增完成量；临时事项没有任务进度')
export const workLogSchema = z.strictObject({ ...workLogFields, createdOrder: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1), ...audit })
  .refine(validLogProgress, '实际记录进度类型不正确').refine(v => Date.parse(v.updatedAt) >= Date.parse(v.createdAt), '修改时间早于创建时间')
export type WorkLogInput = z.infer<typeof workLogInputSchema>
export type WorkLog = z.infer<typeof workLogSchema>
export const settingsSchema = z.strictObject({ timezone: z.literal('Asia/Shanghai'), dateFormat: z.literal('YYYY-MM-DD') })
export const datasetSchema = z.strictObject({ categories: z.array(categorySchema), tasks: z.array(taskSchema), schedules: z.array(scheduleSchema), workLogs: z.array(workLogSchema), settings: settingsSchema }).superRefine((data, ctx) => {
  for (const rows of [data.categories, data.tasks, data.schedules, data.workLogs]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: '存在重复 ID' })
  }
  const taskIds = new Set(data.tasks.map(t => t.id))
  if (data.schedules.some(s => s.taskId !== null && !taskIds.has(s.taskId))) ctx.addIssue({ code: 'custom', message: '日程引用的任务不存在' })
  const ordered = [...data.schedules].sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute)
  if (ordered.some((s, i) => i > 0 && overlaps(ordered[i - 1], s))) ctx.addIssue({ code: 'custom', message: '同一天基础时段重复占用' })
  if (new Set(data.workLogs.map(l => l.createdOrder)).size !== data.workLogs.length) ctx.addIssue({ code: 'custom', message: '实际记录创建顺序重复' })
  for (const log of data.workLogs) {
    if (log.taskId !== null && !taskIds.has(log.taskId)) ctx.addIssue({ code: 'custom', message: '实际记录引用的任务不存在' })
    if (log.scheduleBlockId !== null) {
      const schedule = data.schedules.find(s => s.id === log.scheduleBlockId)
      if (!schedule || schedule.taskId !== log.taskId) ctx.addIssue({ code: 'custom', message: '实际记录关联日程不存在或任务不一致' })
    }
  }
  for (const task of data.tasks) {
    if (!quantitySchema.safeParse(task.initialCompletedUnits).success || (task.totalUnits !== null && !quantitySchema.safeParse(task.totalUnits).success)) continue
    const deltas = data.workLogs.filter(l => l.taskId === task.id).map(l => l.progressDelta)
    if (deltas.some(v => !quantitySchema.safeParse(v).success)) continue
    const completed = deltas.reduce<bigint>((sum, v) => sum + quantityTicks(v!), quantityTicks(task.initialCompletedUnits))
    if (task.totalUnits !== null && completed > quantityTicks(task.totalUnits)) ctx.addIssue({ code: 'custom', message: '初始量与实际记录累计进度超过任务总量' })
  }
  const ids = new Set(data.categories.map(c => c.id))
  if (data.tasks.some(t => !ids.has(t.categoryId))) ctx.addIssue({ code: 'custom', message: '任务引用的分类不存在' })
})
export const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1)
export const snapshotSchema = z.strictObject({ revision: revisionSchema, categories: z.array(categorySchema), tasks: z.array(taskSchema), schedules: z.array(scheduleSchema), workLogs: z.array(workLogSchema), settings: settingsSchema }).superRefine((s, ctx) => {
  const result = datasetSchema.safeParse(businessData(s))
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message })
})
export const receiptSchema = z.strictObject({ requestId: uuid, revision: revisionSchema })
export type CategoryInput = z.infer<typeof categoryInputSchema>
export type TaskInput = z.infer<typeof taskInputSchema>
export type Category = z.infer<typeof categorySchema>
export type LearningTask = z.infer<typeof taskSchema>
export type Dataset = z.infer<typeof datasetSchema>
export type Snapshot = z.infer<typeof snapshotSchema>
export type Receipt = z.infer<typeof receiptSchema>
export type Command = { type: 'saveWorkLog'; value: WorkLogInput } | { type: 'removeWorkLog'; value: { id: string } } | { type: 'mergeSchedules'; value: z.infer<typeof mergeSchedulesSchema> } | { type: 'splitSchedule'; value: z.infer<typeof splitScheduleSchema> } | { type: 'saveCategory'; value: CategoryInput } | { type: 'saveTask'; value: TaskInput } | { type: 'saveSchedule'; value: ScheduleInput } | { type: 'removeSchedule'; value: { id: string } } | { type: 'restore'; value: Dataset }
export interface Operation { requestId: string; expectedRevision: number; command: Command }
export function businessData(snapshot: Snapshot): Dataset {
  return { categories: snapshot.categories, tasks: snapshot.tasks, schedules: snapshot.schedules, workLogs: snapshot.workLogs, settings: snapshot.settings }
}
export function validateCommand(command: Command): Command {
  if (command.type === 'saveWorkLog') return { ...command, value: workLogInputSchema.parse(command.value) }
  if (command.type === 'removeWorkLog') return { ...command, value: removeScheduleSchema.parse(command.value) }
  if (command.type === 'mergeSchedules') return { ...command, value: mergeSchedulesSchema.parse(command.value) }
  if (command.type === 'splitSchedule') return { ...command, value: splitScheduleSchema.parse(command.value) }
  if (command.type === 'saveCategory') return { ...command, value: categoryInputSchema.parse(command.value) }
  if (command.type === 'saveTask') return { ...command, value: taskInputSchema.parse(command.value) }
  if (command.type === 'saveSchedule') return { ...command, value: scheduleInputSchema.parse(command.value) }
  if (command.type === 'removeSchedule') return { ...command, value: removeScheduleSchema.parse(command.value) }
  return { type: 'restore', value: datasetSchema.parse(command.value) }
}
