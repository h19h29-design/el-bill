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
export const storageSessionKey = 'el-bill:storage-session'
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

export interface StorageSession {
  createdAt: string
  expiresAt: string
}

const isValidExpiry = (expiresAt: string) => Number.isFinite(Date.parse(expiresAt))

const isStorageSession = (value: unknown): value is StorageSession => {
  if (!value || typeof value !== 'object') return false
  const session = value as Record<string, unknown>
  return (
    typeof session.createdAt === 'string' &&
    typeof session.expiresAt === 'string' &&
    isValidExpiry(session.createdAt) &&
    isValidExpiry(session.expiresAt) &&
    Date.parse(session.createdAt) <= Date.parse(session.expiresAt)
  )
}

const isExpired = (session: StorageSession) => Date.parse(session.expiresAt) <= Date.now()

const parseStoredPayload = <T>(raw: string | null): StoredPayload<T> | null => {
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as StoredPayload<T>
    return isStorageSession(payload) ? payload : null
  } catch {
    return null
  }
}

export const createStorageSession = (now = Date.now()): StorageSession => ({
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + dayMs).toISOString(),
})

export const startNewStorageSession = (now = Date.now()): StorageSession => {
  const session = createStorageSession(now)
  localStorage.setItem(storageSessionKey, JSON.stringify(session))
  return session
}

export const saveForSession = <T>(
  key: string,
  data: T,
  session: StorageSession,
): StoredPayload<T> => {
  const payload: StoredPayload<T> = { ...session, data }
  localStorage.setItem(key, JSON.stringify(payload))
  return payload
}

export const purgeStorageSession = (
  keys: string[],
  sessionKey = storageSessionKey,
) => {
  const session = parseStoredPayload<never>(localStorage.getItem(sessionKey))
  const rawSession = localStorage.getItem(sessionKey)
  const parsedSession = rawSession ? (() => {
    try {
      return JSON.parse(rawSession) as unknown
    } catch {
      return null
    }
  })() : null
  const shouldPurge = !session && (!parsedSession || !isStorageSession(parsedSession))
    ? Boolean(rawSession)
    : Boolean(session && isExpired(session))

  if (!shouldPurge) return false
  keys.forEach((key) => localStorage.removeItem(key))
  localStorage.removeItem(sessionKey)
  return true
}

/**
 * Existing releases stored each key with an independent expiry. Retain their
 * earliest valid expiry during the one-time migration so no data gains time.
 */
export const restoreStorageSession = (
  keys: string[],
  sessionKey = storageSessionKey,
): StorageSession | null => {
  const rawSession = localStorage.getItem(sessionKey)
  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as unknown
      if (isStorageSession(session) && !isExpired(session)) return session
    } catch {
      // Fall through to a safe full purge below.
    }
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    return null
  }

  const legacyPayloads = keys
    .map((key) => parseStoredPayload<unknown>(localStorage.getItem(key)))
    .filter((payload): payload is StoredPayload<unknown> =>
      Boolean(payload && !isExpired(payload)),
    )
  if (!legacyPayloads.length) return null

  const earliest = legacyPayloads.reduce((current, payload) =>
    Date.parse(payload.expiresAt) < Date.parse(current.expiresAt) ? payload : current,
  )
  const session: StorageSession = {
    createdAt: earliest.createdAt,
    expiresAt: earliest.expiresAt,
  }
  localStorage.setItem(sessionKey, JSON.stringify(session))
  return session
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
  return createStorageSession()
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

export const loadDataProvenance = (
  storedBills?: unknown,
  session?: StorageSession | null,
): DataProvenance => {
  const saveProvenance = (provenance: DataProvenance) => {
    if (session) {
      saveForSession(dataProvenanceStorageKey, provenance, session)
      return
    }
    saveWithExpiry(dataProvenanceStorageKey, provenance)
  }
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
      saveProvenance(safeProvenance)
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
  saveProvenance(migrated)
  return migrated
}

export const restorePowerPlannerState = (
  provenance: DataProvenance,
  session?: StorageSession | null,
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
    if (session) {
      saveForSession(dataProvenanceStorageKey, safeProvenance, session)
    } else {
      saveWithExpiry(dataProvenanceStorageKey, safeProvenance)
    }
  }
  return { provenance: safeProvenance, powerPlannerData: null }
}

export const purgeExpiredKeys = (keys: string[]) => {
  keys.forEach((key) => loadWithExpiry(key))
}
