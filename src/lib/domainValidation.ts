import type {
  MonthlyBill,
  MonthlyBillObservedField,
  PeakScenario,
  RatePlan,
  SchoolProfile,
} from '../types'
import { normalizeEhpGroupCount } from './peakOperations'

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

const requiredProfileStringFields = [
  ['schoolName', '학교명'],
  ['displaySchoolName', '화면 표시명'],
  ['customerNumber', '고객번호'],
  ['address', '전기사용장소'],
  ['kepcoBranch', '한전 지사'],
  ['contractType', '계약종별'],
  ['voltageType', '수전전압'],
  ['currentPlan', '현재 요금제'],
  ['managerName', '담당자명'],
  ['managerPhone', '담당자 연락처'],
] as const

export const validateSchoolProfile = (
  value: unknown,
): DomainValidationResult => {
  if (!value || typeof value !== 'object') {
    return {
      valid: false,
      issues: ['학교 프로필 형식이 올바르지 않습니다.'],
    }
  }
  const profile = value as Record<string, unknown>
  const issues: string[] = []
  for (const [field, label] of requiredProfileStringFields) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) {
      issues.push(`${label}을 입력해 주세요.`)
    }
  }
  if (
    !isFiniteInRange(
      profile.contractPowerKw,
      Number.MIN_VALUE,
      maxPowerKw,
    )
  ) {
    issues.push(
      `계약전력은 0 초과 ${maxPowerKw.toLocaleString('ko-KR')}kW 이하로 입력해 주세요.`,
    )
  }
  if (
    !isFiniteInRange(
      profile.appliedPowerKw,
      Number.MIN_VALUE,
      maxPowerKw,
    )
  ) {
    issues.push(
      `요금적용전력은 0 초과 ${maxPowerKw.toLocaleString('ko-KR')}kW 이하로 입력해 주세요.`,
    )
  }
  // 이 MVP는 계약전력 범위 안에서 청구 기준 전력을 진단한다.
  if (
    typeof profile.contractPowerKw === 'number' &&
    typeof profile.appliedPowerKw === 'number' &&
    Number.isFinite(profile.contractPowerKw) &&
    Number.isFinite(profile.appliedPowerKw) &&
    profile.appliedPowerKw > profile.contractPowerKw
  ) {
    issues.push('요금적용전력은 계약전력을 초과할 수 없습니다.')
  }
  const createdAt =
    typeof profile.dataCreatedAt === 'string'
      ? Date.parse(profile.dataCreatedAt)
      : Number.NaN
  const expiresAt =
    typeof profile.dataExpiresAt === 'string'
      ? Date.parse(profile.dataExpiresAt)
      : Number.NaN
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) {
    issues.push('프로필 데이터 생성·만료 시각이 올바르지 않습니다.')
  } else if (expiresAt <= createdAt) {
    issues.push('프로필 데이터 만료 시각은 생성 시각보다 뒤여야 합니다.')
  }
  return { valid: issues.length === 0, issues }
}

export const isValidSchoolProfile = (
  value: unknown,
): value is SchoolProfile => validateSchoolProfile(value).valid

const peakPercentFields = [
  ['usageIncreasePercent', '사용량 증가율'],
  ['summerIncreasePercent', '여름 증가율'],
  ['winterIncreasePercent', '겨울 증가율'],
] as const

