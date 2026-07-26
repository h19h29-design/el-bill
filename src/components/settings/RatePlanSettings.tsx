import { useState } from 'react'
import type {
  CalculationSettings,
  CalculationMode,
  RatePlan,
  Season,
} from '../../types'
import {
  validateRatePlanCollection,
} from '../../lib/domainValidation'
import {
  defaultCalculationSettings,
  validateCalculationSettings,
} from '../../lib/calculationSettings'
import {
  applyCalculationSettingsIntent,
  applyRatePlanIntent,
  type CalculationSettingsIntent,
  type RatePlanIntent,
  type RatePlanPatch,
} from '../../lib/persistedIntents'

interface RatePlanSettingsProps {
  plans: RatePlan[]
  onPlansChange: (intent: RatePlanIntent) => Promise<boolean>
  calculationSettings: CalculationSettings
  onCalculationSettingsChange: (
    intent: CalculationSettingsIntent,
  ) => Promise<boolean>
}

const seasonLabels: Record<Season, string> = {
  springAutumn: '봄·가을',
  summer: '여름',
  winter: '겨울',
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
    patch: RatePlanPatch,
    field: string,
  ) => {
    const intent = { type: 'patch', planId, patch } as const
    try {
      applyRatePlanIntent(plans, intent)
    } catch (error) {
      setInvalidPlanField({ planId, field })
      setValidationMessage(
        error instanceof Error ? error.message : '요금제 값을 확인해 주세요.',
      )
      return
    }
    setInvalidPlanField(null)
    setValidationMessage('')
    void onPlansChange(intent)
      .then((saved) => {
        if (!saved) {
          setValidationMessage(
            '요금제를 저장하지 못해 이전 값으로 유지했습니다.',
          )
        }
      })
      .catch(() => undefined)
  }

  const addPlan = () => {
    const intent = { type: 'add' } as const
    try {
      applyRatePlanIntent(plans, intent)
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : '요금제 값을 확인해 주세요.',
      )
      return
    }
    setValidationMessage('')
    void onPlansChange(intent)
      .then((saved) => {
        if (!saved) {
          setValidationMessage(
            '요금제를 저장하지 못해 이전 값으로 유지했습니다.',
          )
        }
      })
      .catch(() => undefined)
  }

  const changeCalculationSettings = async (
    intent: CalculationSettingsIntent,
  ) => {
    if (savingCalculationSettings) return
    let nextSettings: CalculationSettings
    try {
      nextSettings = applyCalculationSettingsIntent(
        calculationSettings,
        intent,
      )
    } catch {
      nextSettings =
        intent.type === 'reset'
          ? defaultCalculationSettings
          : { ...calculationSettings, ...intent.patch }
    }
    const validation = validateCalculationSettings(nextSettings)
    if (!validation.valid) {
      setCalculationErrors(validation.errors)
      setValidationMessage(Object.values(validation.errors)[0] ?? '')
      return
    }
    setCalculationErrors({})
    setValidationMessage('')
    setSavingCalculationSettings(true)
    const saved = await onCalculationSettingsChange(intent)
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
      type: 'patch',
      patch: { [field]: Number(value) },
    })
  }

  const updateCalculationMode = (mode: CalculationMode) => {
    void changeCalculationSettings({ type: 'patch', patch: { mode } })
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
              void changeCalculationSettings({ type: 'reset' })
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
          {plans.map((plan, index) => (
            <article key={`${plan.id}-${index}`} className="rate-setting-row">
              <div className="rate-setting-main">
                <input
                  value={plan.contractType}
                  aria-label="계약종별"
                  aria-invalid={
                    invalidPlanField?.planId === plan.id &&
                    invalidPlanField.field === 'contractType'
                  }
                  onChange={(event) =>
                    updatePlan(
                      plan.id,
                      { contractType: event.target.value },
                      'contractType',
                    )
                  }
                />
                <input
                  value={plan.voltageType}
                  aria-label="수전전압"
                  aria-invalid={
                    invalidPlanField?.planId === plan.id &&
                    invalidPlanField.field === 'voltageType'
                  }
                  onChange={(event) =>
                    updatePlan(
                      plan.id,
                      { voltageType: event.target.value },
                      'voltageType',
                    )
                  }
                />
                <input
                  value={plan.planName}
                  aria-label="요금제명"
                  aria-invalid={
                    invalidPlanField?.planId === plan.id &&
                    invalidPlanField.field === 'planName'
                  }
                  onChange={(event) =>
                    updatePlan(
                      plan.id,
                      { planName: event.target.value },
                      'planName',
                    )
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
                      updatePlan(
                        plan.id,
                        { baseRateWonPerKw: Number(event.target.value) },
                        'baseRateWonPerKw',
                      )
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
                        updatePlan(
                          plan.id,
                          {
                            seasonRates: {
                              [season]: Number(event.target.value),
                            },
                          },
                          season,
                        )
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
                      updatePlan(
                        plan.id,
                        { effectiveFrom: event.target.value },
                        'effectiveFrom',
                      )
                    }
                  />
                </label>
              </div>
              <textarea
                value={plan.memo}
                aria-label="요금제 메모"
                onChange={(event) =>
                  updatePlan(plan.id, { memo: event.target.value }, 'memo')
                }
              />
            </article>
          ))}
        </div>
      </section>
      {(validationMessage ||
        !validateRatePlanCollection(plans).valid) && (
        <p className="status-line" role="status">
          {validationMessage ||
            validateRatePlanCollection(plans).issues[0]}
        </p>
      )}
    </div>
  )
}
