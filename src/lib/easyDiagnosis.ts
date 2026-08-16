import type { BillInputCandidate } from '../components/bills/BillInputPreview'
import {
  getObservedBillFields,
  type AutoDiagnosisResult,
  type DataProvenance,
  type MonthlyBill,
  type RatePlan,
  type SchoolProfile,
} from '../types'
import { validateBillPeriods } from './billPeriods'
import { findExactRatePlan } from './diagnosis'
import { getDiagnosisDecisionPresentation } from './diagnosisPresentation'

export type EasyDiagnosisSource = 'pdf' | 'table' | 'paste' | 'manual'

export type EasyDiagnosisStep =
  | 'source'
  | 'import'
  | 'review'
  | 'profile'
  | 'result'

export interface EasyDiagnosisReview {
  bills: MonthlyBill[]
  consecutiveMonthCount: number
  periodLabel: string
  observedOptionalFields: string[]
  issues: string[]
  canContinue: boolean
}

export interface EasyDiagnosisDecision {
  tone: 'change' | 'maintain' | 'review'
  command: string
  summary: string
  reasons: string[]
  cautions: string[]
  canAct: boolean
}

const optionalFieldLabels = {
  appliedPowerKw: '요금적용전력',
  maxDemandKw: '최대수요전력',
  baseChargeWon: '기본요금',
  energyChargeWon: '전력량요금',
  powerFactorChargeWon: '역률요금',
  climateChargeWon: '기후환경요금',
  fuelAdjustmentWon: '연료비조정액',
  vatWon: '부가세',
  fundWon: '전력산업기반기금',
} as const

const formatPeriod = (bill: MonthlyBill) => `${bill.year}년 ${bill.month}월`

const formatPeriodRange = (bills: MonthlyBill[]) => {
  const first = bills[0]
  const last = bills.at(-1)
  if (!first || !last) return '인식된 기간 없음'
  return first === last
    ? formatPeriod(first)
    : `${formatPeriod(first)} ~ ${formatPeriod(last)}`
}

const getObservedOptionalFields = (bills: MonthlyBill[]) => {
  const fields = new Set(bills.flatMap(getObservedBillFields))
  return Object.entries(optionalFieldLabels)
    .filter(([field]) => fields.has(field as keyof typeof optionalFieldLabels))
    .map(([, label]) => label)
}

export const buildEasyDiagnosisReview = (
  candidate: BillInputCandidate | null,
): EasyDiagnosisReview => {
  if (!candidate) {
    return {
      bills: [],
      consecutiveMonthCount: 0,
      periodLabel: '인식된 기간 없음',
      observedOptionalFields: [],
      issues: ['먼저 12개월 고지서 또는 요금 정리표를 넣어주세요.'],
      canContinue: false,
    }
  }

  const validation = validateBillPeriods(candidate.bills)
  const bills = validation.recentConsecutiveBills.slice(-12)
  const issues = validation.issues.map((issue) => issue.message)
  if (!validation.hasRequiredConsecutiveMonths) {
    issues.push(
      `연속 12개월 자료가 필요합니다. 현재 ${validation.recentConsecutiveBills.length}개월을 확인했습니다.`,
    )
  }

  return {
    bills,
    consecutiveMonthCount: validation.recentConsecutiveBills.length,
    periodLabel: formatPeriodRange(bills),
    observedOptionalFields: getObservedOptionalFields(bills),
    issues,
    canContinue:
      validation.hasRequiredConsecutiveMonths && validation.issues.length === 0,
  }
}

export const getEasyDiagnosisProfileIssue = (
  profile: SchoolProfile,
  ratePlans: RatePlan[],
) => {
  if (!(profile.appliedPowerKw > 0)) {
    return '요금적용전력은 0보다 큰 값으로 입력해 주세요.'
  }
  if (!findExactRatePlan(profile, ratePlans)) {
    return '계약종별, 수전전압, 현재 요금제와 일치하는 학교용 요금제를 선택해 주세요.'
  }
  return null
}

const annualChangeCaution =
  '요금제 변경 신청은 원칙적으로 1년에 한 번만 가능하므로 예상 절감액과 향후 사용량을 신중히 검토하세요.'
const estimateCaution =
  '이 결과는 공식 청구액이 아닌 학교 내부 진단용 추정입니다. 신청 전 한전 고지서와 최신 단가를 다시 확인하세요.'

export const buildEasyDiagnosisDecision = (
  diagnosis: AutoDiagnosisResult,
  provenance: DataProvenance,
): EasyDiagnosisDecision => {
  if (provenance.bills === 'sample') {
    return {
      tone: 'review',
      command: '실제 12개월 자료를 먼저 넣어주세요',
      summary: '시연 샘플은 실제 학교의 요금제 판단에 사용할 수 없습니다.',
      reasons: ['12개월 고지서 PDF 또는 12개월 요금 정리표를 넣으면 자동 분석을 시작합니다.'],
      cautions: [estimateCaution, annualChangeCaution],
      canAct: false,
    }
  }

  const presentation = getDiagnosisDecisionPresentation(diagnosis)
  const currentPlanName = diagnosis.currentPlan?.planName ?? '현재 요금제'
  const recommendedPlanName = diagnosis.recommendedPlan?.planName ?? '추천 요금제'
  const tone =
    diagnosis.finalJudgement === '변경 추천'
      ? 'change'
      : diagnosis.finalJudgement === '유지 추천'
        ? 'maintain'
        : 'review'
  const command =
    tone === 'change'
      ? `${recommendedPlanName}으로 변경하세요`
      : tone === 'maintain'
        ? `현재 ${currentPlanName}를 유지하세요`
        : '지금은 변경하지 마세요'
  const cautions = [estimateCaution]
  if (!diagnosis.comparison.threeYearDataAvailable) {
    cautions.push('36개월 연속 자료가 없어 장기 사용 추세는 확인하지 못했습니다.')
  }
  cautions.push(
    diagnosis.comparison.peakScenarioDataAvailable
      ? '피크 시나리오 결과는 입력한 예상 피크가 실제로 발생한다는 가정입니다.'
      : '파워플래너 자료가 없어 피크 시간대 영향은 별도로 확인해야 합니다.',
    annualChangeCaution,
  )

  return {
    tone,
    command,
    summary: presentation.summary,
    reasons:
      presentation.reasons.length > 0
        ? presentation.reasons.slice(0, 3)
        : [diagnosis.judgementBasis],
    cautions,
    canAct: tone !== 'review',
  }
}
