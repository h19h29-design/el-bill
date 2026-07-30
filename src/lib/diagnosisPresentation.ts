import type {
  AutoDiagnosisResult,
  CalculationBreakdownRow,
  Recommendation,
} from '../types'
import { formatWon } from './calculations'

export const formatCostImpact = (
  savingWon: number,
  options: { annual?: boolean } = {},
) => {
  const prefix = options.annual ? '연 ' : ''
  if (savingWon > 0) return `${prefix}${formatWon(savingWon)} 절감`
  if (savingWon < 0) return `${prefix}${formatWon(Math.abs(savingWon))} 증가`
  return '차이 없음'
}

const formatAnnualCostForecast = (savingWon: number) => {
  if (savingWon > 0) {
    return `연간 비용이 ${formatWon(savingWon)} 줄어들 것으로 추정됩니다.`
  }
  if (savingWon < 0) {
    return `연간 비용이 ${formatWon(Math.abs(savingWon))} 늘어날 것으로 추정됩니다.`
  }
  return '연간 비용 차이가 없을 것으로 추정됩니다.'
}

const formatBreakdownLabel = (label: string) =>
  label.replace(/\s*차액$/, '')

const describeBreakdown = (
  rows: CalculationBreakdownRow[],
  recommendation: Recommendation,
) => {
  const components = rows.filter((row) => row.label !== '최근 12개월 합계')
  const decreases = components
    .filter((row) => row.differenceWon > 0)
    .map(
      (row) =>
        `${formatBreakdownLabel(row.label)} ${formatCostImpact(row.differenceWon)}`,
    )
  const increases = components
    .filter((row) => row.differenceWon < 0)
    .map(
      (row) =>
        `${formatBreakdownLabel(row.label)} ${formatCostImpact(row.differenceWon)}`,
    )

  if (recommendation === '유지 추천' && decreases.length && increases.length) {
    return `${decreases.join('·')} 효과는 있지만, ${increases.join('·')} 부담이 더 커 총비용이 증가합니다.`
  }
  if (recommendation === '변경 추천' && decreases.length) {
    return `${decreases.join('·')} 효과가 변경에 따른 증가 항목보다 커 총비용이 절감됩니다.`
  }
  return null
}

export interface DiagnosisDecisionPresentation {
  badge: string
  title: string
  summary: string
  reasons: string[]
  candidateLabel: string
}

export const getDiagnosisDecisionPresentation = (
  diagnosis: AutoDiagnosisResult,
): DiagnosisDecisionPresentation => {
  const comparison = diagnosis.comparison
  const currentPlanName = diagnosis.currentPlan?.planName ?? '현재 요금제'
  const candidatePlanName =
    diagnosis.recommendedPlan?.planName ?? '비교 요금제'
  const reasons: string[] = []
  const breakdownReason = describeBreakdown(
    comparison.calculationBreakdown,
    diagnosis.finalJudgement,
  )

  if (comparison.annualDataAvailable) {
    reasons.push(
      `최근 12개월 추정액은 현재 요금제 ${formatWon(comparison.currentAnnualWon)}, 비교 요금제 ${formatWon(comparison.candidateAnnualWon)}입니다.`,
    )
  }
  if (breakdownReason) reasons.push(breakdownReason)

  if (
    comparison.peakScenarioDataAvailable &&
    comparison.peakScenarioSavingWon !== 0
  ) {
    const peakImpact = formatCostImpact(comparison.peakScenarioSavingWon)
    const caution =
      diagnosis.finalJudgement === '유지 추천' &&
      comparison.peakScenarioSavingWon > 0
        ? ' 최근 12개월 고지서 기준 판단보다 우선하지 않았습니다.'
        : ''
    reasons.push(
      `피크 시나리오에서는 ${peakImpact}으로 계산되지만, 예상 피크값이 실제로 발생한다는 가정입니다.${caution}`,
    )
  }

  if (!comparison.threeYearDataAvailable) {
    reasons.push(
      '36개월 연속 자료가 없어 장기 추세는 확인하지 못했습니다. 자료를 보완하면 판단 신뢰도가 높아집니다.',
    )
  } else {
    reasons.push(
      `최근 36개월 기준 영향은 ${formatCostImpact(comparison.threeYearSavingWon)}입니다.`,
    )
  }

  if (diagnosis.finalJudgement === '유지 추천') {
    return {
      badge: '현재 요금제 유지',
      title: `현재 ${currentPlanName}를 유지하세요`,
      summary: `${candidatePlanName}로 변경하면 최근 12개월 고지서 기준 ${formatAnnualCostForecast(comparison.savingWon)}`,
      reasons,
      candidateLabel: '비교 대상 요금제',
    }
  }

  if (diagnosis.finalJudgement === '변경 추천') {
    return {
      badge: '요금제 변경 유리',
      title: `현재 ${currentPlanName}에서 ${candidatePlanName}로 변경하는 편이 유리합니다`,
      summary: `최근 12개월 고지서 기준 ${formatAnnualCostForecast(comparison.savingWon)}`,
      reasons,
      candidateLabel: '변경 추천 요금제',
    }
  }

  return {
    badge: '자료 보완 후 판단',
    title: '지금은 요금제를 변경하지 말고 자료를 더 확인하세요',
    summary: diagnosis.judgementBasis,
    reasons,
    candidateLabel: '우선 비교 요금제',
  }
}
