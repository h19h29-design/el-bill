import type {
  CalculationSettings,
  PeakScenario,
  RatePlan,
  SchoolProfile,
} from '../types'
import {
  defaultCalculationSettings,
  validateCalculationSettings,
} from './calculationSettings'
import {
  normalizePeakScenario,
  normalizeRatePlanIdentityPart,
  validateRatePlanCollection,
  validateSchoolProfile,
} from './domainValidation'

export type SchoolProfileIntent = {
  type: 'patch'
  patch: Partial<SchoolProfile>
}

export type PeakScenarioIntent = {
  type: 'patch'
  patch: Partial<PeakScenario>
}

export type RatePlanPatch = Omit<Partial<RatePlan>, 'seasonRates'> & {
  seasonRates?: Partial<RatePlan['seasonRates']>
}

export type RatePlanIntent =
  | {
      type: 'patch'
      planId: string
      patch: RatePlanPatch
    }
  | { type: 'add' }

export type CalculationSettingsIntent =
  | {
      type: 'patch'
      patch: Partial<CalculationSettings>
    }
  | { type: 'reset' }

const invalidIntent = (message: string): never => {
  throw new Error(message)
}

export const applySchoolProfileIntent = (
  current: SchoolProfile,
  intent: SchoolProfileIntent,
) => {
  const next = { ...current, ...intent.patch }
  const validation = validateSchoolProfile(next)
  return validation.valid
    ? next
    : invalidIntent(validation.issues[0] ?? '학교 프로필 값이 올바르지 않습니다.')
}

export const applyPeakScenarioIntent = (
  current: PeakScenario,
  intent: PeakScenarioIntent,
) => {
  const normalized = normalizePeakScenario({ ...current, ...intent.patch })
  return normalized.scenario ??
    invalidIntent(normalized.issues[0] ?? '피크 시나리오 값이 올바르지 않습니다.')
}

const createUniquePlanId = (plans: RatePlan[]) => {
  const existing = new Set(
    plans.map((plan) => normalizeRatePlanIdentityPart(plan.id)),
  )
  const randomPart =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const base = `custom-${randomPart}`
  let candidate = base
  let suffix = 2
  while (existing.has(normalizeRatePlanIdentityPart(candidate))) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const createUniquePlanName = (plans: RatePlan[], base: RatePlan) => {
  const existing = new Set(
    plans
      .filter(
        (plan) =>
          normalizeRatePlanIdentityPart(plan.contractType) ===
            normalizeRatePlanIdentityPart(base.contractType) &&
          normalizeRatePlanIdentityPart(plan.voltageType) ===
            normalizeRatePlanIdentityPart(base.voltageType),
      )
      .map((plan) => normalizeRatePlanIdentityPart(plan.planName)),
  )
  let suffix = 1
  let name = '사용자 요금제'
  while (existing.has(normalizeRatePlanIdentityPart(name))) {
    suffix += 1
    name = `사용자 요금제 ${suffix}`
  }
  return name
}

export const applyRatePlanIntent = (
  current: RatePlan[],
  intent: RatePlanIntent,
) => {
  let next: RatePlan[]
  if (intent.type === 'add') {
    const base = current[0] ??
      invalidIntent('복사할 기준 요금제가 없습니다.')
    next = [
      ...current,
      {
        ...base,
        id: createUniquePlanId(current),
        planName: createUniquePlanName(current, base),
        memo: '설정 화면에서 추가',
      },
    ]
  } else {
    const normalizedId = normalizeRatePlanIdentityPart(intent.planId)
    const matches = current.filter(
      (plan) => normalizeRatePlanIdentityPart(plan.id) === normalizedId,
    )
    if (matches.length !== 1) {
      return invalidIntent('수정할 요금제 식별값이 없거나 중복됩니다.')
    }
    next = current.map((plan) =>
      normalizeRatePlanIdentityPart(plan.id) === normalizedId
        ? {
            ...plan,
            ...intent.patch,
            seasonRates: intent.patch.seasonRates
              ? { ...plan.seasonRates, ...intent.patch.seasonRates }
              : plan.seasonRates,
          }
        : plan,
    )
  }
  const validation = validateRatePlanCollection(next)
  return validation.valid
    ? next
    : invalidIntent(validation.issues[0] ?? '요금제 값이 올바르지 않습니다.')
}

export const applyCalculationSettingsIntent = (
  current: CalculationSettings,
  intent: CalculationSettingsIntent,
) => {
  const next =
    intent.type === 'reset'
      ? defaultCalculationSettings
      : { ...current, ...intent.patch }
  const validation = validateCalculationSettings(next)
  return validation.valid
    ? next
    : invalidIntent(
        Object.values(validation.errors)[0] ??
          '계산 설정 값이 올바르지 않습니다.',
      )
}
