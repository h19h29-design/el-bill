import { useRef, useState } from 'react'
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
  analysisYear: z.coerce.number().int().min(2020).max(2035),
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

const comparisonTabs = [
  ['12', '최근 12개월'],
  ['36', '최근 3년'],
  ['peak', '피크 예상 시나리오'],
] as const

type ComparisonTab = (typeof comparisonTabs)[number][0]

export function RateSimulator({
  currentPlan,
  candidatePlan,
  candidates,
  comparison,
  calculationSettings,
  scenario,
  onScenarioChange,
}: RateSimulatorProps) {
  const [tab, setTab] = useState<ComparisonTab>('12')
  const [scenarioErrors, setScenarioErrors] = useState<
    Partial<Record<keyof PeakScenario, string>>
  >({})
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const form = useForm<PeakScenario>({
    defaultValues: scenario,
  })
  const submitScenario = async (values: PeakScenario) => {
    const parsed = scenarioSchema.safeParse(values)
    if (!parsed.success) {
      const errors: Partial<Record<keyof PeakScenario, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof PeakScenario | undefined
        if (!field || errors[field]) continue
        errors[field] =
          field === 'analysisYear'
            ? '분석 기준 연도는 2020~2035 사이로 입력해 주세요.'
            : field === 'expectedPeakKw' || field === 'targetPeakKw'
              ? '피크 입력값은 0보다 커야 합니다.'
              : '증가율 입력값은 -30~100% 사이여야 합니다.'
      }
      setScenarioErrors(errors)
      return
    }
    setScenarioErrors({})
    await onScenarioChange({
      ...scenario,
      ...parsed.data,
    }).catch(() => undefined)
  }
  const reviewOnlyCandidate = candidates.find(
    (candidate) => candidate.candidatePlanId === candidatePlan.id,
  )
  const selectedMetrics =
    tab === '36'
      ? {
          currentWon: comparison.currentThreeYearWon,
          candidateWon: comparison.candidateThreeYearWon,
          savingWon: comparison.threeYearSavingWon,
          available: comparison.threeYearDataAvailable,
          currentLabel: `최근 3년 현재안 (${currentPlan.planName})`,
          candidateLabel: `최근 3년 추천안 (${candidatePlan.planName})`,
          summaryLabel: '최근 3년 절감액',
        }
      : tab === 'peak'
        ? {
            currentWon: comparison.peakScenarioCurrentAnnualWon,
            candidateWon: comparison.peakScenarioCandidateAnnualWon,
            savingWon: comparison.peakScenarioSavingWon,
            available: comparison.peakScenarioDataAvailable,
            currentLabel: `피크 시나리오 현재안 (${currentPlan.planName})`,
            candidateLabel: `피크 시나리오 추천안 (${candidatePlan.planName})`,
            summaryLabel: '피크 시나리오 절감액',
          }
        : {
            currentWon: comparison.currentAnnualWon,
            candidateWon: comparison.candidateAnnualWon,
            savingWon: comparison.savingWon,
            available: comparison.annualDataAvailable,
            currentLabel: `최근 12개월 현재안 (${currentPlan.planName})`,
            candidateLabel: `최근 12개월 추천안 (${candidatePlan.planName})`,
            summaryLabel: '최근 12개월 절감액',
          }

  if (
    !comparison.annualDataAvailable ||
    reviewOnlyCandidate?.recommendation === '추가 검토 필요'
  ) {
    return (
      <section className="document-block-notice" role="status">
        <AlertTriangle size={22} />
        <div>
          <strong>요금제 비교 보류</strong>
          <p>{reviewOnlyCandidate?.basis ?? comparison.basis}</p>
        </div>
      </section>
    )
  }

  return (
    <div className="view-stack">
      <section className="tabs" role="tablist" aria-label="요금 비교 범위">
        {comparisonTabs.map(([key, label], index) => (
          <button
            key={key}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            id={`rate-simulator-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls="rate-simulator-panel"
            tabIndex={tab === key ? 0 : -1}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
            onKeyDown={(event) => {
              const lastIndex = comparisonTabs.length - 1
              let nextIndex: number | null = null
              if (event.key === 'ArrowRight') {
                nextIndex = index === lastIndex ? 0 : index + 1
              } else if (event.key === 'ArrowLeft') {
                nextIndex = index === 0 ? lastIndex : index - 1
              } else if (event.key === 'Home') {
                nextIndex = 0
              } else if (event.key === 'End') {
                nextIndex = lastIndex
              }
              if (nextIndex === null) return
              event.preventDefault()
              setTab(comparisonTabs[nextIndex][0])
              tabRefs.current[nextIndex]?.focus()
            }}
          >
            {label}
          </button>
        ))}
      </section>
      <p className="mode-badge">
        계산 모드: {getCalculationModeLabel(calculationSettings.mode)}
      </p>

      {!selectedMetrics.available ? (
        <section
          id="rate-simulator-panel"
          className="document-block-notice"
          role="tabpanel"
          aria-labelledby={`rate-simulator-tab-${tab}`}
        >
          <AlertTriangle size={22} />
          <div>
            <strong>선택 기간 자료 부족</strong>
            <p>
              {tab === '36'
                ? '최근 36개월의 연속된 고지서 자료가 부족합니다.'
                : tab === 'peak'
                  ? '최근 12개월의 연속된 고지서와 유효한 피크 시나리오가 필요합니다.'
                  : '최근 12개월의 연속된 고지서 자료가 부족합니다.'}
            </p>
          </div>
        </section>
      ) : (
        <section
          id="rate-simulator-panel"
          className="comparison-grid"
          role="tabpanel"
          aria-labelledby={`rate-simulator-tab-${tab}`}
        >
        <article className="comparison-card blue">
          <span>{selectedMetrics.currentLabel}</span>
          <strong>{formatWon(selectedMetrics.currentWon)}</strong>
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
          <span>{selectedMetrics.candidateLabel}</span>
          <strong>{formatWon(selectedMetrics.candidateWon)}</strong>
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
          <span>{selectedMetrics.summaryLabel}</span>
          <strong>{formatWon(selectedMetrics.savingWon)}</strong>
          <dl>
            <div>
              <dt>현재안 대비</dt>
              <dd>
                {selectedMetrics.currentWon
                  ? `${((selectedMetrics.savingWon / selectedMetrics.currentWon) * 100).toFixed(1)}%`
                  : '산정 불가'}
              </dd>
            </div>
            <div>
              <dt>12개월 기준</dt>
              <dd>
                {comparison.annualDataAvailable
                  ? formatWon(comparison.savingWon)
                  : '자료 부족'}
              </dd>
            </div>
            <div>
              <dt>피크 반영</dt>
              <dd>
                {comparison.peakScenarioDataAvailable
                  ? formatWon(comparison.peakScenarioSavingWon)
                  : '자료 부족'}
              </dd>
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
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>시나리오 설정</h2>
          <span>{tab === 'peak' ? '피크 민감도 반영' : '선택 범위 기준 추정'}</span>
        </div>
        <form
          className="scenario-form"
          noValidate
          onSubmit={form.handleSubmit(submitScenario)}
        >
          <label>
            예상 최대수요전력(kW)
            <input
              type="number"
              min={1}
              aria-invalid={Boolean(scenarioErrors.expectedPeakKw)}
              aria-describedby={
                scenarioErrors.expectedPeakKw ? 'scenario-validation-status' : undefined
              }
              {...form.register('expectedPeakKw')}
            />
          </label>
          <label>
            사용량 증가율(%)
            <input
              type="number"
              min={-30}
              max={100}
              aria-invalid={Boolean(scenarioErrors.usageIncreasePercent)}
              aria-describedby={
                scenarioErrors.usageIncreasePercent ? 'scenario-validation-status' : undefined
              }
              {...form.register('usageIncreasePercent')}
            />
          </label>
          <label>
            여름 증가율(%)
            <input
              type="number"
              min={-30}
              max={100}
              aria-invalid={Boolean(scenarioErrors.summerIncreasePercent)}
              aria-describedby={
                scenarioErrors.summerIncreasePercent ? 'scenario-validation-status' : undefined
              }
              {...form.register('summerIncreasePercent')}
            />
          </label>
          <label>
            겨울 증가율(%)
            <input
              type="number"
              min={-30}
              max={100}
              aria-invalid={Boolean(scenarioErrors.winterIncreasePercent)}
              aria-describedby={
                scenarioErrors.winterIncreasePercent ? 'scenario-validation-status' : undefined
              }
              {...form.register('winterIncreasePercent')}
            />
          </label>
          <label>
            분석 기준 연도
            <input
              type="number"
              min={2020}
              max={2035}
              aria-invalid={Boolean(scenarioErrors.analysisYear)}
              aria-describedby={
                scenarioErrors.analysisYear ? 'scenario-validation-status' : undefined
              }
              {...form.register('analysisYear')}
            />
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
        {Object.keys(scenarioErrors).length > 0 && (
          <p id="scenario-validation-status" className="status-line" role="status">
            {Object.values(scenarioErrors)[0]} 입력값을 확인한 뒤 다시 시도해 주세요.
          </p>
        )}
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
