import type {
  DataProvenance,
  MonthlyBill,
  PowerPlannerDataSource,
  PowerPlannerDataType,
  PowerPlannerRecord,
} from '../types'

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

export interface PowerPlannerRestoration {
  provenance: DataProvenance
  powerPlannerData: PowerPlannerDataSource | null
}

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

const powerPlannerDataTypes = new Set<PowerPlannerDataType>([
  'monthlyUsage',
  'dailyUsage',
  'hourlyUsage',
  'maxDemand',
  'estimatedBill',
  'patternAnalysis',
])

const isOptionalFiniteNumber = (value: unknown) =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value))

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isOptionalString = (value: unknown) =>
  value === undefined || typeof value === 'string'

const isValidPowerPlannerRecord = (value: unknown): value is PowerPlannerRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    !record.id ||
    !powerPlannerDataTypes.has(record.dataType as PowerPlannerDataType) ||
    !Number.isInteger(record.sourceRowIndex) ||
    Number(record.sourceRowIndex) < 0
  ) {
    return false
  }

  const numericFields = [
    'year',
    'month',
    'day',
    'hour',
    'usageKwh',
    'maxDemandKw',
    'estimatedBillWon',
    'contractPowerKw',
    'appliedPowerKw',
    'usageDays',
    'laggingPowerFactorPercent',
    'leadingPowerFactorPercent',
  ]
  if (!numericFields.every((field) => isOptionalFiniteNumber(record[field]))) return false
  if (!['date', 'loadType', 'patternLabel', 'patternSummary'].every((field) => isOptionalString(record[field]))) {
    return false
  }

  switch (record.dataType) {
    case 'hourlyUsage':
      return isFiniteNumber(record.hour) && record.hour >= 0 && record.hour <= 23 &&
        isFiniteNumber(record.usageKwh)
    case 'maxDemand':
      return isFiniteNumber(record.maxDemandKw)
    case 'monthlyUsage':
    case 'dailyUsage':
      return isFiniteNumber(record.usageKwh)
    case 'estimatedBill':
      return isFiniteNumber(record.estimatedBillWon)
    case 'patternAnalysis':
      return typeof record.patternLabel === 'string' || typeof record.patternSummary === 'string'
    default:
      return false
  }
}

const isValidPowerPlannerDataSource = (
  value: unknown,
): value is PowerPlannerDataSource => {
  if (!value || typeof value !== 'object') return false
  const source = value as Record<string, unknown>
  return (
    typeof source.id === 'string' &&
    Boolean(source.id) &&
    source.provider === 'kepco-power-planner' &&
    typeof source.sourceName === 'string' &&
    Boolean(source.sourceName) &&
    typeof source.sourceLabel === 'string' &&
    Boolean(source.sourceLabel) &&
    typeof source.importedAt === 'string' &&
    Number.isFinite(Date.parse(source.importedAt)) &&
    typeof source.memo === 'string' &&
    Array.isArray(source.records) &&
    source.records.length > 0 &&
    source.records.every(isValidPowerPlannerRecord)
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

export const restorePowerPlannerState = (
  provenance: DataProvenance,
): PowerPlannerRestoration => {
  if (canRestorePowerPlanner(provenance)) {
    const payload = loadWithExpiry<unknown>(powerPlannerStorageKey)
    if (payload && isValidPowerPlannerDataSource(payload.data)) {
      return { provenance, powerPlannerData: payload.data }
    }
  }

  localStorage.removeItem(powerPlannerStorageKey)
  const safeProvenance =
    provenance.powerPlanner === 'none'
      ? provenance
      : { ...provenance, powerPlanner: 'none' as const }
  if (safeProvenance !== provenance) {
    saveWithExpiry(dataProvenanceStorageKey, safeProvenance)
  }
  return { provenance: safeProvenance, powerPlannerData: null }
}

export const purgeExpiredKeys = (keys: string[]) => {
  keys.forEach((key) => loadWithExpiry(key))
}
