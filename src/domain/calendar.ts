// Civil dates are never interpreted in the browser/server's local timezone.
export const BUSINESS_TIMEZONE = 'Asia/Shanghai'
export const SLOT_TEMPLATE_VERSION = 2
export const LEGACY_SLOTS = [
  { id: 1, band: '上午', startMinute: 480, endMinute: 540 },
  { id: 2, band: '上午', startMinute: 540, endMinute: 600 },
  { id: 3, band: '上午', startMinute: 600, endMinute: 660 },
  { id: 4, band: '上午', startMinute: 660, endMinute: 720 },
  { id: 5, band: '下午', startMinute: 780, endMinute: 840 },
  { id: 6, band: '下午', startMinute: 840, endMinute: 900 },
  { id: 7, band: '下午', startMinute: 900, endMinute: 960 },
  { id: 8, band: '下午', startMinute: 960, endMinute: 1020 },
  { id: 9, band: '晚间', startMinute: 1110, endMinute: 1215 },
  { id: 10, band: '晚间', startMinute: 1215, endMinute: 1320 },
] as const
export const SLOTS = [...LEGACY_SLOTS.slice(0, 8),
  { id: 9, band: '晚间', startMinute: 1110, endMinute: 1200 },
  { id: 10, band: '晚间', startMinute: 1200, endMinute: 1260 },
  { id: 11, band: '晚间', startMinute: 1260, endMinute: 1320 },
]
export function slotsFor(version: number) { return version === 1 ? LEGACY_SLOTS : version === 2 ? SLOTS : [] }
export function isBusinessDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const stamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
}
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function addDays(date: string, count: number): string {
  if (!isBusinessDate(date) || !Number.isInteger(count)) throw new Error('无效日期')
  const stamp = Date.parse(`${date}T00:00:00Z`) + count * 86400000
  const result = new Date(stamp).toISOString().slice(0, 10)
  if (!isBusinessDate(result)) throw new Error('日期超出 0001～9999 年范围')
  return result
}
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return addDays(date, -((weekday + 6) % 7))
}
export function weekDates(date: string): string[] {
  const first = weekStart(date)
  return Array.from({ length: 7 }, (_, n) => { try { return addDays(first, n) } catch { return null } }).filter((d): d is string => d !== null)
}
export function dateLabel(date: string): string {
  if (!isBusinessDate(date)) return '请选择有效日期'
  return `${date} 周${'日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()]}`
}
export function clockTime(minute: number): string { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` }
export function plannedMinutes(block: { startMinute: number; endMinute: number }): number { return block.endMinute - block.startMinute }
export function validSlotSnapshot(block: { slotTemplateVersion: number; slotIds: number[]; startMinute: number; endMinute: number }): boolean {
  const slots = block.slotIds.map(id => slotsFor(block.slotTemplateVersion).find(s => s.id === id))
  return slots.length > 0 && slots.every((s, i) => !!s && (i === 0 || slots[i - 1]?.endMinute === s.startMinute))
    && slots[0]?.startMinute === block.startMinute && slots.at(-1)?.endMinute === block.endMinute
}
export function overlaps(a: { date: string; startMinute: number; endMinute: number }, b: { date: string; startMinute: number; endMinute: number }) {
  return a.date === b.date && a.startMinute < b.endMinute && b.startMinute < a.endMinute
}
