import { z } from 'zod'

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
export const settingsSchema = z.strictObject({ timezone: z.literal('Asia/Shanghai'), dateFormat: z.literal('YYYY-MM-DD') })
export const datasetSchema = z.strictObject({ categories: z.array(categorySchema), tasks: z.array(taskSchema), settings: settingsSchema }).superRefine((data, ctx) => {
  for (const rows of [data.categories, data.tasks]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: '存在重复 ID' })
  }
  const ids = new Set(data.categories.map(c => c.id))
  if (data.tasks.some(t => !ids.has(t.categoryId))) ctx.addIssue({ code: 'custom', message: '任务引用的分类不存在' })
})
export const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1)
export const snapshotSchema = z.strictObject({ revision: revisionSchema, categories: z.array(categorySchema), tasks: z.array(taskSchema), settings: settingsSchema }).superRefine((s, ctx) => {
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
export type Command = { type: 'saveCategory'; value: CategoryInput } | { type: 'saveTask'; value: TaskInput } | { type: 'restore'; value: Dataset }
export interface Operation { requestId: string; expectedRevision: number; command: Command }
export function businessData(snapshot: Snapshot): Dataset {
  return { categories: snapshot.categories, tasks: snapshot.tasks, settings: snapshot.settings }
}
export function validateCommand(command: Command): Command {
  if (command.type === 'saveCategory') return { ...command, value: categoryInputSchema.parse(command.value) }
  if (command.type === 'saveTask') return { ...command, value: taskInputSchema.parse(command.value) }
  return { type: 'restore', value: datasetSchema.parse(command.value) }
}
