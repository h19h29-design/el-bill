import { describe, expect, it } from 'vitest'
import type { MonthlyBill } from '../types'
import { getCalendarMonthIndex, validateBillPeriods } from './billPeriods'

const bill = (year: number, month: number): MonthlyBill => ({
  id: `${year}-${month}`,
  year,
  month,
  usageKwh: 1_000,
  totalBillWon: 100_000,
  baseChargeWon: 10_000,
  energyChargeWon: 80_000,
  appliedPowerKw: 100,
  maxDemandKw: 90,
  powerFactorChargeWon: 0,
  climateChargeWon: 9_000,
  fuelAdjustmentWon: -5_000,
  vatWon: 9_000,
  fundWon: 3_000,
  note: 'test',
  observedFields: ['year', 'month', 'usageKwh', 'totalBillWon'],
})

describe('billing period validation', () => {
  it('orders December before the following January', () => {
    const result = validateBillPeriods([
      bill(2026, 1),
      bill(2025, 12),
    ])

    expect(result.normalizedBills.map(({ year, month }) => `${year}-${month}`)).toEqual([
      '2025-12',
      '2026-1',
    ])
  })

  it('does not count duplicate or gapped rows as 12 consecutive months', () => {
    const duplicate = Array.from({ length: 12 }, () => bill(2026, 1))
    const result = validateBillPeriods(duplicate, 12)

    expect(result.distinctMonthCount).toBe(0)
    expect(result.hasRequiredConsecutiveMonths).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate-period')
  })

  it('excludes every duplicate period independently of input order', () => {
    const duplicateFirst = { ...bill(2026, 2), id: 'duplicate-first', usageKwh: 1_000 }
    const duplicateSecond = { ...bill(2026, 2), id: 'duplicate-second', usageKwh: 9_999 }
    const unique = [bill(2026, 1), bill(2026, 3)]

    const firstOrder = validateBillPeriods([duplicateFirst, ...unique, duplicateSecond])
    const swappedOrder = validateBillPeriods([duplicateSecond, ...unique, duplicateFirst])

    expect(firstOrder.normalizedBills).toEqual(unique)
    expect(swappedOrder.normalizedBills).toEqual(unique)
    expect(firstOrder.issues).toEqual(swappedOrder.issues)
    expect(firstOrder.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate-period', period: '2026-2' }),
    )
  })

  it('reports invalid periods and omits them from normalized bills', () => {
    const result = validateBillPeriods([bill(2026, 0), bill(2026, 13)])

    expect(result.normalizedBills).toEqual([])
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'invalid-period',
      'invalid-period',
    ])
  })

  it('uses calendar month indexes and finds the most recent contiguous run', () => {
    const result = validateBillPeriods(
      [bill(2025, 12), bill(2026, 2), bill(2026, 3), bill(2026, 4)],
      3,
    )

    expect(getCalendarMonthIndex(2025, 12)).toBeLessThan(
      getCalendarMonthIndex(2026, 1),
    )
    expect(result.recentConsecutiveBills.map(({ month }) => month)).toEqual([2, 3, 4])
    expect(result.hasRequiredConsecutiveMonths).toBe(true)
    expect(result.issues.map((issue) => issue.code)).toContain('missing-period')
  })

  it('reports a multi-year gap without allocating an issue for every absent month', () => {
    const result = validateBillPeriods([bill(2000, 1), bill(2400, 1)])

    expect(result.issues.filter((issue) => issue.code === 'missing-period')).toHaveLength(1)
    expect(result.hasRequiredConsecutiveMonths).toBe(false)
  })
})
