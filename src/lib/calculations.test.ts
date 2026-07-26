import { describe, expect, it } from 'vitest'
import { defaultRatePlans, currentPlanId, recommendedPlanId } from '../data/ratePlans'
import { defaultScenario, sampleBills } from '../data/sampleBills'
import {
  calculateUsageHours,
  comparePlans,
  getRecentBills,
  getSeason,
} from './calculations'
import { getPeakRiskLevel, getPeakRatio } from './peak'
import type { MonthlyBill } from '../types'

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

describe('electricity calculation harness', () => {
  it('keeps recent 12 month data available for recommendation', () => {
    const recent = getRecentBills(sampleBills, 12)
    expect(recent).toHaveLength(12)
    expect(recent.at(-1)?.year).toBe(2025)
    expect(recent.at(-1)?.month).toBe(5)
  })

  it('requires consecutive calendar months before comparing plans', () => {
    const comparison = comparePlans(sampleBills, currentPlan, candidatePlan, defaultScenario)
    expect(comparison.currentAnnualWon).toBe(0)
    expect(comparison.candidateAnnualWon).toBe(0)
    expect(comparison.recommendation).toBe('추가 검토 필요')
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

  it('calculates usage hours from monthly usage and applied power', () => {
    const bill = sampleBills.find((item) => item.year === 2025 && item.month === 5)!
    expect(calculateUsageHours(bill)).toBeCloseTo(58.82, 1)
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
