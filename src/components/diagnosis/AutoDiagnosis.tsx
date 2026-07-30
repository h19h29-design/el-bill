import {
  ArrowRight,
  FileText,
  Gauge,
  PlayCircle,
  ShieldAlert,
  TrendingDown,
  UploadCloud,
} from 'lucide-react'
import type { AutoDiagnosisResult, DataProvenance, ViewKey } from '../../types'
import { formatWon } from '../../lib/calculations'
import { getCalculationModeLabel } from '../../lib/calculationSettings'
import { rateChangeCaution } from '../../lib/documentTemplates'
import { getBillOriginLabel } from '../../lib/dataProvenance'
import {
  formatCostImpact,
  getDiagnosisDecisionPresentation,
} from '../../lib/diagnosisPresentation'
import { PlanCandidateTable } from './PlanCandidateTable'

interface AutoDiagnosisProps {
  diagnosis: AutoDiagnosisResult
  dataProvenance: DataProvenance
  onNavigate: (view: ViewKey) => void
}

const steps = [
  ['자료 업로드', '한전고지서·파워플래너 파일'],
  ['학교정보 확인', '계약종별·전압·현재 요금제'],
  ['요금제 자동 비교', '학교용 후보 전체 비교'],
  ['피크관리 방안 생성', '최대부하 시간대 운영안'],
  ['변경신청 패키지 생성', '계획안·공문·신청서'],
] as const

