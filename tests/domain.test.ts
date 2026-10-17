import { describe, expect, it } from 'vitest'
import { datasetSchema, quantityTicks, taskInputSchema } from '../src/domain/model'
import { createBackup, parseBackup } from '../src/data/backup'
import { fixtureData, task } from './fixtures'

describe('精确进度与备份边界', () => {
  it('小数精确比较，位置文字不会参与计算', () => {
    expect(quantityTicks('0.1') + quantityTicks('0.2')).toBe(quantityTicks('0.3'))
    expect(taskInputSchema.parse(task).initialProgressLabel).toBe('2.1.1')
    expect(taskInputSchema.safeParse({ ...task, initialCompletedUnits: '40.000001' }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, totalUnits: null }).success).toBe(true)
  })
  it.each(['NaN', 'Infinity', '-1', '1e3', '1.1234567', '1000000000', '2.1.1', ' 1', '01'])('拒绝非法或不精确数量 %s', value => { expect(() => quantityTicks(value)).toThrow() })
  it('完整往返包含归档与设置，不携带身份或内部状态', () => {
    const data = fixtureData(); data.tasks[0].archived = true
    const backup = createBackup({ ...data, revision: 9 })
    expect(parseBackup(JSON.stringify(backup)).backup.data).toEqual(data)
    expect(backup).not.toHaveProperty('owner_id')
    expect(backup.data).not.toHaveProperty('receipts')
  })
  it('拒绝重复 ID、悬空引用、额外实体和未授权字段', () => {
    const data = fixtureData()
    expect(datasetSchema.safeParse({ ...data, categories: [...data.categories, ...data.categories] }).success).toBe(false)
    expect(datasetSchema.safeParse({ ...data, categories: [] }).success).toBe(false)
    expect(datasetSchema.safeParse({ ...data, workLogs: [] }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, owner_id: 'forged' }).success).toBe(false)
  })
  it('拒绝无效 JSON、未来版本与无效时间', () => {
    expect(() => parseBackup('{')).toThrow('有效 JSON')
    expect(() => parseBackup('{"schemaVersion":999}')).toThrow('不支持')
    const backup = createBackup({ ...fixtureData(), revision: 0 })
    backup.exportedAt = '2026-02-30T00:00:00Z'
    expect(() => parseBackup(JSON.stringify(backup))).toThrow()
  })
  it('约定旧格式映射保留 ID、分类、位置和数值；未知格式拒绝', () => {
    const data = fixtureData()
    const old = { format: 'study-planner-local', schemaVersion: 0, appVersion: '0.0.0', exportedAt: '2026-10-17T00:00:00Z', data: { ...data, tasks: [{ ...data.tasks[0], totalUnits: 40, initialCompletedUnits: 8.5 }] } }
    const result = parseBackup(JSON.stringify(old))
    expect(result.migrated).toBe(true)
    expect(result.backup.data.tasks[0]).toEqual({ ...data.tasks[0], initialCompletedUnits: '8.5' })
    expect(() => parseBackup(JSON.stringify({ ...old, format: 'unknown' }))).toThrow()
  })
})
