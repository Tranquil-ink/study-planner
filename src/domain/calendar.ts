// Dates are civil days in Shanghai. Date arithmetic uses UTC to keep day lengths fixed.
export const BUSINESS_TIMEZONE = 'Asia/Shanghai'
export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function isBusinessDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const stamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
}

export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function shiftDate(date: string, days: number): string | null {
  const stamp = Date.parse(`${date}T00:00:00Z`) + days * 86400000
  if (!isBusinessDate(date) || !Number.isInteger(days) || !Number.isFinite(stamp)) return null
  const next = new Date(stamp)
  if (!Number.isFinite(next.getTime())) return null
  const result = next.toISOString().slice(0, 10)
  return isBusinessDate(result) ? result : null
}

export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function weekStart(date: string): string {
  return shiftDate(date, -weekdayIndex(date)) ?? date
}

export function weekDates(date: string): string[] {
  const first = weekStart(date)
  return Array.from({ length: 7 }, (_, n) => shiftDate(first, n)).filter((d): d is string => d !== null)
}

export function dateLabel(date: string): string {
  return `${date} ${WEEKDAYS[weekdayIndex(date)]}`
}

export function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
}

export function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ''}` : `${rest} 分钟`
}

export function hoursInput(minutes: number): string {
  if (minutes % 3 === 0) return String(minutes / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export function parseHours(value: string): number | null {
  const text = value.trim().replace(/h$/i, '').trimEnd()
  const clock = /^(\d{1,8}):([0-5]\d)$/.exec(text)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  if (!/^(?:\d{1,8}(?:\.\d{0,4})?|\.\d{1,4})$/.test(text)) return null
  const minutes = Number(text) * 60
  const rounded = Math.round(minutes)
  return Math.abs(rounded - minutes) < 1e-7 ? rounded : null
}

export function hoursLabel(minutes: number): string {
  const value = hoursInput(minutes)
  return value.includes(':') ? value : `${value} h`
}

export function sumMinutes<T>(rows: T[], minutes: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + minutes(row), 0)
}
