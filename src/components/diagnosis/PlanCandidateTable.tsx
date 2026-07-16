import type { PlanCandidateComparison } from '../../types'
import { formatWon } from '../../lib/calculations'

interface PlanCandidateTableProps {
  candidates: PlanCandidateComparison[]
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
              <th>최근 12개월 절감액</th>
              <th>최근 3년 절감액</th>
              <th>피크 반영 절감액</th>
              <th>판단</th>
              <th>검토 사유</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.candidatePlanId}>
                <td>
                  <strong>{candidate.candidatePlanName}</strong>
                  <span>{candidate.contractType} {candidate.voltageType}</span>
                </td>
                <td>{formatWon(candidate.candidateAnnualWon)}</td>
                <td className={candidate.savingWon >= 0 ? 'positive' : 'danger-text'}>
                  {formatWon(candidate.savingWon)}
                </td>
                <td>{formatWon(candidate.threeYearSavingWon)}</td>
                <td>{formatWon(candidate.peakScenarioSavingWon)}</td>
                <td>
                  <span className={`judgement-pill ${candidate.recommendation === '변경 추천' ? 'good' : candidate.recommendation === '유지 추천' ? 'hold' : 'review'}`}>
                    {candidate.recommendation}
                  </span>
                </td>
                <td>{candidate.reviewReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
