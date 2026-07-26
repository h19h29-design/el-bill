import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AlertTriangle, CheckCircle2, TrendingDown } from 'lucide-react'
import type {
  CalculationSettings,
  PeakScenario,
  PlanCandidateComparison,
  RatePlan,
} from '../../types'
import { formatWon } from '../../lib/calculations'
import { getCalculationModeLabel } from '../../lib/calculationSettings'
import { rateChangeCaution } from '../../lib/documentTemplates'
import { PlanCandidateTable } from '../diagnosis/PlanCandidateTable'

const scenarioSchema = z.object({
  targetPeakKw: z.coerce.number().min(1),
  expectedPeakKw: z.coerce.number().min(1),
  usageIncreasePercent: z.coerce.number().min(-30).max(100),
  summerIncreasePercent: z.coerce.number().min(-30).max(100),
  winterIncreasePercent: z.coerce.number().min(-30).max(100),
  analysisYear: z.coerce.number().min(2020).max(2035),
  memo: z.string(),
})

interface RateSimulatorProps {
  currentPlan: RatePlan
  candidatePlan: RatePlan
  candidates: PlanCandidateComparison[]
  comparison: PlanCandidateComparison
  calculationSettings: CalculationSettings
  scenario: PeakScenario
  onScenarioChange: (scenario: PeakScenario) => Promise<boolean>
}

export function RateSimulator({
  currentPlan,
  candidatePlan,
  candidates,
  comparison,
  calculationSettings,
  scenario,
  onScenarioChange,
}: RateSimulatorProps) {
  const [tab, setTab] = useState<'12' | '36' | 'peak'>('12')
  const form = useForm<PeakScenario>({
    defaultValues: scenario,
  })
  const reviewOnlyCandidate = candidates.find(
    (candidate) => candidate.candidatePlanId === candidatePlan.id,
  )

  if (reviewOnlyCandidate?.recommendation === '추가 검토 필요') {
    return (
      <section className="document-block-notice" role="status">
        <AlertTriangle size={22} />
        <div>
          <strong>요금제 비교 보류</strong>
          <p>{reviewOnlyCandidate.basis}</p>
        </div>
      </section>
    )
  }

  return (
    <div className="view-stack">
      <section className="tabs" aria-label="요금 비교 범위">
        {[
          ['12', '최근 12개월'],
          ['36', '최근 3년'],
          ['peak', '피크 예상 시나리오'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key as typeof tab)}
          >
            {label}
          </button>
        ))}
      </section>
      <p className="mode-badge">
        계산 모드: {getCalculationModeLabel(calculationSettings.mode)}
      </p>

      <section className="comparison-grid">
        <article className="comparison-card blue">
          <span>현재 요금제 ({currentPlan.planName})</span>
          <strong>{formatWon(comparison.currentAnnualWon)}</strong>
          <dl>
            <div>
              <dt>기본요금</dt>
              <dd>{currentPlan.baseRateWonPerKw.toLocaleString('ko-KR')}원/kW</dd>
            </div>
            <div>
              <dt>봄·가을</dt>
              <dd>{currentPlan.seasonRates.springAutumn}원/kWh</dd>
            </div>
          </dl>
        </article>
        <article className="comparison-card teal">
          <span>추천안 ({candidatePlan.planName})</span>
          <strong>{formatWon(comparison.candidateAnnualWon)}</strong>
          <dl>
            <div>
              <dt>기본요금</dt>
              <dd>{candidatePlan.baseRateWonPerKw.toLocaleString('ko-KR')}원/kW</dd>
            </div>
            <div>
              <dt>봄·가을</dt>
              <dd>{candidatePlan.seasonRates.springAutumn}원/kWh</dd>
            </div>
          </dl>
        </article>
        <article className="comparison-card summary">
          <span>비교 결과 요약</span>
          <strong>{formatWon(comparison.savingWon)}</strong>
          <dl>
            <div>
              <dt>절감률</dt>
              <dd>{(comparison.savingRate * 100).toFixed(1)}%</dd>
            </div>
            <div>
              <dt>3년 누적</dt>
              <dd>{formatWon(comparison.threeYearSavingWon)}</dd>
            </div>
            <div>
              <dt>5년 누적</dt>
              <dd>{formatWon(comparison.fiveYearSavingWon)}</dd>
            </div>
          </dl>
          <p className="recommendation">
            {comparison.recommendation === '변경 추천' ? (
              <CheckCircle2 size={18} />
            ) : (
              <AlertTriangle size={18} />
            )}
            {comparison.recommendation}
          </p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>시나리오 설정</h2>
          <span>{tab === 'peak' ? '피크 민감도 반영' : '선택 범위 기준 추정'}</span>
        </div>
        <form
          className="scenario-form"
          onSubmit={form.handleSubmit((values) => {
            void onScenarioChange({
              ...scenario,
              ...scenarioSchema.parse(values),
            }).catch(() => undefined)
          })}
        >
          <label>
            예상 최대수요전력(kW)
            <input type="number" {...form.register('expectedPeakKw')} />
          </label>
          <label>
            사용량 증가율(%)
            <input type="number" {...form.register('usageIncreasePercent')} />
          </label>
          <label>
            여름 증가율(%)
            <input type="number" {...form.register('summerIncreasePercent')} />
          </label>
          <label>
            겨울 증가율(%)
            <input type="number" {...form.register('winterIncreasePercent')} />
          </label>
          <label>
            분석 기준 연도
            <input type="number" {...form.register('analysisYear')} />
          </label>
          <label className="wide-field">
            EHP 증설 메모
            <input {...form.register('memo')} />
          </label>
          <button type="submit" className="primary-button">
            <TrendingDown size={17} />
            시뮬레이션 설정
          </button>
        </form>
        <p className="warning-note">
          {rateChangeCaution} 본 결과는 학교 내부 진단용 추정입니다.
        </p>
      </section>

      <section className="panel muted-panel">
        <strong>판정 근거</strong>
        <p>{comparison.basis}</p>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>자동 비교 후보 TOP 3</h2>
          <span>현재 계약종별·수전전압 우선</span>
        </div>
        <PlanCandidateTable candidates={candidates} />
      </section>
    </div>
  )
}
