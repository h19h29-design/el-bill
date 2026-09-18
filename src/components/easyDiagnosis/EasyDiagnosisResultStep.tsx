import { useState } from 'react'
import {
  CalendarClock,
  FileText,
  Gauge,
  House,
  RefreshCw,
  SearchCheck,
  Send,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react'
import type { AutoDiagnosisResult, DataProvenance, ViewKey } from '../../types'
import { formatWon } from '../../lib/calculations'
import { formatCostImpact } from '../../lib/diagnosisPresentation'
import { buildEasyDiagnosisDecision } from '../../lib/easyDiagnosis'
import { PlanCandidateTable } from '../diagnosis/PlanCandidateTable'
import { NextStepsRail, type NextStepItem } from '../common/NextStepsRail'

interface EasyDiagnosisResultStepProps {
  diagnosis: AutoDiagnosisResult
  dataProvenance: DataProvenance
  onNavigate: (view: ViewKey) => void
  onReviseData: () => void
  onRestart: () => void
}

export function EasyDiagnosisResultStep({
  diagnosis,
  dataProvenance,
  onNavigate,
  onReviseData,
  onRestart,
}: EasyDiagnosisResultStepProps) {
  const [showDetails, setShowDetails] = useState(false)
  const decision = buildEasyDiagnosisDecision(diagnosis, dataProvenance)
  const comparison = diagnosis.comparison
  const largestCostImpact = [...comparison.calculationBreakdown]
    .filter((row) => row.label !== '최근 12개월 합계')
    .sort((left, right) => Math.abs(right.differenceWon) - Math.abs(left.differenceWon))[0]

  const nextSteps: NextStepItem[] =
    decision.tone === 'change'
      ? [
          {
            title: '피크관리 방안 확인',
            description: '최대부하 시간대 운영 순서를 그대로 따라 하면 됩니다.',
            icon: <Gauge size={20} />,
            actionLabel: '피크관리 방안 보기',
            onAction: () => onNavigate('peak'),
          },
          {
            title: '신청서류 받기',
            description: '계획안·한전 공문·변경신청서 PDF 3종과 붙임 체크리스트.',
            icon: <FileText size={20} />,
            actionLabel: '변경신청 패키지 생성',
            onAction: () => onNavigate('docs'),
            actionDisabled: !diagnosis.canGenerateChangeDocuments,
          },
          {
            title: '한전에 제출',
            description: '공문, 신청서, 붙임 서류를 관할 한전에 제출하면 끝입니다.',
            icon: <Send size={20} />,
          },
        ]
      : decision.tone === 'maintain'
        ? [
            {
              title: '유지 결과 확인',
              description: '왜 유지가 유리한지 대시보드에서 확인합니다.',
              icon: <House size={20} />,
              actionLabel: '유지 결과를 대시보드에서 보기',
              onAction: () => onNavigate('dashboard'),
            },
            {
              title: '피크관리로 추가 절감',
              description: '요금제를 바꾸지 않아도 피크 관리로 요금을 줄일 수 있습니다.',
              icon: <Gauge size={20} />,
              actionLabel: '피크관리 방안 보기',
              onAction: () => onNavigate('peak'),
            },
            {
              title: '다음 변경 시기에 재진단',
              description: '요금제 변경은 1년에 한 번만 가능하므로 적용 가능 시기를 확인하세요.',
              icon: <CalendarClock size={20} />,
            },
          ]
        : [
            {
              title: '자료 보완',
              description: '빠진 월이나 항목을 보완하면 바로 다시 분석합니다.',
              icon: <UploadCloud size={20} />,
              actionLabel: '자료 보완하기',
              onAction: onReviseData,
            },
            {
              title: '자동 재분석',
              description: '자료를 고친 뒤 같은 단계를 다시 진행하면 결과가 나옵니다.',
              icon: <SearchCheck size={20} />,
            },
          ]

  return (
    <section className="easy-diagnosis-result" aria-labelledby="easy-result-title">
      <div className={`easy-result-command ${decision.tone}`}>
        <span>5단계 · 자동 분석 완료</span>
        <h2 id="easy-result-title" tabIndex={-1}>{decision.command}</h2>
        <strong>
          {comparison.annualDataAvailable
            ? formatCostImpact(comparison.savingWon, { annual: true })
            : '연속 12개월 자료 확인 필요'}
        </strong>
        <p>{decision.summary}</p>
      </div>

      <NextStepsRail label="진단 이후 진행 순서" items={nextSteps} />

      <p className="easy-result-caution">
        <ShieldAlert size={15} aria-hidden="true" />
        요금제 변경 신청은 1년에 한 번만 가능 · 이 결과는 학교 내부 진단용 추정입니다.
      </p>

      <div className="easy-result-facts">
        <div><span>현재 요금제</span><strong>{diagnosis.currentPlan?.planName ?? '확인 필요'}</strong></div>
        <div><span>비교 요금제</span><strong>{diagnosis.recommendedPlan?.planName ?? '확인 필요'}</strong></div>
        <div><span>현재 12개월 추정액</span><strong>{formatWon(comparison.currentAnnualWon)}</strong></div>
        <div><span>추천 12개월 추정액</span><strong>{formatWon(comparison.candidateAnnualWon)}</strong></div>
        <div><span>가장 큰 비용 요인</span><strong>{largestCostImpact ? `${largestCostImpact.label} · ${formatCostImpact(largestCostImpact.differenceWon)}` : '세부 내역 확인 필요'}</strong></div>
        <div><span>판단 신뢰도</span><strong>{diagnosis.dataConfidence} · {diagnosis.dataRecognitionRate}%</strong></div>
      </div>

      <div className="easy-result-actions">
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
