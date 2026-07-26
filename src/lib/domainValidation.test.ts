import { describe, expect, it } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import { sampleBills } from '../data/sampleBills'
import {
  validateMonthlyBill,
  validateRatePlan,
} from './domainValidation'

describe('monthly bill domain validation', () => {
  const bill = sampleBills[0]

  it.each([
    ['NaN usage', { usageKwh: Number.NaN }],
    ['infinite usage', { usageKwh: Number.POSITIVE_INFINITY }],
    ['negative usage', { usageKwh: -1 }],
    ['zero usage', { usageKwh: 0 }],
    ['negative total', { totalBillWon: -1 }],
    ['zero total', { totalBillWon: 0 }],
    ['invalid month', { month: 13 }],
    ['zero applied power', { appliedPowerKw: 0 }],
    ['negative demand', { maxDemandKw: -1 }],
    ['negative base charge', { baseChargeWon: -1 }],
    ['negative energy charge', { energyChargeWon: -1 }],
    ['negative climate charge', { climateChargeWon: -1 }],
    ['negative VAT', { vatWon: -1 }],
    ['negative fund', { fundWon: -1 }],
  ])('rejects %s', (_label, patch) => {
    expect(validateMonthlyBill({ ...bill, ...patch }).valid).toBe(false)
  })

  it('allows bounded negative fuel and power-factor adjustments', () => {
    expect(
      validateMonthlyBill({
        ...bill,
        fuelAdjustmentWon: -50_000,
        powerFactorChargeWon: -10_000,
      }).valid,
    ).toBe(true)
  })

  it('rejects unknown observed fields', () => {
    expect(
      validateMonthlyBill({
        ...bill,
        observedFields: [...bill.observedFields, 'unknown-field'],
      }).valid,
    ).toBe(false)
  })
})

describe('rate plan domain validation', () => {
  const plan = defaultRatePlans[0]

  it.each([
    ['empty id', { id: '' }],
    ['empty contract type', { contractType: ' ' }],
    ['zero base rate', { baseRateWonPerKw: 0 }],
    ['negative base rate', { baseRateWonPerKw: -1 }],
    ['infinite base rate', { baseRateWonPerKw: Number.POSITIVE_INFINITY }],
    ['invalid effective date', { effectiveFrom: '2026-02-31' }],
    ['negative optional load rate', { lightLoadRate: -1 }],
  ])('rejects %s', (_label, patch) => {
    expect(validateRatePlan({ ...plan, ...patch }).valid).toBe(false)
  })

  it('accepts zero optional load rates and valid positive tariffs', () => {
    expect(validateRatePlan({ ...plan, lightLoadRate: 0 }).valid).toBe(true)
  })
})
