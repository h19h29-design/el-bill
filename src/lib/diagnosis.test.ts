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

describe('automatic diagnosis harness', () => {
  it('marks under-12-month data as additional review', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills.slice(0, 6),
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
    })

    expect(diagnosis.finalJudgement).toBe('추가 검토 필요')
    expect(diagnosis.completed).toBe(false)
  })

  it('recommends change when 12-month and 3-year estimates both save money', () => {
    const comparison = comparePlansForDiagnosis(
      thirtySixConsecutiveBills,
      currentPlan,
      cheaperPlan,
      defaultScenario,
      'billDelta',
    )

    expect(comparison.savingWon).toBeGreaterThan(0)
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
      billsAreUserUploaded: true,
    })

    expect(resolution.exact).toBe(false)
    expect(resolution.plan).toBeNull()
    expect(resolution.issue).toContain('중복')
    expect(diagnosis.configurationRequired).toBe(true)
    expect(diagnosis.canGenerateChangeDocuments).toBe(false)
  })

  it('unknown current plan blocks diagnosis', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: { ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' },
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
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

  it('does not calculate a three-year estimate from gapped calendar periods', () => {
    const comparison = comparePlansForDiagnosis(
      [...consecutiveBills(2022, 1, 24), ...consecutiveBills(2026, 1, 12)],
      currentPlan,
      cheaperPlan,
    )

    expect(comparison.savingWon).toBeGreaterThan(0)
    expect(comparison.threeYearSavingWon).toBe(0)
    expect(comparison.recommendation).toBe('추가 검토 필요')
  })

  it('builds the annual breakdown from the recent consecutive run only', () => {
    const comparison = comparePlansForDiagnosis(
      [{ ...makeBill(1), id: 'old-bill', year: 2025 }, ...consecutiveBills(2026, 2, 11)],
      currentPlan,
      cheaperPlan,
    )

    expect(comparison.currentAnnualWon).toBeGreaterThan(0)
    expect(comparison.calculationBreakdown[0]?.currentWon).toBe(5_500_000)
  })

  it('recommends keeping the current plan when change increases cost', () => {
    const comparison = comparePlansForDiagnosis(
      twelveBills,
      currentPlan,
      expensivePlan,
      defaultScenario,
      'billDelta',
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
      billsAreUserUploaded: true,
    })
    const gappedDiagnosis = buildAutoDiagnosis({
      bills: [...consecutiveBills(2025, 1, 6), ...consecutiveBills(2025, 8, 6)],
      profile: {
        ...profile,
      },
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
      billsAreUserUploaded: true,
    })

    expect(duplicateDiagnosis.completed).toBe(false)
    expect(duplicateDiagnosis.recognizedMonths).toBe(1)
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
      billsAreUserUploaded: true,
    })
    const gappedDiagnosis = buildAutoDiagnosis({
      bills: validBills.filter((bill) => !(bill.year === 2024 && bill.month === 1)),
      profile,
      ratePlans: [currentPlan, cheaperPlan],
      scenario: defaultScenario,
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

  it('recalculates savings when expected peak changes', () => {
    const basePeakComparison = comparePlansForDiagnosis(
      twelveBills,
      currentPlan,
      cheaperPlan,
      { ...defaultScenario, expectedPeakKw: 500 },
      'billDelta',
    )
    const highPeakComparison = comparePlansForDiagnosis(
      twelveBills,
      currentPlan,
      cheaperPlan,
      { ...defaultScenario, expectedPeakKw: 900 },
      'billDelta',
    )

    expect(highPeakComparison.savingWon).not.toBe(basePeakComparison.savingWon)
    expect(highPeakComparison.peakScenarioSavingWon).toBe(highPeakComparison.savingWon)
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