export const normalizePeakScenario = (
  value: unknown,
): {
  scenario: PeakScenario | null
  changed: boolean
  issues: string[]
} => {
  if (!value || typeof value !== 'object') {
    return {
      scenario: null,
      changed: false,
      issues: ['피크 시나리오 형식이 올바르지 않습니다.'],
    }
  }
  const source = value as Record<string, unknown>
  const issues: string[] = []
  for (const [field, label] of [
    ['targetPeakKw', '목표 피크'],
    ['expectedPeakKw', '예상 피크'],
  ] as const) {
    if (!isFiniteInRange(source[field], Number.MIN_VALUE, maxPowerKw)) {
      issues.push(`${label}는 0보다 큰 유한한 값이어야 합니다.`)
    }
  }
  for (const [field, label] of peakPercentFields) {
    if (!isFiniteInRange(source[field], -30, 100)) {
      issues.push(`${label}은 -30~100% 사이여야 합니다.`)
    }
  }
  if (
    !Number.isInteger(source.analysisYear) ||
    !isFiniteInRange(source.analysisYear, 2020, 2035)
  ) {
    issues.push('분석 기준 연도는 2020~2035 사이 정수여야 합니다.')
  }
  if (typeof source.memo !== 'string') {
    issues.push('피크 시나리오 메모 형식이 올바르지 않습니다.')
  }
  if (
    source.auditoriumCooling !== undefined &&
    typeof source.auditoriumCooling !== 'boolean'
  ) {
    issues.push('강당 냉난방 사용 여부 형식이 올바르지 않습니다.')
  }
  for (const field of [
    'cafeteriaHighPowerTime',
    'specialRoomTime',
    'exemptSpaces',
  ] as const) {
    if (source[field] !== undefined && typeof source[field] !== 'string') {
      issues.push('피크 운영 시간·제외 공간 형식이 올바르지 않습니다.')
      break
    }
  }
  if (issues.length > 0) return { scenario: null, changed: false, issues }

  const normalizeOptionalGroup = (
    field: 'mainBuildingEhpGroups' | 'annexEhpGroups',
    fallback: number,
  ) =>
    source[field] === undefined
      ? undefined
      : normalizeEhpGroupCount(source[field] as number, fallback)
  const mainBuildingEhpGroups = normalizeOptionalGroup(
    'mainBuildingEhpGroups',
    5,
  )
  const annexEhpGroups = normalizeOptionalGroup('annexEhpGroups', 2)
  const scenario = {
    ...(source as unknown as PeakScenario),
    ...(mainBuildingEhpGroups === undefined
      ? {}
      : { mainBuildingEhpGroups }),
    ...(annexEhpGroups === undefined ? {} : { annexEhpGroups }),
  }
  return {
    scenario,
    changed:
      mainBuildingEhpGroups !== source.mainBuildingEhpGroups ||
      annexEhpGroups !== source.annexEhpGroups,
    issues: [],
  }
}

export const isValidPeakScenario = (
  value: unknown,
): value is PeakScenario => {
  const normalized = normalizePeakScenario(value)
  return normalized.scenario !== null && !normalized.changed
}

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

const normalizeRatePlanKeyPart = (value: string) =>
  value.trim().replace(/\s+/g, '').toLocaleLowerCase('ko-KR')

export const validateRatePlanCollection = (
  value: unknown,
): DomainValidationResult => {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      valid: false,
      issues: ['요금제는 한 개 이상 설정해야 합니다.'],
    }
  }
  const issues = value.flatMap((plan, index) =>
    validateRatePlan(plan).issues.map(
      (issue) => `${index + 1}번째 요금제: ${issue}`,
    ),
  )
  const identifiers = new Set<string>()
  const tuples = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const plan = candidate as Record<string, unknown>
    if (typeof plan.id === 'string' && plan.id.trim()) {
      const id = normalizeRatePlanKeyPart(plan.id)
      if (identifiers.has(id)) {
        issues.push('요금제 식별값이 중복됩니다.')
      }
      identifiers.add(id)
    }
    if (
      typeof plan.contractType === 'string' &&
      typeof plan.voltageType === 'string' &&
      typeof plan.planName === 'string'
    ) {
      const tuple = [
        plan.contractType,
        plan.voltageType,
        plan.planName,
      ]
        .map(normalizeRatePlanKeyPart)
        .join('|')
      if (tuples.has(tuple)) {
        issues.push(
          '계약종별·수전전압·요금제명 조합이 중복됩니다.',
        )
      }
      tuples.add(tuple)
    }
  }
  return { valid: issues.length === 0, issues }
}

export const findUniqueRatePlanById = (
  plans: RatePlan[],
  id: string,
): RatePlan | null => {
  const normalizedId = normalizeRatePlanKeyPart(id)
  const matches = plans.filter(
    (plan) => normalizeRatePlanKeyPart(plan.id) === normalizedId,
  )
  return matches.length === 1 ? matches[0] : null
}
