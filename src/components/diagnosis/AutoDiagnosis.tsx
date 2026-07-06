import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  Gauge,
  PlayCircle,
  ShieldAlert,
  TrendingDown,
  UploadCloud,
} from 'lucide-react'
import type { AutoDiagnosisResult, ViewKey } from '../../types'
import { formatWon } from '../../lib/calculations'
import { rateChangeCaution } from '../../lib/documentTemplates'
import { PlanCandidateTable } from './PlanCandidateTable'

interface AutoDiagnosisProps {
  diagnosis: AutoDiagnosisResult
  onNavigate: (view: ViewKey) => void
}

const steps = [
  ['자료 업로드', '한전고지서·파워플래너 파일'],
  ['학교정보 확인', '계약종별·전압·현재 요금제'],
  ['요금제 자동 비교', '학교용 후보 전체 비교'],
  ['피크관리 방안 생성', '최대부하 시간대 운영안'],
  ['변경신청 패키지 생성', '계획안·공문·신청서'],
] as const

export function AutoDiagnosis({ diagnosis, onNavigate }: AutoDiagnosisProps) {
  const comparison = diagnosis.comparison
  const judgementClass =
    diagnosis.finalJudgement === '변경 추천'
      ? 'good'
      : diagnosis.finalJudgement === '유지 추천'
        ? 'hold'
        : 'review'

  return (
    <div className="view-stack">
      <section className="diagnosis-hero">
        <div>
          <span className="flow-label">자동진단 흐름</span>
          <h2>전기요금 자동진단 시작</h2>
          <p>
            자료 업로드부터 추천 요금제, 피크관리 운영안, 변경신청 패키지까지 한 흐름으로 점검합니다.
          </p>
        </div>
        <button
          type="button"
          className="primary-button diagnosis-start"
          onClick={() => onNavigate('bills')}
        >
          <PlayCircle size={20} />
          자료 업로드부터 시작
        </button>
      </section>

      <section className="diagnosis-stepper" aria-label="자동진단 단계">
        {steps.map(([title, description], index) => (
          <article key={title} className={index < 3 || diagnosis.completed ? 'complete' : ''}>
            <strong>{index + 1}</strong>
            <span>{title}</span>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="diagnosis-result-grid">
        <article className="diagnosis-result-card wide">
          <div className="result-heading">
            <ClipboardCheck size={28} />
            <div>
              <span>자동 분석 완료</span>
              <strong>{diagnosis.completed ? '진단 가능' : '추가 자료 필요'}</strong>
            </div>
          </div>
          <p>{diagnosis.judgementBasis}</p>
          <div className="diagnosis-actions">
            <button type="button" className="outline-action" onClick={() => onNavigate('peak')}>
              <Gauge size={17} />
              피크관리 방안 보기
            </button>
            <button type="button" className="outline-action" onClick={() => onNavigate('docs')}>
              <FileText size={17} />
              변경신청 패키지 생성
            </button>
          </div>
        </article>
        <article className="diagnosis-result-card">
          <span>현재 요금제</span>
          <strong>{diagnosis.currentPlan.planName}</strong>
          <p>{diagnosis.currentPlan.contractType} {diagnosis.currentPlan.voltageType}</p>
        </article>
        <article className="diagnosis-result-card">
          <span>추천 요금제</span>
          <strong>{diagnosis.recommendedPlan.planName}</strong>
          <p>{diagnosis.comparison.reviewReason}</p>
        </article>
        <article className="diagnosis-result-card">
          <span>최근 12개월 절감액</span>
          <strong>{formatWon(comparison.savingWon)}</strong>
          <p>고지서 기반 차액 추정</p>
        </article>
        <article className="diagnosis-result-card">
          <span>최근 3년 절감액</span>
          <strong>{formatWon(comparison.threeYearSavingWon)}</strong>
          <p>최근 최대 36개월 반영</p>
        </article>
        <article className="diagnosis-result-card">
          <span>피크 반영 결과</span>
          <strong>{formatWon(comparison.peakScenarioSavingWon)}</strong>
          <p>예상 피크값 반영 후 절감액</p>
        </article>
        <article className={`diagnosis-result-card judgement ${judgementClass}`}>
          <span>최종 판단</span>
          <strong>{diagnosis.finalJudgement}</strong>
          <p>{diagnosis.dataConfidence} · 인식률 {diagnosis.dataRecognitionRate}%</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>요금제 자동 비교 TOP 3</h2>
          <span>{diagnosis.calculationMode === 'billDelta' ? '고지서 기반 차액 추정' : '요금표 기반 전체 추정'}</span>
        </div>
        <PlanCandidateTable candidates={diagnosis.topCandidates} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>계산 근거 분해</h2>
          <span>최근 12개월 기준</span>
        </div>
        <div className="breakdown-grid">
          {comparison.calculationBreakdown.map((row) => (
            <article key={row.label}>
              <span>{row.label}</span>
              <strong className={row.differenceWon >= 0 ? 'positive' : 'danger-text'}>
                {formatWon(row.differenceWon)}
              </strong>
              <dl>
                <div>
                  <dt>현재</dt>
                  <dd>{formatWon(row.currentWon)}</dd>
                </div>
                <div>
                  <dt>추천</dt>
                  <dd>{formatWon(row.candidateWon)}</dd>
                </div>
              </dl>
              <p>{row.note}</p>
            </article>
          ))}
        </div>
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
