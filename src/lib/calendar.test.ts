import { describe, expect, it } from 'vitest'
import { parseStrictDay, parseStrictYear } from './calendar'

describe('strict standalone year parsing', () => {
  it.each([2026, '2026'])('accepts %s', (value) => {
    expect(parseStrictYear(value)).toBe(2026)
  })

  it.each([
    2026.5,
    1999,
    2101,
    '2.026e3',
    '+2026',
    '0x7ea',
    '002026',
    'x2026',
    '2026년',
    '２０２６',
  ])('rejects malformed standalone year %s', (value) => {
    expect(parseStrictYear(value)).toBeNull()
  })
})

describe('strict standalone day parsing', () => {
  it.each([1, 31, '1', '01', '31'])('accepts %s', (value) => {
    expect(parseStrictDay(value)).toBe(Number(value))
  })

  it.each([
    0,
    -1,
    1.5,
    32,
    '0',
    '-1',
    '1.5',
    '1e1',
    '+1',
    '0x1',
    '1일',
    'x1',
  ])('rejects malformed standalone day %s', (value) => {
    expect(parseStrictDay(value)).toBeNull()
  })
})
