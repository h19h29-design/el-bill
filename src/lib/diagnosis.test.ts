import { describe, expect, it } from 'vitest'
import type { MonthlyBill, RatePlan } from '../types'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../data/sampleBills'
import { defaultRatePlans } from '../data/ratePlans'
import {
  buildAutoDiagnosis,
  comparePlansForDiagnosis,
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
})

const twelveBills = Array.from({ length: 12 }, (_, index) => makeBill(index + 1))
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
      [...twelveBills, ...twelveBills, ...twelveBills],
      currentPlan,
      cheaperPlan,
      defaultScenario,
      'billDelta',
    )

    expect(comparison.savingWon).toBeGreaterThan(0)
    expect(comparison.threeYearSavingWon).toBeGreaterThan(0)
    expect(comparison.recommendation).toBe('변경 추천')
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
    expect(recognition?.mappingConfidence).toBe(100)
    expect(recognition?.canAnalyze).toBe(true)
  })
})
