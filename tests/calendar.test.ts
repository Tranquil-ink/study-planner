import { describe, expect, it } from 'vitest'
import { shiftDate, isBusinessDate, today, weekDates, weekStart, parseHours, hoursInput } from '../src/domain/calendar'

describe('日历日期与分钟', () => {
  it('中国日界不依赖设备时区，跨年与闰日保持业务日期', () => {
    expect(today(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12-31')
    expect(today(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftDate('2024-02-29', 1)).toBe('2024-03-01')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(weekStart('2027-01-03')).toBe('2026-12-28')
    expect(weekDates('2026-11-01')).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01'])
    expect(weekStart('0001-01-01')).toBe('0001-01-01')
    expect(weekDates('9999-12-31').at(-1)).toBe('9999-12-31')
    expect(shiftDate('9999-12-31', 1)).toBeNull()
  })
  it.each(['2026-02-29','2024-02-30','2026-13-01','0000-01-01','2026-1-1','2026-10-20T00:00:00Z'])('拒绝无效业务日期 %s', date => expect(isBusinessDate(date)).toBe(false))
  it('小时输入接收半小时和 h 后缀，整分钟的历史时长可无损回填', () => {
    expect(parseHours('2.5h')).toBe(150)
    expect(parseHours('.5')).toBe(30)
    expect(parseHours(hoursInput(91))).toBe(91)
    expect(parseHours('1:60')).toBeNull()
    expect(parseHours('0.001')).toBeNull()
  })
})
