import { describe, expect, it } from 'vitest'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../data/sampleBills'
import type { AutoDiagnosisResult, PlanCandidateComparison, RatePlan } from '../types'
import { buildDocumentBundle, rateChangeCaution } from './documentTemplates'

const comparison = {
  currentAnnualWon: 66_589_800,
  candidateAnnualWon: 63_260_310,
  savingWon: 3_329_490,
  savingRate: 0.05,
  threeYearSavingWon: 9_988_470,
  fiveYearSavingWon: 16_647_450,
  recommendation: '변경 추천' as const,
  basis: '테스트',
}

const currentPlan: RatePlan = {
  id: 'current',
  contractType: '교육용(갑)',
  voltageType: '고압A',
  planName: '선택요금Ⅱ',
  baseRateWonPerKw: 6370,
  seasonRates: {
    springAutumn: 82.1,
    summer: 118.8,
    winter: 104.8,
  },
  effectiveFrom: '2026-01-01',
  memo: '테스트',
}

const recommendedPlan: RatePlan = {
  id: 'recommended',
  contractType: '교육용(갑)',
  voltageType: '고압A',
  planName: '테스트 추천요금',
  baseRateWonPerKw: 5550,
  seasonRates: {
    springAutumn: 86.5,
    summer: 123.3,
    winter: 109.3,
  },
  effectiveFrom: '2026-01-01',
  memo: '테스트',
}

const candidateComparison: PlanCandidateComparison = {
  ...comparison,
  candidatePlanId: recommendedPlan.id,
  candidatePlanName: recommendedPlan.planName,
  contractType: recommendedPlan.contractType,
  voltageType: recommendedPlan.voltageType,
  sameContractPriority: true,
  peakScenarioSavingWon: 340_000,
  calculationMode: 'billDelta',
  calculationBreakdown: [
    {
      label: '기본요금 차액',
      currentWon: 38_220_000,
      candidateWon: 33_300_000,
      differenceWon: 4_920_000,
      note: '요금적용전력과 예상 피크값 중 큰 값을 기준으로 kW 단가를 비교합니다.',
    },
  ],
  reviewReason: '현재 계약종별과 수전전압이 일치하는 우선 후보입니다.',
}

const diagnosis: AutoDiagnosisResult = {
  completed: true,
  currentPlan,
  recommendedPlan,
  topCandidates: [candidateComparison],
  additionalCandidates: [],
  comparison: candidateComparison,
  calculationMode: 'billDelta',
  dataConfidence: '보통',
  dataRecognitionRate: 92,
  recognizedMonths: 36,
  lastUploadLabel: '2026년 5월 고지서',
  availableDocumentCount: 6,
  finalJudgement: '변경 추천',
  judgementBasis: '최근 12개월과 최근 3년 기준이 모두 절감으로 추정됩니다.',
  missingDataNotes: [rateChangeCaution],
}

describe('document template harness', () => {
  it('includes the one-change-per-year caution in generated documents', () => {
    const bundle = buildDocumentBundle(
      defaultSchoolProfile,
      sampleBills.at(-1),
      comparison,
      defaultScenario,
    )

    expect(bundle.planText).toContain(rateChangeCaution)
    expect(bundle.kepcoLetterText).toContain(rateChangeCaution)
    expect(bundle.applicationPreviewData.신중검토안내).toBe(rateChangeCaution)
  })

  it('uses the actual recommended plan name in generated documents', () => {
    const bundle = buildDocumentBundle(
      defaultSchoolProfile,
      sampleBills.at(-1),
      comparison,
      defaultScenario,
      diagnosis,
    )

    expect(bundle.planText).toContain('추천 요금제(테스트 추천요금)')
    expect(bundle.planText).toContain('기존 선택요금Ⅱ에서 테스트 추천요금으로 변경')
    expect(bundle.kepcoLetterText).toContain('테스트 추천요금 적용을 검토')
    expect(bundle.applicationPreviewData.선택요금변경).toBe(
      '선택요금Ⅱ -> 테스트 추천요금',
    )
    expect(bundle.calculationSummaryText).toContain('고지서 기반 차액 추정')
    expect(bundle.calculationSummaryText).toContain('기본요금 차액')
    expect(bundle.calculationBreakdown[0].differenceWon).toBe(4_920_000)
  })
})