export function AutoDiagnosis({
  diagnosis,
  dataProvenance,
  onNavigate,
}: AutoDiagnosisProps) {
  const comparison = diagnosis.comparison
  const currentPlan = diagnosis.currentPlan
  const recommendedPlan = diagnosis.recommendedPlan
  const decision = getDiagnosisDecisionPresentation(diagnosis)
  const judgementClass =
    diagnosis.finalJudgement === '변경 추천'
      ? 'good'
      : diagnosis.finalJudgement === '유지 추천'
        ? 'hold'
        : 'review'

  if (diagnosis.configurationRequired || !currentPlan) {
    return (
      <div className="view-stack">
        <section className="diagnosis-hero">
          <div>
            <span className="flow-label">요금제 설정 필요</span>
            <h2>자동진단을 시작할 수 없습니다</h2>
            <p>{diagnosis.judgementBasis}</p>
          </div>
          <button
            type="button"
            className="primary-button diagnosis-start"
            onClick={() => onNavigate('settings')}
          >
            <ShieldAlert size={20} />
            요금제 설정 확인
          </button>
        </section>
        <section className="document-block-notice" role="status">
          <ShieldAlert size={22} />
          <div>
            <strong>요금제 자동 비교 및 변경신청 문서 생성 보류</strong>
            <p>{diagnosis.documentBlockReason}</p>
          </div>
        </section>
      </div>
    )
  }

  if (!recommendedPlan) {
    return (
      <div className="view-stack">
        <section className="diagnosis-hero">
          <div>
            <span className="flow-label">고지서 기간 확인 필요</span>
            <h2>추가 검토 필요</h2>
            <p>{diagnosis.judgementBasis}</p>
          </div>
          <button
            type="button"
            className="primary-button diagnosis-start"
            onClick={() => onNavigate('bills')}
          >
            <ShieldAlert size={20} />
            고지서 기간 확인
          </button>
        </section>
        <section className="document-block-notice" role="status">
          <ShieldAlert size={22} />
          <div>
            <strong>요금제 추천 및 변경신청 문서 생성 보류</strong>
            <p>{diagnosis.documentBlockReason}</p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="view-stack">
      <section className="diagnosis-hero">
        <div>
          <span className="flow-label">
            {getBillOriginLabel(dataProvenance.bills)} 고지서 분석
            {' · '}
            {dataProvenance.powerPlanner === 'none'
              ? '파워플래너 미사용'
              : `파워플래너 ${dataProvenance.powerPlanner === 'sample' ? '시연 샘플' : '사용자 업로드'}`}
          </span>
          <h2>전기요금 자동진단 결과</h2>
          <p>
            업로드한 고지서를 기준으로 현재 요금제 유지와 변경 중 어느 쪽이 유리한지 비교했습니다.
          </p>
        </div>
        <button
          type="button"
          className="primary-button diagnosis-start"
          onClick={() => onNavigate('bills')}
        >
          <PlayCircle size={20} />
          자료 다시 불러오기
        </button>
      </section>

      <section className="diagnosis-stepper" aria-label="자동진단 단계">
        {steps.map(([title, description], index) => (
          <article
            key={title}
            className={
              index < 3 ||
              (index === 3 && diagnosis.completed) ||
              (index === 4 && diagnosis.canGenerateChangeDocuments)
                ? 'complete'
                : ''
            }
          >
            <strong>{index + 1}</strong>
            <span>{title}</span>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section
        className={`diagnosis-decision ${judgementClass}`}
        aria-labelledby="diagnosis-decision-title"
      >
        <div className="diagnosis-decision-main">
          <span>{decision.badge}</span>
          <h2 id="diagnosis-decision-title">{decision.title}</h2>
          <p>{decision.summary}</p>
          <div className="diagnosis-actions">
            <button
              type="button"
              className="outline-action"
              onClick={() => onNavigate('peak')}
            >
              <Gauge size={17} />
              피크 가정 확인
            </button>
            {diagnosis.canGenerateChangeDocuments ? (
              <button
                type="button"
                className="outline-action"
                onClick={() => onNavigate('docs')}
              >
                <FileText size={17} />
                변경신청 패키지 생성
              </button>
            ) : (
              <button
                type="button"
                className="outline-action"
                onClick={() => onNavigate('bills')}
              >
                <UploadCloud size={17} />
                고지서 자료 보완
              </button>
            )}
          </div>
        </div>
        <div className="diagnosis-decision-reasons">
          <strong>왜 이 결론인가요?</strong>
          <ol>
            {decision.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ol>
          <p>
            판단 신뢰도 {diagnosis.dataConfidence} · 데이터 인식률{' '}
            {diagnosis.dataRecognitionRate}%
          </p>
        </div>
      </section>

      <section className="diagnosis-result-grid">
        <article className="diagnosis-result-card">
          <span>현재 요금제</span>
          <strong>{currentPlan.planName}</strong>
          <p>{currentPlan.contractType} {currentPlan.voltageType}</p>
        </article>
        <article className="diagnosis-result-card">
          <span>{decision.candidateLabel}</span>
          <strong>{recommendedPlan.planName}</strong>
          <p>{diagnosis.comparison.reviewReason}</p>
        </article>
        <article className="diagnosis-result-card">
          <span>변경 시 최근 12개월 영향</span>
          <strong>
            {comparison.annualDataAvailable
              ? formatCostImpact(comparison.savingWon, { annual: true })
              : '12개월 연속 자료 부족'}
          </strong>
          {comparison.annualDataAvailable ? (
            <p>
              현재 {formatWon(comparison.currentAnnualWon)} → 비교{' '}
              {formatWon(comparison.candidateAnnualWon)}
            </p>
          ) : (
            <p>최근 12개월의 연속된 고지서 자료를 업로드해 주세요.</p>
          )}
        </article>
        <article className="diagnosis-result-card">
          <span>변경 시 최근 36개월 영향</span>
          <strong>
            {comparison.threeYearDataAvailable
              ? formatCostImpact(comparison.threeYearSavingWon)
              : '36개월 연속 자료 부족'}
          </strong>
          {comparison.threeYearDataAvailable && (
            <p>
              현재 {formatWon(comparison.currentThreeYearWon)} → 비교{' '}
              {formatWon(comparison.candidateThreeYearWon)}
            </p>
          )}
        </article>
        <article className="diagnosis-result-card">
          <span>피크 가정 시 12개월 영향</span>
          <strong>
            {comparison.peakScenarioDataAvailable
              ? formatCostImpact(comparison.peakScenarioSavingWon)
              : '피크 시나리오 자료 부족'}
          </strong>
          {comparison.peakScenarioDataAvailable ? (
            <p>
              현재 {formatWon(comparison.peakScenarioCurrentAnnualWon)} → 비교{' '}
              {formatWon(comparison.peakScenarioCandidateAnnualWon)}
            </p>
          ) : (
            <p>최근 12개월 자료와 유효한 피크 시나리오가 필요합니다.</p>
          )}
        </article>
      </section>

      <section className="panel muted-panel">
        <strong>
          계산 모드: {getCalculationModeLabel(diagnosis.calculationMode)}
        </strong>
        {diagnosis.calculationMode === 'tariffFull' && (
          <p>
            기후환경 {diagnosis.calculationSettings.climateEnvironmentWonPerKwh}원/kWh ·
            연료비조정 {diagnosis.calculationSettings.fuelAdjustmentWonPerKwh}원/kWh ·
            부가세 {diagnosis.calculationSettings.vatPercent}% ·
            전력산업기반기금 {diagnosis.calculationSettings.fundPercent}%
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>요금제 자동 비교 TOP 3</h2>
          <span>{getCalculationModeLabel(diagnosis.calculationMode)}</span>
        </div>
        <PlanCandidateTable candidates={diagnosis.topCandidates} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>계산 근거 분해</h2>
          <span>최근 12개월 기준</span>
        </div>
        {comparison.annualDataAvailable ? (
          <div className="breakdown-grid">
            {comparison.calculationBreakdown.map((row) => (
              <article key={row.label}>
                <span>{row.label}</span>
                <strong className={row.differenceWon >= 0 ? 'positive' : 'danger-text'}>
                  {formatCostImpact(row.differenceWon)}
                </strong>
                <dl>
                  <div>
                    <dt>현재</dt>
                    <dd>{formatWon(row.currentWon)}</dd>
                  </div>
                  <div>
                    <dt>비교</dt>
                    <dd>{formatWon(row.candidateWon)}</dd>
                  </div>
                </dl>
                <p>{row.note}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">최근 12개월 연속 자료가 있어야 계산 근거를 표시할 수 있습니다.</p>
        )}
      </section>

      <section className="diagnosis-note-grid">
        <article>
          <UploadCloud size={22} />
          <strong>마지막 자료</strong>
          <p>{diagnosis.lastUploadLabel}</p>
        </article>
        <article>
          <TrendingDown size={22} />
          <strong>생성 가능 문서</strong>
          <p>{diagnosis.availableDocumentCount}종 패키지</p>
        </article>
        <article>
          <ShieldAlert size={22} />
          <strong>신중 검토 안내</strong>
          <p>{rateChangeCaution}</p>
        </article>
      </section>

      {diagnosis.missingDataNotes.length > 0 && (
        <section className="panel muted-panel">
          <strong>담당자 확인 사항</strong>
          <ul className="diagnosis-note-list">
            {diagnosis.missingDataNotes.map((note) => (
              <li key={note}>
                <ArrowRight size={15} />
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
