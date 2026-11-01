import { z } from 'zod'
import { isBusinessDate, weekStart } from './calendar'
import { quantitySchema, quantityTicks } from './quantities'
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const date = z.string().refine(isBusinessDate, '日期不正确')
const minutes = z.number().int().min(1).max(2147483647)
const title = z.string().min(1).max(200).refine(v => !!v.trim(), '请填写名称')
const audit = { createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }) }
export const todoInputSchema = z.strictObject({ id: uuid, title, estimatedMinutes: minutes.nullable(), note: z.string().max(5000), archived: z.boolean() })
export const todoSchema = todoInputSchema.extend(audit).refine(v => Date.parse(v.updatedAt) >= Date.parse(v.createdAt))
export const availabilitySchema = z.array(z.strictObject({ day: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }).refine(v => v.endMinute > v.startMinute, '结束须晚于开始')).max(1000)
export const weekEntrySchema = z.strictObject({
  id: uuid, taskId: uuid.nullable(), todoId: uuid.nullable(), titleSnapshot: title,
  goalType: z.enum(['progress', 'time', 'todo']), estimatedMinutes: minutes,
  targetUnits: quantitySchema.nullable(), unitName: z.string().max(20),
  importance: z.enum(['normal', 'important', 'critical']), deadline: date.nullable(),
  carryToNextWeek: z.boolean(), cancelled: z.boolean(),
}).superRefine((v, ctx) => {
  if ((v.taskId === null) === (v.todoId === null) || (v.todoId !== null) !== (v.goalType === 'todo')) ctx.addIssue({ code: 'custom', message: '条目必须引用一个长期任务或一次性待办' })
  if (v.goalType === 'progress' && (v.targetUnits === null || !quantitySchema.safeParse(v.targetUnits).success || quantityTicks(v.targetUnits) === 0n)) ctx.addIssue({ code: 'custom', message: '进度型目标须填写正数新增量' })
  if (v.todoId !== null && (v.targetUnits !== null || v.unitName !== '')) ctx.addIssue({ code: 'custom', message: '一次性待办没有数值进度' })
  if (v.taskId !== null && !v.unitName.trim()) ctx.addIssue({ code: 'custom', message: '长期任务须保留进度单位' })
})
export const entriesSchema = z.array(weekEntrySchema).max(1000).superRefine((rows, ctx) => {
  if (new Set(rows.map(e => e.id)).size !== rows.length || new Set(rows.map(e => e.taskId ?? e.todoId)).size !== rows.length) ctx.addIssue({ code: 'custom', message: '同一任务在同一周只能有一条计划' })
})
export const weekDateSchema = date.refine(v => isBusinessDate(v) && weekStart(v) === v, '周起始须为周一')
export const weekInputSchema = z.strictObject({ weekStart: weekDateSchema, availability: availabilitySchema, entries: entriesSchema, confirm: z.boolean() })
const versionSchema = z.strictObject({ at: z.iso.datetime({ offset: true }), entries: entriesSchema, availability: availabilitySchema })
export const weekPlanSchema = z.strictObject({ weekStart: weekDateSchema, availability: availabilitySchema, entries: entriesSchema,
  confirmedAt: z.iso.datetime({ offset: true }).nullable(), initialEntries: entriesSchema.nullable(), history: z.array(versionSchema).min(1), ...audit,
}).superRefine((v, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: '周计划初始版本或调整历史不一致' })
  if (Date.parse(v.updatedAt) < Date.parse(v.createdAt) || (v.confirmedAt === null) !== (v.initialEntries === null)) fail()
  const last = v.history.at(-1)
  if (!last) { fail(); return }
  if (JSON.stringify(last.entries) !== JSON.stringify(v.entries) || JSON.stringify(last.availability) !== JSON.stringify(v.availability)) fail()
  if (v.history.some((h, i) => Date.parse(h.at) < Date.parse(v.createdAt) || Date.parse(h.at) > Date.parse(v.updatedAt) || (i > 0 && Date.parse(h.at) < Date.parse(v.history[i - 1].at)))) fail()
  if (v.confirmedAt && !v.history.some(h => h.at === v.confirmedAt && JSON.stringify(h.entries) === JSON.stringify(v.initialEntries))) fail()
  // Entry identity cannot silently be reassigned; removal is represented by cancellation.
  const identities = new Map<string, string>()
  let prior: string[] = []
  for (const h of v.history) {
    if (prior.some(id => !h.entries.some(e => e.id === id))) fail()
    for (const e of h.entries) {
      const identity = `${e.taskId}/${e.todoId}`
      if (identities.has(e.id) && identities.get(e.id) !== identity) fail()
      identities.set(e.id, identity)
    }
    prior = h.entries.map(e => e.id)
  }
})
export const planningFields = { todos: z.array(todoSchema), weekPlans: z.array(weekPlanSchema), availabilityTemplate: availabilitySchema }
export const emptyPlanning = () => ({ todos: [], weekPlans: [], availabilityTemplate: [] })
export type TodoInput = z.infer<typeof todoInputSchema>
export type WeekEntry = z.infer<typeof weekEntrySchema>
export type WeekInput = z.infer<typeof weekInputSchema>
export type WeekPlan = z.infer<typeof weekPlanSchema>
export type Availability = z.infer<typeof availabilitySchema>
