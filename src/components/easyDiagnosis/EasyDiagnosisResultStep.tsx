import { useState } from 'react'
import { FileText, Gauge, RefreshCw, ShieldAlert } from 'lucide-react'
import type { AutoDiagnosisResult, DataProvenance, ViewKey } from '../../types'
import { formatWon } from '../../lib/calculations'
import { formatCostImpact } from '../../lib/diagnosisPresentation'
import { buildEasyDiagnosisDecision } from '../../lib/easyDiagnosis'
import { PlanCandidateTable } from '../diagnosis/PlanCandidateTable'

interface EasyDiagnosisResultStepProps {
  diagnosis: AutoDiagnosisResult
  dataProvenance: DataProvenance
  onNavigate: (view: ViewKey) => void
  onRestart: () => void
}

export function EasyDiagnosisResultStep({
  diagnosis,
  dataProvenance,
  onNavigate,
  onRestart,
}: EasyDiagnosisResultStepProps) {
  const [showDetails, setShowDetails] = useState(false)
  const decision = buildEasyDiagnosisDecision(diagnosis, dataProvenance)
  const comparison = diagnosis.comparison

  return (
    <section className="easy-diagnosis-result" aria-labelledby="easy-result-title">
      <div className={`easy-result-command ${decision.tone}`}>
        <span>5단계 · 자동 분석 완료</span>
        <h2 id="easy-result-title">{decision.command}</h2>
        <strong>
          {comparison.annualDataAvailable
            ? formatCostImpact(comparison.savingWon, { annual: true })
            : '연속 12개월 자료 확인 필요'}
        </strong>
        <p>{decision.summary}</p>
      </div>
      <div className="easy-result-columns">
        <section aria-labelledby="easy-result-reasons">
          <h3 id="easy-result-reasons">이렇게 판단한 이유</h3>
          <ol>
            {decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ol>
        </section>
        <section aria-labelledby="easy-result-checks">
          <h3 id="easy-result-checks">신청 전에 확인할 점</h3>
          <ul>
            {decision.cautions.map((caution) => <li key={caution}>{caution}</li>)}
          </ul>
        </section>
      </div>
      <div className="easy-result-facts">
        <div><span>현재 요금제</span><strong>{diagnosis.currentPlan?.planName ?? '확인 필요'}</strong></div>
        <div><span>비교 요금제</span><strong>{diagnosis.recommendedPlan?.planName ?? '확인 필요'}</strong></div>
        <div><span>현재 12개월 추정액</span><strong>{formatWon(comparison.currentAnnualWon)}</strong></div>
        <div><span>판단 신뢰도</span><strong>{diagnosis.dataConfidence} · {diagnosis.dataRecognitionRate}%</strong></div>
      </div>
      <div className="easy-result-actions">
        {decision.tone === 'change' && diagnosis.canGenerateChangeDocuments && (
          <button type="button" className="primary-button" onClick={() => onNavigate('docs')}>
            <FileText size={18} /> 변경신청 패키지 생성
          </button>
        )}
        <button type="button" className="outline-action" onClick={() => onNavigate('peak')}>
          <Gauge size={18} /> 피크관리 방안 보기
        </button>
        <button type="button" className="outline-action" onClick={onRestart}>
          <RefreshCw size={18} /> 새로 진단하기
        </button>
      </div>
      <details
        className="easy-result-details"
        open={showDetails}
      >
        <summary
          onClick={(event) => {
            event.preventDefault()
            setShowDetails((current) => !current)
          }}
        >
          상세 결과 보기
        </summary>
        {showDetails && (
          <div className="easy-result-details-content">
            <h3>요금제 자동 비교 TOP 3</h3>
            <PlanCandidateTable candidates={diagnosis.topCandidates} />
            <div className="easy-result-warning">
              <ShieldAlert size={18} />
              이 비교는 학교 내부 의사결정용 추정이며 공식 청구액 계산기가 아닙니다.
            </div>
          </div>
        )}
      </details>
    </section>
  )
}
