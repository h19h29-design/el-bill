import type { DataProvenance, MonthlyBill } from '../types'

const dayMs = 24 * 60 * 60 * 1000

export const dataProvenanceStorageKey = 'el-bill:data-provenance'
export const legacyDataModeStorageKey = 'el-bill:data-mode'
export const powerPlannerStorageKey = 'el-bill:power-planner'
export const defaultDataProvenance: DataProvenance = {
  bills: 'sample',
  powerPlanner: 'none',
}

export const canRestorePowerPlanner = (provenance: DataProvenance) =>
  provenance.powerPlanner === 'sample' || provenance.powerPlanner === 'uploaded'

interface StoredPayload<T> {
  createdAt: string
  expiresAt: string
  data: T
}

const isDataProvenance = (value: unknown): value is DataProvenance => {
  if (!value || typeof value !== 'object') return false
  const provenance = value as Record<string, unknown>
  return (
    (provenance.bills === 'sample' || provenance.bills === 'uploaded') &&
    (provenance.powerPlanner === 'none' ||
      provenance.powerPlanner === 'sample' ||
      provenance.powerPlanner === 'uploaded')
  )
}

const billNumberFields: Array<keyof MonthlyBill> = [
  'year',
  'month',
  'usageKwh',
  'totalBillWon',
  'baseChargeWon',
  'energyChargeWon',
  'appliedPowerKw',
  'maxDemandKw',
  'powerFactorChargeWon',
  'climateChargeWon',
  'fuelAdjustmentWon',
  'vatWon',
  'fundWon',
]

const isStoredMonthlyBill = (value: unknown): value is MonthlyBill => {
  if (!value || typeof value !== 'object') return false
  const bill = value as Record<string, unknown>
  return (
    typeof bill.id === 'string' &&
    billNumberFields.every((field) => Number.isFinite(bill[field]))
  )
}

export const isStoredMonthlyBillCollection = (
  value: unknown,
): value is MonthlyBill[] => Array.isArray(value) && value.every(isStoredMonthlyBill)

export const createExpiry = () => {
  const createdAt = new Date()
  return {
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + dayMs).toISOString(),
  }
}

export const saveWithExpiry = <T>(key: string, data: T) => {
  const existing = loadWithExpiry<T>(key)
  const payload: StoredPayload<T> = {
    ...(existing
      ? {
          createdAt: existing.createdAt,
          expiresAt: existing.expiresAt,
        }
      : createExpiry()),
    data,
  }
  localStorage.setItem(key, JSON.stringify(payload))
  return payload
}

export const loadWithExpiry = <T>(key: string): StoredPayload<T> | null => {
  const raw = localStorage.getItem(key)
  if (!raw) return null

  try {
    const payload = JSON.parse(raw) as StoredPayload<T>
    const expiresAt = new Date(payload.expiresAt).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      localStorage.removeItem(key)
      return null
    }
    return payload
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

export const loadDataProvenance = (storedBills?: unknown): DataProvenance => {
  const storedProvenance = loadWithExpiry<unknown>(dataProvenanceStorageKey)
  if (storedProvenance) {
    if (isDataProvenance(storedProvenance.data)) {
      if (
        storedProvenance.data.bills !== 'uploaded' ||
        isStoredMonthlyBillCollection(storedBills)
      ) {
        return storedProvenance.data
      }
      const safeProvenance: DataProvenance = {
        ...storedProvenance.data,
        bills: 'sample',
      }
      localStorage.setItem(
        dataProvenanceStorageKey,
        JSON.stringify({ ...storedProvenance, data: safeProvenance }),
      )
      return safeProvenance
    }
    localStorage.removeItem(dataProvenanceStorageKey)
  }

  const legacyMode = loadWithExpiry<unknown>(legacyDataModeStorageKey)
  if (legacyMode) localStorage.removeItem(powerPlannerStorageKey)
  localStorage.removeItem(legacyDataModeStorageKey)
  if (legacyMode?.data !== 'sample' && legacyMode?.data !== 'uploaded') {
    return defaultDataProvenance
  }

  const migrated: DataProvenance = {
    bills: 'sample',
    powerPlanner: 'none',
  }
  localStorage.setItem(
    dataProvenanceStorageKey,
    JSON.stringify({ ...legacyMode, data: migrated }),
  )
  return migrated
}

export const purgeExpiredKeys = (keys: string[]) => {
  keys.forEach((key) => loadWithExpiry(key))
}
