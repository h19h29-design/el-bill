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
  sessionId: string
  data: T
}

export interface StorageSession {
  createdAt: string
  expiresAt: string
  sessionId: string
}

type LegacySessionMetadata = Omit<StorageSession, 'sessionId'>
export type StorageEntry = readonly [key: string, data: unknown]

const isValidExpiry = (expiresAt: string) => Number.isFinite(Date.parse(expiresAt))

const isSessionMetadata = (value: unknown): value is LegacySessionMetadata => {
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

const isStorageSession = (value: unknown): value is StorageSession =>
  isSessionMetadata(value) &&
  typeof (value as Record<string, unknown>).sessionId === 'string' &&
  Boolean((value as Record<string, unknown>).sessionId)

const hasSessionIdField = (value: unknown) =>
  Boolean(value && typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'sessionId'))

const isExpired = (session: StorageSession) => Date.parse(session.expiresAt) <= Date.now()

const sessionsMatch = (left: StorageSession, right: StorageSession) =>
  left.sessionId === right.sessionId &&
  left.createdAt === right.createdAt &&
  left.expiresAt === right.expiresAt

const createSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `session-${Date.now()}-${Math.random().toString(36).slice(2)}`

const parseStoredPayload = <T>(raw: string | null): (LegacySessionMetadata & {
  data: T
  sessionId?: string
}) | null => {
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as unknown
    return isSessionMetadata(payload) &&
      Object.prototype.hasOwnProperty.call(payload, 'data') &&
      (typeof (payload as Record<string, unknown>).sessionId === 'undefined' ||
        typeof (payload as Record<string, unknown>).sessionId === 'string')
      ? payload as LegacySessionMetadata & { data: T; sessionId?: string }
      : null
  } catch {
    return null
  }
}

export const createStorageSession = (
  now = Date.now(),
  sessionId = createSessionId(),
): StorageSession => ({
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + dayMs).toISOString(),
  sessionId,
})

export const readStorageSession = (
  sessionKey = storageSessionKey,
): StorageSession | null => {
  const rawSession = localStorage.getItem(sessionKey)
  if (!rawSession) return null
  try {
    const session = JSON.parse(rawSession) as unknown
    return isStorageSession(session) && !isExpired(session) ? session : null
  } catch {
    return null
  }
}

export const isActiveStorageSession = (session: StorageSession) => {
  const rawSession = localStorage.getItem(storageSessionKey)
  if (!rawSession) return false
  try {
    const activeSession = JSON.parse(rawSession) as unknown
    return isStorageSession(activeSession) && sessionsMatch(activeSession, session)
  } catch {
    return false
  }
}

export const startNewStorageSession = (
  entries: StorageEntry[] = [],
  now = Date.now(),
  sessionId = createSessionId(),
): StorageSession => {
  const session = createStorageSession(now, sessionId)
  localStorage.setItem(storageSessionKey, JSON.stringify(session))
  entries.forEach(([key, data]) => {
    localStorage.setItem(key, JSON.stringify({ ...session, data }))
  })
  return session
}

export const saveForSession = <T>(
  key: string,
  data: T,
  session: StorageSession,
): StoredPayload<T> | null => {
  if (!isActiveStorageSession(session)) return null
  const payload: StoredPayload<T> = { ...session, data }
  localStorage.setItem(key, JSON.stringify(payload))
  return payload
}

export const purgeStorageSession = (
  keys: string[],
  expectedSession?: StorageSession,
  sessionKey = storageSessionKey,
) => {
  const rawSession = localStorage.getItem(sessionKey)
  if (!rawSession) return false
  let session: unknown
  try {
    session = JSON.parse(rawSession) as unknown
  } catch {
    session = null
  }
  if (!isStorageSession(session)) {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    return true
  }
  if (expectedSession && !sessionsMatch(session, expectedSession)) return false
  if (!isExpired(session)) return false
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
      if (
        isSessionMetadata(session) &&
        !hasSessionIdField(session) &&
        !isExpired({ ...session, sessionId: 'legacy' })
      ) {
        const migrated = migrateLegacyStorageSession(keys, session, sessionKey)
        if (migrated) return migrated
      }
    } catch {
      // Fall through to a safe full purge below.
    }
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    return null
  }

  const migrated = migrateLegacyStorageSession(keys, undefined, sessionKey)
  if (migrated) return migrated
  return null
}

const migrateLegacyStorageSession = (
  keys: string[],
  legacySession: LegacySessionMetadata | undefined,
  sessionKey: string,
): StorageSession | null => {
  const payloads = keys.map((key) => ({
    key,
    payload: parseStoredPayload<unknown>(localStorage.getItem(key)),
  }))
  if (payloads.some(({ payload }) => hasSessionIdField(payload))) {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    return null
  }

  const validPayloads = payloads.filter(({ payload }) =>
    Boolean(payload && !isExpired({ ...payload, sessionId: 'legacy' })),
  )
  if (!validPayloads.length) {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    return null
  }

  const candidates = [
    ...(legacySession ? [legacySession] : []),
    ...validPayloads.map(({ payload }) => payload as LegacySessionMetadata),
  ].filter((candidate) => !isExpired({ ...candidate, sessionId: 'legacy' }))
  const earliest = candidates.reduce((current, candidate) =>
    Date.parse(candidate.expiresAt) < Date.parse(current.expiresAt) ? candidate : current,
  )
  const session: StorageSession = {
    createdAt: earliest.createdAt,
    expiresAt: earliest.expiresAt,
    sessionId: createSessionId(),
  }
  localStorage.setItem(sessionKey, JSON.stringify(session))
  payloads.forEach(({ key, payload }) => {
    if (payload && !isExpired({ ...payload, sessionId: 'legacy' })) {
      localStorage.setItem(key, JSON.stringify({ ...session, data: payload.data }))
    } else {
      localStorage.removeItem(key)
    }
  })
  return session
}

export const loadForSession = <T>(
  key: string,
  session: StorageSession,
): StoredPayload<T> | null => {
  const activeSession = readStorageSession()
  if (!activeSession || !sessionsMatch(activeSession, session)) return null
  const payload = parseStoredPayload<T>(localStorage.getItem(key))
  if (!payload || isExpired({ ...payload, sessionId: payload.sessionId ?? 'legacy' })) {
    localStorage.removeItem(key)
    return null
  }
  if (!payload.sessionId || !sessionsMatch({ ...payload, sessionId: payload.sessionId }, activeSession)) {
    localStorage.removeItem(key)
    return null
  }
  return payload as StoredPayload<T>
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
          sessionId: existing.sessionId ?? createSessionId(),
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
  const storedProvenance = session
    ? loadForSession<unknown>(dataProvenanceStorageKey, session)
    : loadWithExpiry<unknown>(dataProvenanceStorageKey)
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
    const payload = session
      ? loadForSession<unknown>(powerPlannerStorageKey, session)
      : loadWithExpiry<unknown>(powerPlannerStorageKey)
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
