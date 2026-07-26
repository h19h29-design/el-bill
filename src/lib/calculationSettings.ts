import type { CalculationSettings } from '../types'
import type { CalculationMode } from '../types'

export const defaultCalculationSettings: CalculationSettings = {
  mode: 'billDelta',
  climateEnvironmentWonPerKwh: 9,
  fuelAdjustmentWonPerKwh: -5,
  vatPercent: 10,
  fundPercent: 3.7,
}

export const getCalculationModeLabel = (mode: CalculationMode) =>
  mode === 'tariffFull'
    ? '요금표 기반 전체 추정'
    : '고지서 기반 차액 추정'

export type CalculationSettingsErrors = Partial<
  Record<keyof CalculationSettings, string>
>

const finiteInRange = (
  value: number,
  minimum: number,
  maximum: number,
) => Number.isFinite(value) && value >= minimum && value <= maximum

export const validateCalculationSettings = (
  settings: CalculationSettings,
): { valid: boolean; errors: CalculationSettingsErrors } => {
  const errors: CalculationSettingsErrors = {}
  if (settings.mode !== 'billDelta' && settings.mode !== 'tariffFull') {
    errors.mode = '계산 모드를 선택해 주세요.'
  }
  if (!finiteInRange(settings.climateEnvironmentWonPerKwh, 0, 100)) {
    errors.climateEnvironmentWonPerKwh =
      '기후환경요금은 0~100원/kWh 범위로 입력해 주세요.'
  }
  if (!finiteInRange(settings.fuelAdjustmentWonPerKwh, -100, 100)) {
    errors.fuelAdjustmentWonPerKwh =
      '연료비조정액은 -100~100원/kWh 범위로 입력해 주세요.'
  }
  if (!finiteInRange(settings.vatPercent, 0, 100)) {
    errors.vatPercent = '부가세율은 0~100% 범위로 입력해 주세요.'
  }
  if (!finiteInRange(settings.fundPercent, 0, 100)) {
    errors.fundPercent = '전력산업기반기금 비율은 0~100% 범위로 입력해 주세요.'
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

export const isCalculationSettings = (
  value: unknown,
): value is CalculationSettings => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as CalculationSettings
  return validateCalculationSettings(candidate).valid
}
