import { describe, expect, it } from 'vitest'
import type { MonthlyBill, MonthlyBillObservedField, RatePlan } from '../types'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../data/sampleBills'
import { defaultRatePlans } from '../data/ratePlans'
import {
  assessDataConfidence,
  buildAutoDiagnosis,
  comparePlansForDiagnosis,
  findExactRatePlan,
  getDataRecognitionRate,
  resolveCurrentPlan,
  summarizeWorkbookRecognition,
} from './diagnosis'
import { defaultCalculationSettings } from './calculationSettings'

const makePlan = (
  id: string,
  planName: string,
  baseRateWonPerKw: number,
  rate: number,
): RatePlan => ({
  id,
  contractType: '교육용(갑)',
  voltageType: '고압A',
  planName,
  baseRateWonPerKw,
  seasonRates: {
    springAutumn: rate,
    summer: rate,
    winter: rate,
  },
  effectiveFrom: '2026-01-01',
  memo: '테스트',
})

const makeBill = (month: number): MonthlyBill => ({
  id: `bill-${month}`,
  year: 2026,
  month,
  usageKwh: 10_000,
  totalBillWon: 1_500_000,
  baseChargeWon: 500_000,
  energyChargeWon: 800_000,
  appliedPowerKw: 500,
  maxDemandKw: 480,
  powerFactorChargeWon: 0,
  climateChargeWon: 90_000,
  fuelAdjustmentWon: -50_000,
  vatWon: 130_000,
  fundWon: 48_000,
  note: '테스트',
  observedFields: [
    'year',
    'month',
    'usageKwh',
    'totalBillWon',
    'appliedPowerKw',
    'maxDemandKw',
    'baseChargeWon',
    'energyChargeWon',
    'powerFactorChargeWon',
    'climateChargeWon',
    'fuelAdjustmentWon',
    'vatWon',
    'fundWon',
  ],
})

const twelveBills = Array.from({ length: 12 }, (_, index) => makeBill(index + 1))
const thirtySixConsecutiveBills = Array.from({ length: 36 }, (_, index) => {
  const monthIndex = 2024 * 12 + index
  const year = Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  return { ...makeBill(month), id: `bill-${year}-${month}`, year }
})
const consecutiveBills = (year: number, month: number, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const monthIndex = year * 12 + (month - 1) + index
    const billYear = Math.floor(monthIndex / 12)
    const billMonth = (monthIndex % 12) + 1
    return { ...makeBill(billMonth), id: `bill-${billYear}-${billMonth}`, year: billYear }
  })
const currentPlan = makePlan('current', '선택요금Ⅱ', 1000, 100)
const cheaperPlan = makePlan('cheap', '선택요금Ⅰ', 500, 80)
const expensivePlan = makePlan('expensive', '고비용요금', 2000, 160)
const zeroGrowthScenario = {
  ...defaultScenario,
  expectedPeakKw: 500,
  usageIncreasePercent: 0,
  summerIncreasePercent: 0,
  winterIncreasePercent: 0,
}
const exactBill = (
  year: number,
  month: number,
  overrides: Partial<MonthlyBill> = {},
): MonthlyBill => ({
  ...makeBill(month),
  id: `exact-${year}-${month}`,
  year,
  totalBillWon: 1_650_000,
  baseChargeWon: 500_000,
  energyChargeWon: 1_000_000,
  climateChargeWon: 50_000,
  fuelAdjustmentWon: 0,
  vatWon: 100_000,
  fundWon: 0,
  ...overrides,
})
const exactTwelveBills = Array.from({ length: 12 }, (_, index) =>
  exactBill(2026, index + 1),
)

