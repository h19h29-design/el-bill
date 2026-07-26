import { useState } from 'react'
import type {
  CalculationSettings,
  CalculationMode,
  RatePlan,
  Season,
} from '../../types'
import { validateRatePlan } from '../../lib/domainValidation'
import {
  defaultCalculationSettings,
  validateCalculationSettings,
} from '../../lib/calculationSettings'

interface RatePlanSettingsProps {
  plans: RatePlan[]
  onPlansChange: (plans: RatePlan[]) => Promise<boolean>
  calculationSettings: CalculationSettings
  onCalculationSettingsChange: (
    settings: CalculationSettings,
  ) => Promise<boolean>
}

const seasonLabels: Record<Season, string> = {
  springAutumn: '봄·가을',
  summer: '여름',
  winter: '겨울',
}

const normalizeTuplePart = (value: string) => value.trim().replace(/\s/g, '')

const hasDuplicateTuple = (plans: RatePlan[]) => {
  const seen = new Set<string>()
  return plans.some((plan) => {
    const key = [plan.contractType, plan.voltageType, plan.planName]
      .map(normalizeTuplePart)
      .join('|')
    if (seen.has(key)) return true
    seen.add(key)
    return false
  })
}

export function RatePlanSettings({
  plans,
  onPlansChange,
  calculationSettings,
  onCalculationSettingsChange,
}: RatePlanSettingsProps) {
  type CalculationFactorField = Exclude<keyof CalculationSettings, 'mode'>
  const [validationMessage, setValidationMessage] = useState('')
  const [invalidPlanField, setInvalidPlanField] = useState<{
    planId: string
    field: string
  } | null>(null)
  const [calculationErrors, setCalculationErrors] = useState<
    Partial<Record<CalculationFactorField, string>>
  >({})
  const [savingCalculationSettings, setSavingCalculationSettings] =
    useState(false)
  const updatePlan = (
    planId: string,
    updater: (plan: RatePlan) => RatePlan,
    field: string,
  ) => {
    const nextPlans = plans.map((plan) => (plan.id === planId ? updater(plan) : plan))
    const nextPlan = nextPlans.find((plan) => plan.id === planId)
    const validation = validateRatePlan(nextPlan)
    if (!validation.valid) {
      setInvalidPlanField({ planId, field })
      setValidationMessage(validation.issues[0] ?? '요금제 값을 확인해 주세요.')
      return
    }
    if (hasDuplicateTuple(nextPlans)) {
      setInvalidPlanField({ planId, field })
      setValidationMessage('계약종별·수전전압·요금제명 조합이 중복됩니다. 기존 요금제와 다른 조합으로 입력해 주세요.')
      return
    }
    setInvalidPlanField(null)
    setValidationMessage('')
    void onPlansChange(nextPlans).catch(() => undefined)
  }

  const addPlan = () => {
    const base = plans[0]
    if (!base) return
    const existingNames = new Set(
      plans
        .filter(
          (plan) =>
            normalizeTuplePart(plan.contractType) === normalizeTuplePart(base.contractType) &&
            normalizeTuplePart(plan.voltageType) === normalizeTuplePart(base.voltageType),
        )
        .map((plan) => normalizeTuplePart(plan.planName)),
    )
    let suffix = 1
    let planName = '사용자 요금제'
    while (existingNames.has(normalizeTuplePart(planName))) {
      suffix += 1
      planName = `사용자 요금제 ${suffix}`
    }
    void onPlansChange([
      ...plans,
      {
        ...base,
        id: `custom-${Date.now()}`,
        planName,
        memo: '설정 화면에서 추가',
      },
    ]).catch(() => undefined)
  }

  const changeCalculationSettings = async (
    nextSettings: CalculationSettings,
  ) => {
    if (savingCalculationSettings) return
    const validation = validateCalculationSettings(nextSettings)
    if (!validation.valid) {
      setCalculationErrors(validation.errors)
      setValidationMessage(Object.values(validation.errors)[0] ?? '')
      return
    }
    setCalculationErrors({})
    setValidationMessage('')
    setSavingCalculationSettings(true)
    const saved = await onCalculationSettingsChange(nextSettings)
      .catch(() => false)
      .finally(() => setSavingCalculationSettings(false))
    if (!saved) {
      setValidationMessage(
        '계산 설정을 저장하지 못해 이전 값으로 유지했습니다.',
      )
    }
  }

  const updateCalculationNumber = (
    field: CalculationFactorField,
    value: string,
  ) => {
    void changeCalculationSettings({
      ...calculationSettings,
      [field]: Number(value),
    })
  }

  const updateCalculationMode = (mode: CalculationMode) => {
    void changeCalculationSettings({ ...calculationSettings, mode })
  }

  return (
    <div className="view-stack">
      <section className="panel muted-panel">
        <strong>계산 및 요금표 관리</strong>
        <p>
          단가는 코드 고정값이 아니라 설정 데이터로 관리합니다. 실제 계약·제출 전에는 최신 한전 고시 단가를 확인해야 합니다.
        </p>
      </section>
      <section className="panel calculation-settings-panel">
        <div className="panel-title">
          <h2>계산 모드</h2>
          <button
            type="button"
            className="secondary-button small"
            disabled={savingCalculationSettings}
            onClick={() =>
              void changeCalculationSettings(defaultCalculationSettings)
            }
          >
            계산 설정 초기화
          </button>
        </div>
        <fieldset className="calculation-mode-options">
          <legend>진단 계산 방식</legend>
          {[
            ['billDelta', '고지서 기반 차액 추정'],
            ['tariffFull', '요금표 기반 전체 추정'],
          ].map(([mode, label]) => (
            <label key={mode}>
              <input
                aria-label={label}
                type="radio"
                name="calculation-mode"
                value={mode}
                checked={calculationSettings.mode === mode}
                disabled={savingCalculationSettings}
                onChange={() => updateCalculationMode(mode as CalculationMode)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="calculation-factor-grid">
          <label>
            기후환경요금 단가
            <span className="input-with-unit">
              <input
                aria-label="기후환경요금 단가(원/kWh)"
                aria-invalid={Boolean(
                  calculationErrors.climateEnvironmentWonPerKwh,
                )}
                aria-describedby={[
                  'climate-environment-help',
                  calculationErrors.climateEnvironmentWonPerKwh
                    ? 'climate-environment-error'
                    : '',
                ].filter(Boolean).join(' ')}
                type="number"
                step="0.1"
                min="0"
                max="100"
                disabled={savingCalculationSettings}
                value={calculationSettings.climateEnvironmentWonPerKwh}
                onChange={(event) =>
                  updateCalculationNumber(
                    'climateEnvironmentWonPerKwh',
                    event.target.value,
                  )
                }
              />
              <span>원/kWh</span>
            </span>
            <span id="climate-environment-help" className="helper-text">
              0~100원/kWh 범위
            </span>
            {calculationErrors.climateEnvironmentWonPerKwh && (
              <span id="climate-environment-error" className="field-error">
                {calculationErrors.climateEnvironmentWonPerKwh}
              </span>
            )}
          </label>
          <label>
            연료비조정 단가
            <span className="input-with-unit">
              <input
                aria-label="연료비조정 단가(원/kWh)"
                aria-invalid={Boolean(
                  calculationErrors.fuelAdjustmentWonPerKwh,
                )}
                aria-describedby={[
                  'fuel-adjustment-help',
                  calculationErrors.fuelAdjustmentWonPerKwh
                    ? 'fuel-adjustment-error'
                    : '',
                ].filter(Boolean).join(' ')}
                type="number"
                step="0.1"
                min="-100"
                max="100"
                disabled={savingCalculationSettings}
                value={calculationSettings.fuelAdjustmentWonPerKwh}
                onChange={(event) =>
                  updateCalculationNumber(
                    'fuelAdjustmentWonPerKwh',
                    event.target.value,
                  )
                }
              />
              <span>원/kWh</span>
            </span>
            <span id="fuel-adjustment-help" className="helper-text">
              -100~100원/kWh 범위
            </span>
            {calculationErrors.fuelAdjustmentWonPerKwh && (
              <span id="fuel-adjustment-error" className="field-error">
                {calculationErrors.fuelAdjustmentWonPerKwh}
              </span>
            )}
          </label>
          <label>
            부가세율
            <span className="input-with-unit">
              <input
                aria-label="부가세율(%)"
                aria-invalid={Boolean(calculationErrors.vatPercent)}
                aria-describedby={[
                  'vat-percent-help',
                  calculationErrors.vatPercent ? 'vat-percent-error' : '',
                ].filter(Boolean).join(' ')}
                type="number"
                step="0.1"
                min="0"
                max="100"
                disabled={savingCalculationSettings}
                value={calculationSettings.vatPercent}
                onChange={(event) =>
                  updateCalculationNumber('vatPercent', event.target.value)
                }
              />
              <span>%</span>
            </span>
            <span id="vat-percent-help" className="helper-text">
              0~100% 범위
            </span>
            {calculationErrors.vatPercent && (
              <span id="vat-percent-error" className="field-error">
                {calculationErrors.vatPercent}
              </span>
            )}
          </label>
          <label>
            전력산업기반기금 비율
            <span className="input-with-unit">
              <input
                aria-label="전력산업기반기금 비율(%)"
                aria-invalid={Boolean(calculationErrors.fundPercent)}
                aria-describedby={[
                  'fund-percent-help',
                  calculationErrors.fundPercent ? 'fund-percent-error' : '',
                ].filter(Boolean).join(' ')}
                type="number"
                step="0.1"
                min="0"
                max="100"
                disabled={savingCalculationSettings}
                value={calculationSettings.fundPercent}
                onChange={(event) =>
                  updateCalculationNumber('fundPercent', event.target.value)
                }
              />
              <span>%</span>
            </span>
            <span id="fund-percent-help" className="helper-text">
              0~100% 범위
            </span>
            {calculationErrors.fundPercent && (
              <span id="fund-percent-error" className="field-error">
                {calculationErrors.fundPercent}
              </span>
            )}
          </label>
        </div>
        <p className="helper-text">
          보정계수는 요금표 기반 전체 추정에만 적용됩니다.
        </p>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>학교용 요금제</h2>
          <button type="button" className="primary-button small" onClick={addPlan}>
            요금제 추가
          </button>
        </div>
        <div className="rate-settings-list">
          {plans.map((plan) => (
            <article key={plan.id} className="rate-setting-row">
              <div className="rate-setting-main">
                <input
                  value={plan.contractType}
                  aria-label="계약종별"
                  onChange={(event) =>
                    updatePlan(plan.id, (current) => ({
                      ...current,
                      contractType: event.target.value,
                    }), 'contractType')
                  }
                />
                <input
                  value={plan.voltageType}
                  aria-label="수전전압"
                  onChange={(event) =>
                    updatePlan(plan.id, (current) => ({
                      ...current,
                      voltageType: event.target.value,
                    }), 'voltageType')
                  }
                />
                <input
                  value={plan.planName}
                  aria-label="요금제명"
                  onChange={(event) =>
                    updatePlan(plan.id, (current) => ({
                      ...current,
                      planName: event.target.value,
                    }), 'planName')
                  }
                />
                <label>
                  기본요금
                  <input
                    type="number"
                    aria-label="기본요금"
                    min={0.01}
                    max={1_000_000}
                    aria-invalid={
                      invalidPlanField?.planId === plan.id &&
                      invalidPlanField.field === 'baseRateWonPerKw'
                    }
                    value={plan.baseRateWonPerKw}
                    onChange={(event) =>
                      updatePlan(plan.id, (current) => ({
                        ...current,
                        baseRateWonPerKw: Number(event.target.value),
                      }), 'baseRateWonPerKw')
                    }
                  />
                </label>
              </div>
              <div className="season-rate-grid">
                {(Object.keys(seasonLabels) as Season[]).map((season) => (
                  <label key={season}>
                    {seasonLabels[season]}
                    <input
                      type="number"
                      aria-label={seasonLabels[season]}
                      step="0.1"
                      min={0.01}
                      max={1_000_000}
                      aria-invalid={
                        invalidPlanField?.planId === plan.id &&
                        invalidPlanField.field === season
                      }
                      value={plan.seasonRates[season]}
                      onChange={(event) =>
                        updatePlan(plan.id, (current) => ({
                          ...current,
                          seasonRates: {
                            ...current.seasonRates,
                            [season]: Number(event.target.value),
                          },
                        }), season)
                      }
                    />
                  </label>
                ))}
                <label>
                  적용일
                  <input
                    type="date"
                    value={plan.effectiveFrom}
                    onChange={(event) =>
                    updatePlan(plan.id, (current) => ({
                      ...current,
                      effectiveFrom: event.target.value,
                    }), 'effectiveFrom')
                    }
                  />
                </label>
              </div>
              <textarea
                value={plan.memo}
                aria-label="요금제 메모"
                onChange={(event) =>
                  updatePlan(plan.id, (current) => ({
                    ...current,
                    memo: event.target.value,
                  }), 'memo')
                }
              />
            </article>
          ))}
        </div>
      </section>
      {validationMessage && (
        <p className="status-line" role="status">
          {validationMessage}
        </p>
      )}
    </div>
  )
}
