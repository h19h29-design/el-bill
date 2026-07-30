import type { PlanCandidateComparison } from '../../types'
import { formatWon } from '../../lib/calculations'
import { formatCostImpact } from '../../lib/diagnosisPresentation'

interface PlanCandidateTableProps {
  candidates: PlanCandidateComparison[]
}

const getJudgementLabel = (
  recommendation: PlanCandidateComparison['recommendation'],
) =>
  recommendation === '변경 추천'
    ? '변경이 유리'
    : recommendation === '유지 추천'
      ? '현재 요금제 유지'
      : '자료 보완 필요'

const getCandidateBasis = (candidate: PlanCandidateComparison) => {
  if (!candidate.annualDataAvailable) return candidate.basis
  if (candidate.savingWon > 0) {
    return `${candidate.candidatePlanName}로 바꾸면 최근 12개월 기준 비용이 ${formatWon(candidate.savingWon)} 절감됩니다.`
  }
  if (candidate.savingWon < 0) {
    return `${candidate.candidatePlanName}로 바꾸면 최근 12개월 기준 비용이 ${formatWon(Math.abs(candidate.savingWon))} 증가합니다.`
  }
  return `${candidate.candidatePlanName}로 바꿔도 최근 12개월 기준 비용 차이가 없습니다.`
}

export function PlanCandidateTable({ candidates }: PlanCandidateTableProps) {
  if (!candidates.length) {
    return (
      <p className="empty-state">
        비교 가능한 후보 요금제가 없습니다. 설정에서 학교용 요금제를 확인해 주세요.
      </p>
    )
  }

  return (
    <div className="candidate-table-wrap">
      <p className="mobile-scroll-hint">표를 좌우로 밀어 전체 후보를 확인하세요.</p>
      <div className="candidate-table-scroll">
        <table className="candidate-table">
          <thead>
            <tr>
              <th>후보 요금제</th>
              <th>최근 12개월 예상액</th>
              <th>변경 시 12개월 영향</th>
              <th>변경 시 36개월 영향</th>
              <th>피크 가정 시 영향</th>
              <th>판단</th>
              <th>판단 근거</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.candidatePlanId}>
                <td>
                  <strong>{candidate.candidatePlanName}</strong>
                  <span>{candidate.contractType} {candidate.voltageType}</span>
                </td>
                <td>
                  {candidate.annualDataAvailable
                    ? formatWon(candidate.candidateAnnualWon)
                    : '자료 부족'}
                </td>
                <td className={candidate.savingWon >= 0 ? 'positive' : 'danger-text'}>
                  {candidate.annualDataAvailable
                    ? formatCostImpact(candidate.savingWon)
                    : '자료 부족'}
                </td>
                <td>
                  {candidate.threeYearDataAvailable
                    ? formatCostImpact(candidate.threeYearSavingWon)
                    : '36개월 자료 부족'}
                </td>
                <td>
                  {candidate.peakScenarioDataAvailable
                    ? formatCostImpact(candidate.peakScenarioSavingWon)
                    : '자료 부족'}
                </td>
                <td>
                  <span className={`judgement-pill ${candidate.recommendation === '변경 추천' ? 'good' : candidate.recommendation === '유지 추천' ? 'hold' : 'review'}`}>
                    {getJudgementLabel(candidate.recommendation)}
                  </span>
                </td>
                <td className="candidate-basis-cell">
                  <strong>{getCandidateBasis(candidate)}</strong>
                  <span>{candidate.reviewReason}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
