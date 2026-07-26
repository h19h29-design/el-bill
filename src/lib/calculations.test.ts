import { describe, expect, it } from 'vitest'
import { defaultRatePlans, currentPlanId, recommendedPlanId } from '../data/ratePlans'
import { defaultScenario, sampleBills } from '../data/sampleBills'
import {
  calculateUsageHours,
  comparePlans,
  estimateBillForPlan,
  getDashboardSummary,
  getRecentBills,
  getSeason,
} from './calculations'
import { getPeakRiskLevel, getPeakRatio } from './peak'
import type { MonthlyBill } from '../types'
import {
  defaultCalculationSettings,
  validateCalculationSettings,
} from './calculationSettings'

const currentPlan = defaultRatePlans.find((plan) => plan.id === currentPlanId)!
const candidatePlan = defaultRatePlans.find((plan) => plan.id === recommendedPlanId)!

const calendarBill = (year: number, month: number): MonthlyBill => ({
  ...sampleBills[0],
  id: `${year}-${month}`,
  year,
  month,
})

const twelveConsecutiveBills = Array.from({ length: 12 }, (_, index) => {
  const monthIndex = 2025 * 12 + 7 + index
  return calendarBill(Math.floor(monthIndex / 12), (monthIndex % 12) + 1)
})
const consecutiveBills = (year: number, month: number, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const monthIndex = year * 12 + (month - 1) + index
    return calendarBill(Math.floor(monthIndex / 12), (monthIndex % 12) + 1)
  })

describe('electricity calculation harness', () => {
  it('builds dashboard usage and peak summaries without a second tariff comparison', () => {
    const summary = getDashboardSummary(
      twelveConsecutiveBills,
      defaultScenario,
    )

    expect(summary.latest).toBeTruthy()
    expect(summary.currentYearTotal).toBeGreaterThan(0)
    expect(summary).not.toHaveProperty('comparison')
  })

  it('preserves the prior tariff-full estimate with default correction settings', () => {
    expect(
      estimateBillForPlan(
        sampleBills[0],
        currentPlan,
        undefined,
        defaultCalculationSettings,
      ),
    ).toBe(9_345_913)
  })

  it.each([
    ['climateEnvironmentWonPerKwh', 10, 46_617],
    ['fuelAdjustmentWonPerKwh', -4, 46_617],
    ['vatPercent', 11, 82_198],
    ['fundPercent', 4.7, 82_198],
  ] as const)(
    'applies %s only to its tariff-full correction portion',
    (field, value, expectedIncreaseWon) => {
      const baseline = estimateBillForPlan(
        sampleBills[0],
        currentPlan,
        undefined,
        defaultCalculationSettings,
      )
      const changed = estimateBillForPlan(
        sampleBills[0],
        currentPlan,
        undefined,
        { ...defaultCalculationSettings, mode: 'tariffFull', [field]: value },
      )

      expect(changed - baseline).toBe(expectedIncreaseWon)
    },
  )

  it('validates finite and sensible calculation correction bounds', () => {
    expect(validateCalculationSettings(defaultCalculationSettings)).toEqual({
      valid: true,
      errors: {},
    })
    expect(
      validateCalculationSettings({
        ...defaultCalculationSettings,
        climateEnvironmentWonPerKwh: Number.NaN,
        fuelAdjustmentWonPerKwh: -101,
        vatPercent: 101,
        fundPercent: -1,
      }),
    ).toEqual({
      valid: false,
      errors: {
        climateEnvironmentWonPerKwh: expect.any(String),
        fuelAdjustmentWonPerKwh: expect.any(String),
        vatPercent: expect.any(String),
        fundPercent: expect.any(String),
      },
    })
  })

  it('calendar rollover selects the true recent 12 months', () => {
    const recent = getRecentBills([...sampleBills].reverse(), 12)
    expect(recent).toHaveLength(12)
    expect(recent[0]).toMatchObject({ year: 2025, month: 8 })
    expect(recent.at(-1)?.year).toBe(2026)
    expect(recent.at(-1)?.month).toBe(7)
  })

  it('compares synthetic data with consecutive calendar months', () => {
    const comparison = comparePlans(sampleBills, currentPlan, candidatePlan, defaultScenario)
    expect(comparison.currentAnnualWon).toBeGreaterThan(0)
    expect(comparison.candidateAnnualWon).toBeGreaterThan(0)
  })

  it('compares plans from 12 consecutive calendar months', () => {
    const comparison = comparePlans(
      twelveConsecutiveBills,
      currentPlan,
      candidatePlan,
      defaultScenario,
    )

    expect(comparison.currentAnnualWon).toBeGreaterThan(0)
    expect(comparison.candidateAnnualWon).toBeGreaterThan(0)
  })

  it('does not present a three-year estimate from gapped calendar periods', () => {
    const comparison = comparePlans(
      [...consecutiveBills(2022, 1, 24), ...consecutiveBills(2026, 1, 12)],
      currentPlan,
      candidatePlan,
      defaultScenario,
    )

    expect(comparison.currentAnnualWon).toBeGreaterThan(0)
    expect(comparison.threeYearSavingWon).toBe(0)
  })

  it('calculates usage hours from monthly usage and applied power', () => {
    const bill = sampleBills.find((item) => item.year === 2025 && item.month === 5)!
    expect(calculateUsageHours(bill)).toBeCloseTo(60.38, 1)
  })

  it('maps school peak scenario thresholds', () => {
    expect(getPeakRatio(500, 485)).toBeCloseTo(0.97)
    expect(getPeakRiskLevel(500, 485)).toBe('위험')
  })

  it('classifies seasonal billing months', () => {
    expect(getSeason(5)).toBe('springAutumn')
    expect(getSeason(7)).toBe('summer')
    expect(getSeason(1)).toBe('winter')
  })
})
