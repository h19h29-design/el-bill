import { describe, expect, it } from 'vitest'
import { parseStrictYear } from './calendar'

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
