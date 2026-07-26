import { describe, expect, it } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from '../data/sampleBills'
import {
  findUniqueRatePlanById,
  normalizePeakScenario,
  validateMonthlyBill,
  validateRatePlan,
  validateRatePlanCollection,
  validateSchoolProfile,
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

describe('school profile domain validation', () => {
  it.each([
    ['empty school name', { schoolName: '' }],
    ['empty display name', { displaySchoolName: ' ' }],
    ['empty contract type', { contractType: '' }],
    ['zero contract power', { contractPowerKw: 0 }],
    ['negative contract power', { contractPowerKw: -1 }],
    ['NaN applied power', { appliedPowerKw: Number.NaN }],
    ['infinite applied power', { appliedPowerKw: Number.POSITIVE_INFINITY }],
    ['extreme contract power', { contractPowerKw: 10_000_001 }],
    ['applied power over contract', { appliedPowerKw: 901 }],
  ])('rejects %s', (_label, patch) => {
    expect(
      validateSchoolProfile({ ...defaultSchoolProfile, ...patch }).valid,
    ).toBe(false)
  })
})

describe('peak scenario domain normalization', () => {
  it.each([
    ['zero target', { targetPeakKw: 0 }],
    ['negative expected', { expectedPeakKw: -1 }],
    ['NaN percent', { usageIncreasePercent: Number.NaN }],
    ['out-of-range percent', { summerIncreasePercent: 101 }],
    ['fractional year', { analysisYear: 2025.5 }],
  ])('rejects invalid required field %s', (_label, patch) => {
    expect(
      normalizePeakScenario({ ...defaultScenario, ...patch }).scenario,
    ).toBeNull()
  })

  it('normalizes restored EHP groups to the same safe values used by planning', () => {
    const normalized = normalizePeakScenario({
      ...defaultScenario,
      mainBuildingEhpGroups: 1_000_000_000,
      annexEhpGroups: 0,
    })

    expect(normalized.scenario).toMatchObject({
      mainBuildingEhpGroups: 100,
      annexEhpGroups: 2,
    })
    expect(normalized.changed).toBe(true)
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

  it('rejects duplicate normalized identifiers and contract tuples', () => {
    const sameId = {
      ...defaultRatePlans[1],
      id: ` ${defaultRatePlans[0].id.toUpperCase()} `,
    }
    const sameTuple = {
      ...defaultRatePlans[1],
      id: 'unique-id',
      contractType: ` ${defaultRatePlans[0].contractType} `,
      voltageType: defaultRatePlans[0].voltageType,
      planName: ` ${defaultRatePlans[0].planName} `,
    }

    expect(
      validateRatePlanCollection([defaultRatePlans[0], sameId]).issues.join(' '),
    ).toContain('식별값')
    expect(
      validateRatePlanCollection([defaultRatePlans[0], sameTuple]).issues.join(
        ' ',
      ),
    ).toContain('계약종별')
  })

  it('does not resolve an ambiguous rate-plan identifier', () => {
    const duplicated = [
      defaultRatePlans[0],
      { ...defaultRatePlans[1], id: defaultRatePlans[0].id },
    ]

    expect(findUniqueRatePlanById(duplicated, defaultRatePlans[0].id)).toBeNull()
  })
})
