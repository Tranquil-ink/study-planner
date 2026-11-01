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