describe('automatic diagnosis harness', () => {
  it('resolves Unicode-equivalent profile and tariff tuple text', () => {
    const plan = makePlan('unicode-plan', '선택요금I', 1_000, 100)
    const profile = {
      ...defaultSchoolProfile,
      contractType: ' 교 육 용 ( 갑 ) '.normalize('NFD'),
      voltageType: '고압Ａ'.normalize('NFD'),
      currentPlan: '선택요금Ⅰ'.normalize('NFD'),
    }

    expect(resolveCurrentPlan(profile, [plan])).toMatchObject({
      exact: true,
      plan,
    })
  })

  it.each([
    [1, false, false, false],
    [11, false, false, false],
    [12, true, false, true],
    [35, true, false, true],
    [36, true, true, true],
  ] as const)(
    'exposes availability semantics for %i consecutive months',
    (monthCount, annualAvailable, threeYearAvailable, peakAvailable) => {
      const comparison = comparePlansForDiagnosis(
        consecutiveBills(2023, 1, monthCount),
        currentPlan,
        cheaperPlan,
        zeroGrowthScenario,
        defaultCalculationSettings,
      )

      expect(comparison.annualDataAvailable).toBe(annualAvailable)
      expect(comparison.threeYearDataAvailable).toBe(threeYearAvailable)
      expect(comparison.peakScenarioDataAvailable).toBe(peakAvailable)
      if (!annualAvailable) {
        expect(comparison.currentAnnualWon).toBe(0)
        expect(comparison.candidateAnnualWon).toBe(0)
        expect(comparison.savingWon).toBe(0)
        expect(comparison.calculationBreakdown).toEqual([])
      }
      if (!threeYearAvailable) {
        expect(comparison.currentThreeYearWon).toBe(0)
        expect(comparison.candidateThreeYearWon).toBe(0)
        expect(comparison.threeYearSavingWon).toBe(0)
      }
      if (!peakAvailable) {
        expect(comparison.peakScenarioCurrentAnnualWon).toBe(0)
        expect(comparison.peakScenarioCandidateAnnualWon).toBe(0)
        expect(comparison.peakScenarioSavingWon).toBe(0)
      }
    },
  )

  it('requires a valid scenario before exposing peak results', () => {
    const comparison = comparePlansForDiagnosis(
      exactTwelveBills,
      currentPlan,
      cheaperPlan,
      { ...zeroGrowthScenario, expectedPeakKw: 0 },
      defaultCalculationSettings,
    )

    expect(comparison.annualDataAvailable).toBe(true)
    expect(comparison.peakScenarioDataAvailable).toBe(false)
    expect(comparison.peakScenarioCurrentAnnualWon).toBe(0)
    expect(comparison.peakScenarioCandidateAnnualWon).toBe(0)
    expect(comparison.peakScenarioSavingWon).toBe(0)
  })

  it('uses actual uploaded totals exactly for bill-delta baseline current totals', () => {
    const comparison = comparePlansForDiagnosis(
      exactTwelveBills,
      currentPlan,
      cheaperPlan,
      zeroGrowthScenario,
      defaultCalculationSettings,
    )

    expect(comparison.currentAnnualWon).toBe(19_800_000)
  })

  it('uses actual uploaded totals exactly across 36 bill-delta months', () => {
    const bills = consecutiveBills(2023, 1, 36).map((bill, index) => ({
      ...exactBill(bill.year, bill.month),
      totalBillWon: 1_000_000 + index,
    }))
    const comparison = comparePlansForDiagnosis(
      bills,
      currentPlan,
      cheaperPlan,
      zeroGrowthScenario,
      defaultCalculationSettings,
    )

    expect(comparison.currentThreeYearWon).toBe(
      bills.reduce((sum, bill) => sum + bill.totalBillWon, 0),
    )
  })

  it('applies peak billing-power increase to current and candidate without double counting', () => {
    const comparison = comparePlansForDiagnosis(
      exactTwelveBills,
      currentPlan,
      cheaperPlan,
      { ...zeroGrowthScenario, expectedPeakKw: 600 },
      defaultCalculationSettings,
    )

    expect(comparison.peakScenarioCurrentAnnualWon).toBe(1_760_000 * 12)
    expect(comparison.peakScenarioCandidateAnnualWon).toBe(1_210_000 * 12)
  })

  it('applies usage increase to current and candidate from the same scenario basis', () => {
    const comparison = comparePlansForDiagnosis(
      exactTwelveBills,
      currentPlan,
      cheaperPlan,
      {
        ...zeroGrowthScenario,
        usageIncreasePercent: 10,
        summerIncreasePercent: 10,
        winterIncreasePercent: 10,
      },
      defaultCalculationSettings,
    )

    expect(comparison.peakScenarioCurrentAnnualWon).toBe(1_760_000 * 12)
    expect(comparison.peakScenarioCandidateAnnualWon).toBe(1_243_000 * 12)
  })

  it('uses rate-derived fallbacks when optional base and energy components are missing', () => {
    const bills = exactTwelveBills.map((bill) => ({
      ...bill,
      totalBillWon: 1_500_000,
      baseChargeWon: 0,
      energyChargeWon: 0,
      climateChargeWon: 0,
      vatWon: 0,
      observedFields: bill.observedFields.filter(
        (field) => field !== 'baseChargeWon' && field !== 'energyChargeWon',
      ),
    }))
    const comparison = comparePlansForDiagnosis(
      bills,
      currentPlan,
      cheaperPlan,
      {
        ...zeroGrowthScenario,
        expectedPeakKw: 600,
        usageIncreasePercent: 10,
        summerIncreasePercent: 10,
        winterIncreasePercent: 10,
      },
      defaultCalculationSettings,
    )

    expect(comparison.peakScenarioCurrentAnnualWon).toBe(1_700_000 * 12)
    expect(comparison.peakScenarioCandidateAnnualWon).toBe(1_180_000 * 12)
  })

  it.each([
    {
      label: 'all optional adjustment columns absent',
      overrides: {
        climateChargeWon: 0,
        fuelAdjustmentWon: 0,
        vatWon: 0,
        fundWon: 0,
        powerFactorChargeWon: 0,
        observedFields: [
          'year',
          'month',
          'usageKwh',
          'totalBillWon',
          'appliedPowerKw',
          'baseChargeWon',
          'energyChargeWon',
        ] as MonthlyBillObservedField[],
      },
      expectedBaseline: 1_650_000,
      expectedPeakCurrent: 1_760_000,
      expectedPeakCandidate: 1_210_000,
    },
    {
      label: 'only a partial adjustment column present',
      overrides: {
        climateChargeWon: 50_000,
        fuelAdjustmentWon: 0,
        vatWon: 0,
        fundWon: 0,
        powerFactorChargeWon: 0,
        observedFields: [
          'year',
          'month',
          'usageKwh',
          'totalBillWon',
          'appliedPowerKw',
          'baseChargeWon',
          'energyChargeWon',
          'climateChargeWon',
        ] as MonthlyBillObservedField[],
      },
      expectedBaseline: 1_650_000,
      expectedPeakCurrent: 1_760_000,
      expectedPeakCandidate: 1_210_000,
    },
    {
      label: 'negative fuel adjustment present',
      overrides: {
        climateChargeWon: 90_000,
        fuelAdjustmentWon: -40_000,
        vatWon: 0,
        fundWon: 0,
        powerFactorChargeWon: 0,
      },
      expectedBaseline: 1_650_000,
      expectedPeakCurrent: 1_760_000,
      expectedPeakCandidate: 1_210_000,
    },
    {
      label: 'actual total contains a larger residual',
      overrides: {
        totalBillWon: 1_800_000,
        climateChargeWon: 0,
        fuelAdjustmentWon: 0,
        vatWon: 0,
        fundWon: 0,
        powerFactorChargeWon: 0,
      },
      expectedBaseline: 1_800_000,
      expectedPeakCurrent: 1_920_000,
      expectedPeakCandidate: 1_320_000,
    },
  ])(
    'preserves the actual-bill residual when $label',
    ({
      overrides,
      expectedBaseline,
      expectedPeakCurrent,
      expectedPeakCandidate,
    }) => {
      const bills = exactTwelveBills.map((bill) => ({
        ...bill,
        ...overrides,
      }))
      const comparison = comparePlansForDiagnosis(
        bills,
        currentPlan,
        cheaperPlan,
        { ...zeroGrowthScenario, expectedPeakKw: 600 },
        defaultCalculationSettings,
      )

      expect(comparison.currentAnnualWon).toBe(expectedBaseline * 12)
      expect(comparison.peakScenarioCurrentAnnualWon).toBe(
        expectedPeakCurrent * 12,
      )
      expect(comparison.peakScenarioCandidateAnnualWon).toBe(
        expectedPeakCandidate * 12,
      )
    },
  )

  it.each([
    {
      label: 'positive residual',
      totalBillWon: 3_000_000,
      expectedPeakCurrent: 3_135_000,
      expectedPeakCandidate: 2_460_000,
    },
    {
      label: 'negative residual',
      totalBillWon: 500_000,
      expectedPeakCurrent: 580_000,
      expectedPeakCandidate: 180_000,
    },
  ])(
    'clamps an extreme $label before applying bill-delta component changes',
    ({
      totalBillWon,
      expectedPeakCurrent,
      expectedPeakCandidate,
    }) => {
      const bills = exactTwelveBills.map((bill) => ({
        ...bill,
        totalBillWon,
        climateChargeWon: 0,
        fuelAdjustmentWon: 0,
        vatWon: 0,
        fundWon: 0,
        powerFactorChargeWon: 0,
      }))
      const comparison = comparePlansForDiagnosis(
        bills,
        currentPlan,
        cheaperPlan,
        { ...zeroGrowthScenario, expectedPeakKw: 600 },
        defaultCalculationSettings,
      )

      expect(comparison.currentAnnualWon).toBe(totalBillWon * 12)
      expect(comparison.peakScenarioCurrentAnnualWon).toBe(
        expectedPeakCurrent * 12,
      )
      expect(comparison.peakScenarioCandidateAnnualWon).toBe(
        expectedPeakCandidate * 12,
      )
    },
  )

  it('applies the baseline candidate component delta once from the actual bill', () => {
    const comparison = comparePlansForDiagnosis(
      exactTwelveBills,
      currentPlan,
      cheaperPlan,
      zeroGrowthScenario,
      defaultCalculationSettings,
    )

    expect(comparison.candidateAnnualWon).toBe(1_155_000 * 12)
  })

  it('ignores tariff-full correction factors in bill-delta mode', () => {
    const baseline = comparePlansForDiagnosis(
      thirtySixConsecutiveBills,
      currentPlan,
      cheaperPlan,
      defaultScenario,
      { ...defaultCalculationSettings, mode: 'billDelta' },
    )
    const changed = comparePlansForDiagnosis(
      thirtySixConsecutiveBills,
      currentPlan,
      cheaperPlan,
      defaultScenario,
      {
        mode: 'billDelta',
        climateEnvironmentWonPerKwh: 50,
        fuelAdjustmentWonPerKwh: 50,
        vatPercent: 50,
        fundPercent: 50,
      },
    )

    expect(changed).toEqual(baseline)
  })

  it('uses one selected calculation settings instance for every diagnosis result', () => {
    const calculationSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
      climateEnvironmentWonPerKwh: 10,
      fuelAdjustmentWonPerKwh: -4,
      vatPercent: 11,
      fundPercent: 4,
    }
    const diagnosis = buildAutoDiagnosis({
      bills: thirtySixConsecutiveBills,
      profile: {
        ...defaultSchoolProfile,
        contractType: currentPlan.contractType,
        voltageType: currentPlan.voltageType,
        currentPlan: currentPlan.planName,
      },
      ratePlans: [currentPlan, cheaperPlan, expensivePlan],
      scenario: defaultScenario,
      calculationSettings,
    })

    expect(diagnosis.calculationSettings).toBe(calculationSettings)
    expect(diagnosis.calculationMode).toBe('tariffFull')
    expect(
      diagnosis.topCandidates.every(
        (candidate) => candidate.calculationMode === 'tariffFull',
      ),
    ).toBe(true)
    expect(diagnosis.comparison.calculationMode).toBe('tariffFull')
  })


  it.each([1, 11])(
    'withholds every recommendation for %i consecutive month(s)',
    (monthCount) => {
      const diagnosis = buildAutoDiagnosis({
        bills: sampleBills.slice(-monthCount),
        profile: defaultSchoolProfile,
        ratePlans: defaultRatePlans,
        scenario: defaultScenario,
        calculationSettings: defaultCalculationSettings,
      })

      expect(diagnosis.finalJudgement).toBe('추가 검토 필요')
      expect(diagnosis.completed).toBe(false)
      expect(diagnosis.recommendedPlan).toBeNull()
      expect(diagnosis.topCandidates.length).toBeGreaterThan(0)
      expect(
        diagnosis.topCandidates.every(
          (candidate) =>
            candidate.recommendation === '추가 검토 필요' &&
            candidate.reviewReason.includes('12개월'),
        ),
      ).toBe(true)
      expect(diagnosis.canGenerateChangeDocuments).toBe(false)
    },
  )

  it('recommends change when 12-month and 3-year estimates both save money', () => {
    const comparison = comparePlansForDiagnosis(
      thirtySixConsecutiveBills,
      currentPlan,
      cheaperPlan,
      defaultScenario,
      defaultCalculationSettings,
    )

    expect(comparison.savingWon).toBeGreaterThan(0)
    expect(comparison.currentThreeYearWon).toBeGreaterThan(0)
    expect(comparison.candidateThreeYearWon).toBeGreaterThan(0)
    expect(comparison.threeYearSavingWon).toBe(
      comparison.currentThreeYearWon - comparison.candidateThreeYearWon,
    )
    expect(comparison.threeYearSavingWon).toBeGreaterThan(0)
    expect(comparison.recommendation).toBe('변경 추천')
  })

  it('does not count inferred demand values as complete data', () => {
    const inferredDemandBills = thirtySixConsecutiveBills.map((bill) => ({
      ...bill,
      observedFields: [
        'year',
        'month',
        'usageKwh',
        'totalBillWon',
      ] as MonthlyBillObservedField[],
    }))

    expect(assessDataConfidence(inferredDemandBills)).toBe('보통')
    expect(getDataRecognitionRate(inferredDemandBills)).toBe(67)
  })

  it('safely diagnoses persisted rows from before observed-field provenance', () => {
    const legacyBills = sampleBills.map(({ observedFields: _observedFields, ...bill }) => bill) as unknown as MonthlyBill[]
    const diagnosis = buildAutoDiagnosis({
      bills: legacyBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    expect(diagnosis.dataConfidence).toBe('보통')
    expect(diagnosis.dataRecognitionRate).toBe(67)
  })

  it('does not choose a different plan when the active profile has no exact rate-plan match', () => {
    expect(
      findExactRatePlan(
        { ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' },
        defaultRatePlans,
      ),
    ).toBeNull()
  })

  it('reports an inexact current-plan resolver result without a fallback plan', () => {
    const resolution = resolveCurrentPlan(
      { ...defaultSchoolProfile, currentPlan: '오타 요금제' },
      defaultRatePlans,
    )

    expect(resolution.exact).toBe(false)
    expect(resolution.plan).toBeNull()
    expect(resolution.issue).toBe('현재 요금제를 요금표에서 확인해 주세요.')
  })

  it('blocks diagnosis when the current-plan tuple is duplicated', () => {
    const duplicateCurrentPlan = { ...currentPlan, id: 'duplicate-current' }
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }
    const resolution = resolveCurrentPlan(profile, [currentPlan, duplicateCurrentPlan, cheaperPlan])
    const diagnosis = buildAutoDiagnosis({
      bills: twelveBills,
      profile,
      ratePlans: [currentPlan, duplicateCurrentPlan, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(resolution.exact).toBe(false)
    expect(resolution.plan).toBeNull()
    expect(resolution.issue).toContain('중복')
    expect(diagnosis.configurationRequired).toBe(true)
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
  })

  it('blocks diagnosis and documents when different plans share an identifier', () => {
    const duplicateIdCandidate = {
      ...cheaperPlan,
      id: currentPlan.id,
      planName: '다른 이름의 후보',
    }
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }

    const diagnosis = buildAutoDiagnosis({
      bills: thirtySixConsecutiveBills,
      profile,
      ratePlans: [currentPlan, duplicateIdCandidate],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(diagnosis.completed).toBe(false)
    expect(diagnosis.configurationRequired).toBe(true)
    expect(diagnosis.currentPlan).toBeNull()
    expect(diagnosis.recommendedPlan).toBeNull()
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
    expect(diagnosis.documentBlockReason).toContain('요금제')
  })

  it('unknown current plan blocks diagnosis', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: { ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' },
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    expect(diagnosis.configurationRequired).toBe(true)
    expect(diagnosis.currentPlan).toBeNull()
    expect(diagnosis.recommendedPlan).toBeNull()
    expect(diagnosis.completed).toBe(false)
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
    expect(diagnosis.documentBlockReason).toContain('요금제 설정')
    expect(diagnosis.comparison.savingWon).toBe(0)
    expect(diagnosis.missingDataNotes).toContain('현재 요금제를 요금표에서 확인해 주세요.')
  })

  it('blocks diagnosis and documents when every uploaded bill has negative usage', () => {
    const invalidBills = thirtySixConsecutiveBills.map((bill) => ({
      ...bill,
      usageKwh: -bill.usageKwh,
    }))
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }

    const diagnosis = buildAutoDiagnosis({
      bills: invalidBills,
      profile,
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(diagnosis.completed).toBe(false)
    expect(diagnosis.finalJudgement).toBe('추가 검토 필요')
    expect(diagnosis.recommendedPlan).toBeNull()
    expect(diagnosis.topCandidates).toEqual([])
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
    expect(diagnosis.documentBlockReason).toContain('고지서')
  })

  it.each([
    ['negative contract power', { contractPowerKw: -1 }],
    ['zero applied power', { appliedPowerKw: 0 }],
    ['non-finite applied power', { appliedPowerKw: Number.NaN }],
    ['applied power over contract', { contractPowerKw: 400, appliedPowerKw: 500 }],
  ])('blocks diagnosis and documents for %s', (_label, patch) => {
    const diagnosis = buildAutoDiagnosis({
      bills: thirtySixConsecutiveBills,
      profile: {
        ...defaultSchoolProfile,
        contractType: currentPlan.contractType,
        voltageType: currentPlan.voltageType,
        currentPlan: currentPlan.planName,
        ...patch,
      },
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(diagnosis.completed).toBe(false)
    expect(diagnosis.recommendedPlan).toBeNull()
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
    expect(diagnosis.documentBlockReason).toContain('학교')
  })

  it('excludes an invalid negative-rate candidate and never recommends it', () => {
    const invalidCandidate = {
      ...cheaperPlan,
      id: 'negative-candidate',
      baseRateWonPerKw: -10_000,
      seasonRates: {
        springAutumn: -1_000,
        summer: -1_000,
        winter: -1_000,
      },
    }
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }

    const diagnosis = buildAutoDiagnosis({
      bills: thirtySixConsecutiveBills,
      profile,
      ratePlans: [currentPlan, invalidCandidate],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(diagnosis.topCandidates).toEqual([])
    expect(diagnosis.recommendedPlan).toBeNull()
    expect(diagnosis.finalJudgement).not.toBe('변경 추천')
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
  })

  it('blocks diagnosis when the exact current plan has an invalid rate', () => {
    const invalidCurrent = { ...currentPlan, baseRateWonPerKw: 0 }
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }

    const diagnosis = buildAutoDiagnosis({
      bills: thirtySixConsecutiveBills,
      profile,
      ratePlans: [invalidCurrent, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(diagnosis.configurationRequired).toBe(true)
    expect(diagnosis.currentPlan).toBeNull()
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
  })

  it('does not calculate a three-year estimate from gapped calendar periods', () => {
    const comparison = comparePlansForDiagnosis(
      [...consecutiveBills(2022, 1, 24), ...consecutiveBills(2026, 1, 12)],
      currentPlan,
      cheaperPlan,
      undefined,
      defaultCalculationSettings,
    )

    expect(comparison.savingWon).toBeGreaterThan(0)
    expect(comparison.currentThreeYearWon).toBe(0)
    expect(comparison.candidateThreeYearWon).toBe(0)
    expect(comparison.threeYearSavingWon).toBe(0)
    expect(comparison.threeYearDataAvailable).toBe(false)
    expect(comparison.recommendation).toBe('추가 검토 필요')
  })

  it('does not build a partial annual breakdown from fewer than 12 recent months', () => {
    const comparison = comparePlansForDiagnosis(
      [{ ...makeBill(1), id: 'old-bill', year: 2025 }, ...consecutiveBills(2026, 2, 11)],
      currentPlan,
      cheaperPlan,
      undefined,
      defaultCalculationSettings,
    )

    expect(comparison.annualDataAvailable).toBe(false)
    expect(comparison.currentAnnualWon).toBe(0)
    expect(comparison.calculationBreakdown).toEqual([])
  })

  it('recommends keeping the current plan when change increases cost', () => {
    const comparison = comparePlansForDiagnosis(
      twelveBills,
      currentPlan,
      expensivePlan,
      defaultScenario,
      defaultCalculationSettings,
    )

    expect(comparison.savingWon).toBeLessThan(0)
    expect(comparison.recommendation).toBe('유지 추천')
  })

  it('blocks change-document generation when the final judgement is not change', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: twelveBills,
      profile: {
        ...defaultSchoolProfile,
        contractType: currentPlan.contractType,
        voltageType: currentPlan.voltageType,
        currentPlan: currentPlan.planName,
      },
      ratePlans: [currentPlan, expensivePlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(diagnosis.finalJudgement).toBe('유지 추천')
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
    expect(diagnosis.documentBlockReason).toContain('변경 추천')
    expect(diagnosis.availableDocumentCount).toBe(2)
  })

  it('blocks change documents when the diagnosis uses only sample bills', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
    expect(diagnosis.documentBlockReason).toContain('사용자 고지서 업로드 후 생성 가능')
  })

  it('duplicate and gapped months block change documents', () => {
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }
    const duplicateDiagnosis = buildAutoDiagnosis({
      bills: Array.from({ length: 12 }, () => makeBill(1)),
      profile,
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })
    const gappedDiagnosis = buildAutoDiagnosis({
      bills: [...consecutiveBills(2025, 1, 6), ...consecutiveBills(2025, 8, 6)],
      profile: {
        ...profile,
      },
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(duplicateDiagnosis.completed).toBe(false)
    expect(duplicateDiagnosis.recognizedMonths).toBe(0)
    expect(duplicateDiagnosis.canGenerateChangeDocuments).toBe(false)
    expect(duplicateDiagnosis.missingDataNotes.join(' ')).toContain('중복')
    expect(gappedDiagnosis.completed).toBe(false)
    expect(gappedDiagnosis.canGenerateChangeDocuments).toBe(false)
    expect(gappedDiagnosis.missingDataNotes.join(' ')).toContain('누락')
  })

  it('blocks final judgement and documents when otherwise sufficient periods contain an issue', () => {
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }
    const validBills = consecutiveBills(2023, 8, 36)
    const duplicateDiagnosis = buildAutoDiagnosis({
      bills: [...validBills, { ...validBills.at(-1)!, id: 'duplicate-latest' }],
      profile,
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })
    const gappedDiagnosis = buildAutoDiagnosis({
      bills: validBills.filter((bill) => !(bill.year === 2024 && bill.month === 1)),
      profile,
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    for (const diagnosis of [duplicateDiagnosis, gappedDiagnosis]) {
      expect(diagnosis.completed).toBe(false)
      expect(diagnosis.finalJudgement).toBe('추가 검토 필요')
      expect(diagnosis.canGenerateChangeDocuments).toBe(false)
      expect(diagnosis.documentBlockReason).toContain('고지서 기간')
    }
    expect(duplicateDiagnosis.missingDataNotes.join(' ')).toContain('중복')
    expect(gappedDiagnosis.missingDataNotes.join(' ')).toContain('누락')
  })

  it('turns every candidate into review-only data when a period issue exists', () => {
    const profile = {
      ...defaultSchoolProfile,
      contractType: currentPlan.contractType,
      voltageType: currentPlan.voltageType,
      currentPlan: currentPlan.planName,
    }
    const validBills = consecutiveBills(2023, 8, 36)
    const diagnosis = buildAutoDiagnosis({
      bills: [...validBills, { ...validBills.at(-1)!, id: 'duplicate-latest' }],
      profile,
      ratePlans: [currentPlan, cheaperPlan, expensivePlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    expect(diagnosis.recommendedPlan).toBeNull()
    expect(diagnosis.comparison.recommendation).toBe('추가 검토 필요')
    expect(diagnosis.comparison.basis).toContain('고지서 기간 문제')
    for (const candidate of [...diagnosis.topCandidates, ...diagnosis.additionalCandidates]) {
      expect(candidate.recommendation).toBe('추가 검토 필요')
      expect(candidate.basis).toContain('고지서 기간 문제')
      expect(candidate.reviewReason).toContain('고지서 기간 문제')
    }
  })

  it('separates baseline values from the peak scenario', () => {
    const basePeakComparison = comparePlansForDiagnosis(
      thirtySixConsecutiveBills,
      currentPlan,
      cheaperPlan,
      { ...defaultScenario, expectedPeakKw: 500 },
      defaultCalculationSettings,
    )
    const highPeakComparison = comparePlansForDiagnosis(
      thirtySixConsecutiveBills,
      currentPlan,
      cheaperPlan,
      {
        ...defaultScenario,
        expectedPeakKw: 900,
        usageIncreasePercent: 20,
        summerIncreasePercent: 30,
        winterIncreasePercent: 40,
      },
      defaultCalculationSettings,
    )

    expect(highPeakComparison.currentAnnualWon).toBe(
      basePeakComparison.currentAnnualWon,
    )
    expect(highPeakComparison.candidateAnnualWon).toBe(
      basePeakComparison.candidateAnnualWon,
    )
    expect(highPeakComparison.savingWon).toBe(basePeakComparison.savingWon)
    expect(highPeakComparison.currentThreeYearWon).toBe(
      basePeakComparison.currentThreeYearWon,
    )
    expect(highPeakComparison.candidateThreeYearWon).toBe(
      basePeakComparison.candidateThreeYearWon,
    )
    expect(highPeakComparison.threeYearSavingWon).toBe(
      basePeakComparison.threeYearSavingWon,
    )
    expect(highPeakComparison.peakScenarioCurrentAnnualWon).not.toBe(
      basePeakComparison.peakScenarioCurrentAnnualWon,
    )
    expect(highPeakComparison.peakScenarioCandidateAnnualWon).not.toBe(
      basePeakComparison.peakScenarioCandidateAnnualWon,
    )
    expect(highPeakComparison.peakScenarioSavingWon).not.toBe(
      highPeakComparison.savingWon,
    )
    expect(highPeakComparison.peakScenarioSavingWon).toBe(
      highPeakComparison.peakScenarioCurrentAnnualWon -
        highPeakComparison.peakScenarioCandidateAnnualWon,
    )
  })

  it('forces candidates with different contract conditions to additional review', () => {
    const foreignVoltagePlan: RatePlan = {
      ...cheaperPlan,
      id: 'foreign-voltage',
      voltageType: '고압B',
      planName: '고압B 초저가',
      baseRateWonPerKw: 1,
      seasonRates: {
        springAutumn: 1,
        summer: 1,
        winter: 1,
      },
    }
    const diagnosis = buildAutoDiagnosis({
      bills: thirtySixConsecutiveBills,
      profile: {
        ...defaultSchoolProfile,
        contractType: currentPlan.contractType,
        voltageType: currentPlan.voltageType,
        currentPlan: currentPlan.planName,
      },
      ratePlans: [currentPlan, cheaperPlan, foreignVoltagePlan],
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })
    const foreignCandidate = diagnosis.topCandidates.find(
      (candidate) => candidate.candidatePlanId === foreignVoltagePlan.id,
    )

    expect(foreignCandidate?.savingWon).toBeGreaterThan(0)
    expect(foreignCandidate?.recommendation).toBe('추가 검토 필요')
    expect(foreignCandidate?.basis).toContain('계약종별 또는 수전전압')
  })

  it('summarizes missing required upload columns as guidance, not a crash', () => {
    const recognition = summarizeWorkbookRecognition(
      {
        sheets: [
          {
            name: 'missing',
            headers: ['연도', '월', '사용량'],
            rows: [{ 연도: 2026, 월: 1, 사용량: 1000 }],
          },
        ],
        autoRows: [],
        diagnostics: [],
      },
      {
        year: '연도',
        month: '월',
        usageKwh: '사용량',
        totalBillWon: '',
      },
    )

    expect(recognition?.canAnalyze).toBe(false)
    expect(recognition?.guidance).toContain('컬럼을 직접 지정')
    expect(recognition?.missingRequiredColumns).toContain('총 전기요금')
  })

  it('summarizes normalized auto rows as complete recognized data', () => {
    const recognition = summarizeWorkbookRecognition(
      {
        sheets: [
          {
            name: '25전기요금',
            headers: ['구분', '값'],
            rows: [{ 구분: '5월', 값: 1 }],
          },
        ],
        autoRows: [makeBill(5), { ...makeBill(6), year: 2025 }],
        diagnostics: ['연도별 시트를 자동 병합했습니다.'],
      },
      {
        year: '',
        month: '',
        usageKwh: '',
        totalBillWon: '',
      },
    )

    expect(recognition?.recognizedYears).toEqual([2025, 2026])
    expect(recognition?.requiredColumns).toEqual([
      '연도',
      '월',
      '사용량',
      '총 전기요금',
    ])
    expect(recognition?.missingRequiredColumns).toEqual([])
    expect(recognition?.optionalColumns).toEqual(
      expect.arrayContaining([
        '요금적용전력',
        '최대수요전력',
        '기본요금',
        '전력량요금',
        '기후환경요금',
        '연료비조정액',
        '부가세',
        '전력산업기반기금',
      ]),
    )
    expect(recognition?.recognizedRecordCount).toBe(2)
    expect(recognition?.mappingConfidence).toBeGreaterThanOrEqual(80)
    expect(recognition?.mappingConfidence).toBeLessThan(100)
    expect(recognition?.canAnalyze).toBe(true)
  })
})
