import type {
  MonthlyBill,
  MonthlyBillObservedField,
  RatePlan,
} from '../types'

export interface DomainValidationResult {
  valid: boolean
  issues: string[]
}

const maxBillAmountWon = 1_000_000_000_000
const maxUsageKwh = 1_000_000_000
const maxPowerKw = 10_000_000
const maxRateWon = 1_000_000

const observedFields = new Set<MonthlyBillObservedField>([
  'year',
  'month',
  'usageKwh',
  'totalBillWon',
  'appliedPowerKw',
  'maxDemandKw',
  'baseChargeWon',
  'energyChargeWon',
  'powerFactorChargeWon',
  'climateChargeWon',
  'fuelAdjustmentWon',
  'vatWon',
  'fundWon',
])

const isFiniteInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum

const isValidIsoDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

export const validateBillRequiredValues = (value: {
  year: unknown
  month: unknown
  usageKwh: unknown
  totalBillWon: unknown
}): DomainValidationResult => {
  const issues: string[] = []
  if (
    !Number.isInteger(value.year) ||
    !isFiniteInRange(value.year, 2000, 2100)
  ) {
    issues.push('연도는 2000~2100 사이 정수여야 합니다.')
  }
  if (
    !Number.isInteger(value.month) ||
    !isFiniteInRange(value.month, 1, 12)
  ) {
    issues.push('월은 1~12 사이 정수여야 합니다.')
  }
  if (!isFiniteInRange(value.usageKwh, Number.MIN_VALUE, maxUsageKwh)) {
    issues.push('사용량은 0보다 큰 유한한 값이어야 합니다.')
  }
  if (
    !isFiniteInRange(
      value.totalBillWon,
      Number.MIN_VALUE,
      maxBillAmountWon,
    )
  ) {
    issues.push('총 전기요금은 0보다 큰 유한한 값이어야 합니다.')
  }
  return { valid: issues.length === 0, issues }
}

export const validateMonthlyBill = (
  value: unknown,
): DomainValidationResult => {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { valid: false, issues: ['고지서 행 형식이 올바르지 않습니다.'] }
  }
  const bill = value as Record<string, unknown>
  if (typeof bill.id !== 'string' || !bill.id.trim()) {
    issues.push('고지서 행 식별값이 없습니다.')
  }
  issues.push(
    ...validateBillRequiredValues({
      year: bill.year,
      month: bill.month,
      usageKwh: bill.usageKwh,
      totalBillWon: bill.totalBillWon,
    }).issues,
  )
  if (!isFiniteInRange(bill.appliedPowerKw, Number.MIN_VALUE, maxPowerKw)) {
    issues.push('요금적용전력은 0보다 큰 유한한 값이어야 합니다.')
  }
  if (!isFiniteInRange(bill.maxDemandKw, 0, maxPowerKw)) {
    issues.push('최대수요전력은 0 이상의 유한한 값이어야 합니다.')
  }
  const nonNegativeChargeFields = [
    ['baseChargeWon', '기본요금'],
    ['energyChargeWon', '전력량요금'],
    ['climateChargeWon', '기후환경요금'],
    ['vatWon', '부가세'],
    ['fundWon', '전력산업기반기금'],
  ] as const
  for (const [field, label] of nonNegativeChargeFields) {
    if (!isFiniteInRange(bill[field], 0, maxBillAmountWon)) {
      issues.push(`${label}은 0 이상의 유한한 값이어야 합니다.`)
    }
  }
  const signedChargeFields = [
    ['fuelAdjustmentWon', '연료비조정액'],
    ['powerFactorChargeWon', '역률요금'],
  ] as const
  for (const [field, label] of signedChargeFields) {
    if (
      !isFiniteInRange(
        bill[field],
        -maxBillAmountWon,
        maxBillAmountWon,
      )
    ) {
      issues.push(`${label}은 허용 범위의 유한한 값이어야 합니다.`)
    }
  }
  if (typeof bill.note !== 'string') {
    issues.push('고지서 메모 형식이 올바르지 않습니다.')
  }
  if (
    bill.observedFields !== undefined &&
    (!Array.isArray(bill.observedFields) ||
      bill.observedFields.some(
        (field) =>
          typeof field !== 'string' ||
          !observedFields.has(field as MonthlyBillObservedField),
      ))
  ) {
    issues.push('고지서 관측 컬럼 정보가 올바르지 않습니다.')
  }
  return { valid: issues.length === 0, issues }
}

export const isValidMonthlyBill = (value: unknown): value is MonthlyBill =>
  validateMonthlyBill(value).valid

export const validateRatePlan = (value: unknown): DomainValidationResult => {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { valid: false, issues: ['요금제 형식이 올바르지 않습니다.'] }
  }
  const plan = value as Record<string, unknown>
  for (const [field, label] of [
    ['id', '요금제 식별값'],
    ['contractType', '계약종별'],
    ['voltageType', '수전전압'],
    ['planName', '요금제명'],
  ] as const) {
    if (typeof plan[field] !== 'string' || !plan[field].trim()) {
      issues.push(`${label}을 입력해 주세요.`)
    }
  }
  if (
    !isFiniteInRange(plan.baseRateWonPerKw, Number.MIN_VALUE, maxRateWon)
  ) {
    issues.push(`기본요금 단가는 0 초과 ${maxRateWon.toLocaleString('ko-KR')}원 이하로 입력해 주세요.`)
  }
  const seasonRates =
    plan.seasonRates && typeof plan.seasonRates === 'object'
      ? (plan.seasonRates as Record<string, unknown>)
      : null
  for (const [field, label] of [
    ['springAutumn', '봄·가을 전력량요금'],
    ['summer', '여름 전력량요금'],
    ['winter', '겨울 전력량요금'],
  ] as const) {
    if (
      !seasonRates ||
      !isFiniteInRange(seasonRates[field], Number.MIN_VALUE, maxRateWon)
    ) {
      issues.push(`${label}은 0보다 큰 유한한 값이어야 합니다.`)
    }
  }
  for (const [field, label] of [
    ['lightLoadRate', '경부하 단가'],
    ['midLoadRate', '중간부하 단가'],
    ['peakLoadRate', '최대부하 단가'],
  ] as const) {
    const rate = plan[field]
    if (
      rate !== undefined &&
      !isFiniteInRange(rate, 0, maxRateWon)
    ) {
      issues.push(`${label}은 0 이상 ${maxRateWon.toLocaleString('ko-KR')}원 이하로 입력해 주세요.`)
    }
  }
  if (!isValidIsoDate(plan.effectiveFrom)) {
    issues.push('적용일은 실제 존재하는 YYYY-MM-DD 날짜여야 합니다.')
  }
  if (typeof plan.memo !== 'string') {
    issues.push('요금제 메모 형식이 올바르지 않습니다.')
  }
  return { valid: issues.length === 0, issues }
}

export const isValidRatePlan = (value: unknown): value is RatePlan =>
  validateRatePlan(value).valid
