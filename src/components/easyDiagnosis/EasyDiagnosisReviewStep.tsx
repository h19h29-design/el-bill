import { ArrowLeft, ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react'
import type { EasyDiagnosisReview } from '../../lib/easyDiagnosis'

interface EasyDiagnosisReviewStepProps {
  review: EasyDiagnosisReview
  onBack: () => void
  onContinue: () => void
}

export function EasyDiagnosisReviewStep({
  review,
  onBack,
  onContinue,
}: EasyDiagnosisReviewStepProps) {
  return (
    <section className="easy-diagnosis-page" aria-labelledby="easy-review-title">
      <div className="easy-diagnosis-page-heading">
        <span>3단계</span>
        <h2 id="easy-review-title">월별 자료를 확인해 주세요</h2>
        <p>원본 고지서와 연월, 사용량, 총 전기요금이 맞는지만 확인하면 됩니다.</p>
      </div>
      <div className={`easy-review-status ${review.canContinue ? 'complete' : 'blocked'}`}>
        {review.canContinue ? <CheckCircle2 size={25} /> : <ShieldAlert size={25} />}
        <div>
          <strong>{review.canContinue ? '12개월 자료를 확인했습니다' : '12개월 자료가 아직 부족합니다'}</strong>
          <span>{review.consecutiveMonthCount}/12개월</span>
        </div>
      </div>
      <dl className="easy-review-summary">
        <div><dt>인식 기간</dt><dd>{review.periodLabel}</dd></div>
        <div><dt>필수 항목</dt><dd>연도, 월, 사용량, 총 전기요금</dd></div>
        <div><dt>추가 인식</dt><dd>{review.observedOptionalFields.join(', ') || '없음'}</dd></div>
      </dl>
      {review.issues.length > 0 && (
        <ul className="diagnostics-list" aria-label="자료 보완 안내">
          {review.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      <div className="easy-review-table-scroll">
        <table className="easy-review-table">
          <thead><tr><th>연월</th><th>사용량(kWh)</th><th>총 전기요금</th></tr></thead>
          <tbody>
            {review.bills.map((bill) => (
              <tr key={bill.id}>
                <td>{bill.year}.{String(bill.month).padStart(2, '0')}</td>
                <td>{bill.usageKwh.toLocaleString('ko-KR')}</td>
                <td>{bill.totalBillWon.toLocaleString('ko-KR')}원</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="easy-page-actions">
        <button type="button" className="outline-action" onClick={onBack}>
          <ArrowLeft size={17} /> 자료 다시 넣기
        </button>
        <button type="button" className="primary-button" disabled={!review.canContinue} onClick={onContinue}>
          계약정보 확인으로 이동 <ArrowRight size={17} />
        </button>
      </div>
    </section>
  )
}
