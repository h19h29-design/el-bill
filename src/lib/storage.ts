import type {
  DataProvenance,
  MonthlyBill,
  PeakScenario,
  PowerPlannerDataSource,
  PowerPlannerDataType,
  PowerPlannerRecord,
  RatePlan,
  SchoolProfile,
} from '../types'

const dayMs = 24 * 60 * 60 * 1000

export const dataProvenanceStorageKey = 'el-bill:data-provenance'
export const legacyDataModeStorageKey = 'el-bill:data-mode'
export const powerPlannerStorageKey = 'el-bill:power-planner'
export const storageSessionKey = 'el-bill:storage-session'
export const storageCommitKey = 'el-bill:storage-commit'
export const storageSnapshotKey = 'el-bill:storage-snapshot'
export const billsStorageKey = 'el-bill:bills'
export const profileStorageKey = 'el-bill:profile'
export const scenarioStorageKey = 'el-bill:scenario'
export const ratePlansStorageKey = 'el-bill:rate-plans'
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

export interface StorageSnapshotData {
  bills: MonthlyBill[]
  profile: SchoolProfile
  scenario: PeakScenario
  ratePlans: RatePlan[]
  powerPlanner: PowerPlannerDataSource | null
  provenance: DataProvenance
}

export interface StorageSnapshot {
  schemaVersion: 1
  session: StorageSession
  data: StorageSnapshotData
}

export type StorageSnapshotWriteResult =
  | { ok: true; snapshot: StorageSnapshot }
  | {
      ok: false
      reason: 'invalid-data' | 'storage-error' | 'missing' | 'malformed' | 'expired' | 'stale-session'
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
    return (
      isStorageSession(session) &&
      !isExpired(session) &&
      hasMatchingCommitMarker(session)
    )
      ? session
      : null
  } catch {
    return null
  }
}

export const isActiveStorageSession = (session: StorageSession) => {
  const rawSession = localStorage.getItem(storageSessionKey)
  if (!rawSession) return false
  try {
    const activeSession = JSON.parse(rawSession) as unknown
    return (
      isStorageSession(activeSession) &&
      !isExpired(activeSession) &&
      sessionsMatch(activeSession, session)
    )
  } catch {
    return false
  }
}

const hasMatchingCommitMarker = (session: StorageSession) => {
  const rawCommit = localStorage.getItem(storageCommitKey)
  if (!rawCommit) return false
  try {
    const marker = JSON.parse(rawCommit) as unknown
    return isStorageSession(marker) && sessionsMatch(marker, session)
  } catch {
    return false
  }
}

export const isCommittedStorageSession = (session: StorageSession) =>
  isActiveStorageSession(session) && hasMatchingCommitMarker(session)

const hasMatchingSessionPayload = (key: string, session: StorageSession) => {
  const payload = parseStoredPayload<unknown>(localStorage.getItem(key))
  return Boolean(
    payload &&
    !isExpired({ ...payload, sessionId: payload.sessionId ?? 'legacy' }) &&
    payload.sessionId &&
    sessionsMatch({ ...payload, sessionId: payload.sessionId }, session),
  )
}

export const commitStorageSession = (
  session: StorageSession,
  requiredKeys: string[],
) => {
  if (!isActiveStorageSession(session)) return false
  if (!requiredKeys.every((key) => hasMatchingSessionPayload(key, session))) return false
  localStorage.setItem(storageCommitKey, JSON.stringify(session))
  return true
}

export const startNewStorageSession = (
  entries: StorageEntry[] = [],
  now = Date.now(),
  sessionId = createSessionId(),
  requiredKeys = entries.map(([key]) => key),
): StorageSession => {
  const session = createStorageSession(now, sessionId)
  localStorage.removeItem(storageCommitKey)
  localStorage.setItem(storageSessionKey, JSON.stringify(session))
  entries.forEach(([key, data]) => {
    localStorage.setItem(key, JSON.stringify({ ...session, data }))
  })
  if (!commitStorageSession(session, requiredKeys)) {
    new Set([...requiredKeys, ...entries.map(([key]) => key)]).forEach((key) =>
      localStorage.removeItem(key),
    )
    localStorage.removeItem(storageSessionKey)
    localStorage.removeItem(storageCommitKey)
  }
  return session
}

export const saveForSession = <T>(
  key: string,
  data: T,
  session: StorageSession,
): StoredPayload<T> | null => {
  if (!isCommittedStorageSession(session)) return null
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
    localStorage.removeItem(storageCommitKey)
    return true
  }
  if (expectedSession && !sessionsMatch(session, expectedSession)) return false
  if (!hasMatchingCommitMarker(session)) {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    localStorage.removeItem(storageCommitKey)
    return true
  }
  if (!isExpired(session)) return false
  keys.forEach((key) => localStorage.removeItem(key))
  localStorage.removeItem(sessionKey)
  localStorage.removeItem(storageCommitKey)
  return true
}

/**
 * Removes only the current session when it cannot be restored as a complete,
 * committed snapshot. This is intentionally separate from compare-and-purge:
 * another tab may have already replaced the caller's former session.
 */
export const purgeInvalidCurrentStorageSession = (
  keys: string[],
  requiredKeys = keys,
  sessionKey = storageSessionKey,
) => {
  const clearCurrentSession = () => {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    localStorage.removeItem(storageCommitKey)
  }
  const rawSession = localStorage.getItem(sessionKey)
  if (!rawSession) {
    if (localStorage.getItem(storageCommitKey) || keys.some((key) => localStorage.getItem(key))) {
      clearCurrentSession()
      return true
    }
    return false
  }

  try {
    const session = JSON.parse(rawSession) as unknown
    if (
      isStorageSession(session) &&
      !isExpired(session) &&
      hasMatchingCommitMarker(session) &&
      requiredKeys.every((key) => hasMatchingSessionPayload(key, session))
    ) {
      return false
    }
  } catch {
    // A malformed current session is invalid and must not survive the recheck.
  }

  clearCurrentSession()
  return true
}

/**
 * Existing releases stored each key with an independent expiry. Retain their
 * earliest valid expiry during the one-time migration so no data gains time.
 */
export const restoreStorageSession = (
  keys: string[],
  sessionKey = storageSessionKey,
  requiredKeys = keys,
): StorageSession | null => {
  const rawSession = localStorage.getItem(sessionKey)
  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as unknown
      if (isStorageSession(session) && !isExpired(session)) {
        if (
          isCommittedStorageSession(session) &&
          requiredKeys.every((key) => hasMatchingSessionPayload(key, session))
        ) {
          return session
        }
      }
      if (
        isSessionMetadata(session) &&
        !hasSessionIdField(session) &&
        !isExpired({ ...session, sessionId: 'legacy' })
      ) {
        const migrated = migrateLegacyStorageSession(
          keys,
          session,
          sessionKey,
          requiredKeys,
        )
        if (migrated) return migrated
      }
    } catch {
      // Fall through to a safe full purge below.
    }
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    localStorage.removeItem(storageCommitKey)
    return null
  }

  const migrated = migrateLegacyStorageSession(keys, undefined, sessionKey, requiredKeys)
  if (migrated) return migrated
  return null
}

const migrateLegacyStorageSession = (
  keys: string[],
  legacySession: LegacySessionMetadata | undefined,
  sessionKey: string,
  requiredKeys: string[],
): StorageSession | null => {
  const payloads = keys.map((key) => ({
    key,
    payload: parseStoredPayload<unknown>(localStorage.getItem(key)),
  }))
  if (payloads.some(({ payload }) => hasSessionIdField(payload))) {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    localStorage.removeItem(storageCommitKey)
    return null
  }

  const validPayloads = payloads.filter(({ payload }) =>
    Boolean(payload && !isExpired({ ...payload, sessionId: 'legacy' })),
  )
  if (!validPayloads.length) {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    localStorage.removeItem(storageCommitKey)
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
  if (!commitStorageSession(session, requiredKeys)) {
    keys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(sessionKey)
    localStorage.removeItem(storageCommitKey)
    return null
  }
  return session
}

export const loadForSession = <T>(
  key: string,
  session: StorageSession,
): StoredPayload<T> | null => {
  if (!isCommittedStorageSession(session)) return null
  const payload = parseStoredPayload<T>(localStorage.getItem(key))
  if (!payload || isExpired({ ...payload, sessionId: payload.sessionId ?? 'legacy' })) {
    localStorage.removeItem(key)
    return null
  }
  if (!payload.sessionId || !sessionsMatch({ ...payload, sessionId: payload.sessionId }, session)) {
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
  const bill = value as unknown as Record<string, unknown>
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

const profileStringFields: Array<keyof SchoolProfile> = [
  'schoolName',
  'displaySchoolName',
  'customerNumber',
  'address',
  'kepcoBranch',
  'contractType',
  'voltageType',
  'currentPlan',
  'managerName',
  'managerPhone',
  'dataCreatedAt',
  'dataExpiresAt',
]

const isSchoolProfile = (value: unknown): value is SchoolProfile => {
  if (!value || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  return (
    profileStringFields.every((field) => typeof profile[field] === 'string') &&
    isFiniteNumber(profile.contractPowerKw) &&
    isFiniteNumber(profile.appliedPowerKw)
  )
}

const isPeakScenario = (value: unknown): value is PeakScenario => {
  if (!value || typeof value !== 'object') return false
  const scenario = value as Record<string, unknown>
  return (
    [
      'targetPeakKw',
      'expectedPeakKw',
      'usageIncreasePercent',
      'summerIncreasePercent',
      'winterIncreasePercent',
      'analysisYear',
    ].every((field) => isFiniteNumber(scenario[field])) &&
    typeof scenario.memo === 'string' &&
    isOptionalFiniteNumber(scenario.mainBuildingEhpGroups) &&
    isOptionalFiniteNumber(scenario.annexEhpGroups) &&
    (scenario.auditoriumCooling === undefined ||
      typeof scenario.auditoriumCooling === 'boolean') &&
    isOptionalString(scenario.cafeteriaHighPowerTime) &&
    isOptionalString(scenario.specialRoomTime) &&
    isOptionalString(scenario.exemptSpaces)
  )
}

const isRatePlan = (value: unknown): value is RatePlan => {
  if (!value || typeof value !== 'object') return false
  const plan = value as Record<string, unknown>
  const seasonRates = plan.seasonRates as Record<string, unknown> | undefined
  return (
    ['id', 'contractType', 'voltageType', 'planName', 'effectiveFrom', 'memo'].every(
      (field) => typeof plan[field] === 'string',
    ) &&
    isFiniteNumber(plan.baseRateWonPerKw) &&
    Boolean(seasonRates) &&
    isFiniteNumber(seasonRates?.springAutumn) &&
    isFiniteNumber(seasonRates?.summer) &&
    isFiniteNumber(seasonRates?.winter) &&
    isOptionalFiniteNumber(plan.lightLoadRate) &&
    isOptionalFiniteNumber(plan.midLoadRate) &&
    isOptionalFiniteNumber(plan.peakLoadRate)
  )
}

const isCompleteMonthlyBill = (value: unknown): value is MonthlyBill => {
  if (!isStoredMonthlyBill(value)) return false
  const bill = value as unknown as Record<string, unknown>
  return (
    typeof bill.note === 'string' &&
    Array.isArray(bill.observedFields) &&
    bill.observedFields.every((field) => typeof field === 'string')
  )
}

const isStorageSnapshotData = (value: unknown): value is StorageSnapshotData => {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  const provenance = data.provenance
  const hasPowerPlanner = isValidPowerPlannerDataSource(data.powerPlanner)
  return (
    Array.isArray(data.bills) &&
    data.bills.length > 0 &&
    data.bills.every(isCompleteMonthlyBill) &&
    isSchoolProfile(data.profile) &&
    isPeakScenario(data.scenario) &&
    Array.isArray(data.ratePlans) &&
    data.ratePlans.length > 0 &&
    data.ratePlans.every(isRatePlan) &&
    (data.powerPlanner === null || hasPowerPlanner) &&
    isDataProvenance(provenance) &&
    (provenance.powerPlanner === 'none'
      ? data.powerPlanner === null
      : hasPowerPlanner)
  )
}

const parseStorageSnapshotRoot = (raw: string): StorageSnapshot | null => {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return null
    const snapshot = value as Record<string, unknown>
    if (
      snapshot.schemaVersion !== 1 ||
      !isStorageSession(snapshot.session) ||
      !isStorageSnapshotData(snapshot.data)
    ) {
      return null
    }
    return snapshot as unknown as StorageSnapshot
  } catch {
    return null
  }
}

const snapshotExpiredAt = (snapshot: StorageSnapshot, now: number) =>
  Date.parse(snapshot.session.expiresAt) <= now

const removeRootIfUnchanged = (raw: string) => {
  if (localStorage.getItem(storageSnapshotKey) !== raw) return false
  localStorage.removeItem(storageSnapshotKey)
  return true
}

const serializeSnapshot = (snapshot: StorageSnapshot) => {
  if (!isStorageSnapshotData(snapshot.data) || !isStorageSession(snapshot.session)) {
    return null
  }
  try {
    return JSON.stringify(snapshot)
  } catch {
    return null
  }
}

export const startNewStorageSnapshot = (
  data: StorageSnapshotData,
  now = Date.now(),
  sessionId = createSessionId(),
): StorageSnapshotWriteResult => {
  const snapshot: StorageSnapshot = {
    schemaVersion: 1,
    session: createStorageSession(now, sessionId),
    data,
  }
  const serialized = serializeSnapshot(snapshot)
  if (!serialized) return { ok: false, reason: 'invalid-data' }
  try {
    localStorage.setItem(storageSnapshotKey, serialized)
  } catch {
    return { ok: false, reason: 'storage-error' }
  }
  allLegacyStorageKeys.forEach((key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      // The atomic root is already committed; legacy cleanup can retry on reload.
    }
  })
  return { ok: true, snapshot }
}

export const updateStorageSnapshot = (
  expectedSessionId: string,
  data: StorageSnapshotData,
  now = Date.now(),
): StorageSnapshotWriteResult => {
  const raw = localStorage.getItem(storageSnapshotKey)
  if (!raw) return { ok: false, reason: 'missing' }
  const current = parseStorageSnapshotRoot(raw)
  if (!current) return { ok: false, reason: 'malformed' }
  if (snapshotExpiredAt(current, now)) return { ok: false, reason: 'expired' }
  if (current.session.sessionId !== expectedSessionId) {
    return { ok: false, reason: 'stale-session' }
  }
  const next: StorageSnapshot = { ...current, data }
  const serialized = serializeSnapshot(next)
  if (!serialized) return { ok: false, reason: 'invalid-data' }
  if (localStorage.getItem(storageSnapshotKey) !== raw) {
    return { ok: false, reason: 'stale-session' }
  }
  try {
    localStorage.setItem(storageSnapshotKey, serialized)
    return { ok: true, snapshot: next }
  } catch {
    return { ok: false, reason: 'storage-error' }
  }
}

export const readStorageSnapshot = (now = Date.now()): StorageSnapshot | null => {
  const raw = localStorage.getItem(storageSnapshotKey)
  if (!raw) return null
  const snapshot = parseStorageSnapshotRoot(raw)
  if (!snapshot || snapshotExpiredAt(snapshot, now)) {
    removeRootIfUnchanged(raw)
    return null
  }
  return snapshot
}

export const purgeExpiredStorageSnapshot = (
  expectedSessionId: string,
  now = Date.now(),
) => {
  const raw = localStorage.getItem(storageSnapshotKey)
  if (!raw) return false
  const snapshot = parseStorageSnapshotRoot(raw)
  if (
    !snapshot ||
    snapshot.session.sessionId !== expectedSessionId ||
    !snapshotExpiredAt(snapshot, now)
  ) {
    return false
  }
  return removeRootIfUnchanged(raw)
}

export const removeStorageSnapshot = (expectedSessionId?: string) => {
  const raw = localStorage.getItem(storageSnapshotKey)
  if (!raw) return false
  if (expectedSessionId) {
    const snapshot = parseStorageSnapshotRoot(raw)
    if (!snapshot || snapshot.session.sessionId !== expectedSessionId) return false
  }
  return removeRootIfUnchanged(raw)
}

const legacySnapshotKeys = [
  billsStorageKey,
  profileStorageKey,
  scenarioStorageKey,
  ratePlansStorageKey,
  powerPlannerStorageKey,
  dataProvenanceStorageKey,
] as const

const allLegacyStorageKeys = [
  ...legacySnapshotKeys,
  legacyDataModeStorageKey,
  storageSessionKey,
  storageCommitKey,
]

const normalizeLegacyBills = (value: unknown): MonthlyBill[] | null => {
  if (!isStoredMonthlyBillCollection(value)) return null
  return value.map((bill) => ({
    ...bill,
    note: typeof bill.note === 'string' ? bill.note : '',
    observedFields: Array.isArray(bill.observedFields)
      ? bill.observedFields.filter((field): field is MonthlyBill['observedFields'][number] =>
          typeof field === 'string',
        )
      : [],
  }))
}

const readLegacySession = () => {
  const rawSession = localStorage.getItem(storageSessionKey)
  if (!rawSession) return { valid: true, session: null as StorageSession | LegacySessionMetadata | null }
  try {
    const value = JSON.parse(rawSession) as unknown
    if (isStorageSession(value)) {
      const rawCommit = localStorage.getItem(storageCommitKey)
      if (!rawCommit) return { valid: false, session: null }
      const commit = JSON.parse(rawCommit) as unknown
      return {
        valid: isStorageSession(commit) && sessionsMatch(value, commit),
        session: value,
      }
    }
    return {
      valid: isSessionMetadata(value) && !hasSessionIdField(value),
      session: isSessionMetadata(value) ? value : null,
    }
  } catch {
    return { valid: false, session: null }
  }
}

const migrateLegacyStorageSnapshot = (
  fallbackData: StorageSnapshotData,
  now: number,
): StorageSnapshot | null => {
  const legacySession = readLegacySession()
  if (!legacySession.valid) return null

  const payloads = new Map(
    legacySnapshotKeys.map((key) => [
      key,
      parseStoredPayload<unknown>(localStorage.getItem(key)),
    ]),
  )
  const committedSessionId =
    legacySession.session && isStorageSession(legacySession.session)
      ? legacySession.session.sessionId
      : null
  const hasMismatchedPayload = [...payloads.values()].some((payload) => {
    if (!payload) return false
    return committedSessionId
      ? payload.sessionId !== committedSessionId
      : Boolean(payload.sessionId)
  })
  if (hasMismatchedPayload) return null

  const metadata = [
    ...(legacySession.session ? [legacySession.session] : []),
    ...[...payloads.values()].filter(
      (payload): payload is LegacySessionMetadata & { data: unknown; sessionId?: string } =>
        Boolean(payload),
    ),
  ]
  if (!metadata.length) {
    localStorage.removeItem(legacyDataModeStorageKey)
    return null
  }

  const earliest = metadata.reduce((current, candidate) =>
    Date.parse(candidate.expiresAt) < Date.parse(current.expiresAt) ? candidate : current,
  )
  if (Date.parse(earliest.expiresAt) <= now) return null

  const bills = normalizeLegacyBills(payloads.get(billsStorageKey)?.data)
  const profileValue = payloads.get(profileStorageKey)?.data
  const scenarioValue = payloads.get(scenarioStorageKey)?.data
  const ratePlansValue = payloads.get(ratePlansStorageKey)?.data
  const provenanceValue = payloads.get(dataProvenanceStorageKey)?.data
  const powerPlannerValue = payloads.get(powerPlannerStorageKey)?.data
  const provenance: DataProvenance =
    bills && isDataProvenance(provenanceValue)
      ? provenanceValue
      : defaultDataProvenance
  const powerPlanner =
    provenance.powerPlanner !== 'none' &&
    isValidPowerPlannerDataSource(powerPlannerValue)
      ? powerPlannerValue
      : null
  const safeProvenance: DataProvenance = {
    bills: bills && provenance.bills === 'uploaded' ? 'uploaded' : 'sample',
    powerPlanner: powerPlanner ? provenance.powerPlanner : 'none',
  }
  const data: StorageSnapshotData = {
    bills: bills ?? fallbackData.bills,
    profile: isSchoolProfile(profileValue) ? profileValue : fallbackData.profile,
    scenario: isPeakScenario(scenarioValue) ? scenarioValue : fallbackData.scenario,
    ratePlans:
      Array.isArray(ratePlansValue) && ratePlansValue.every(isRatePlan)
        ? ratePlansValue
        : fallbackData.ratePlans,
    powerPlanner,
    provenance: safeProvenance,
  }
  const snapshot: StorageSnapshot = {
    schemaVersion: 1,
    session: {
      sessionId: createSessionId(),
      createdAt: earliest.createdAt,
      expiresAt: earliest.expiresAt,
    },
    data,
  }
  const serialized = serializeSnapshot(snapshot)
  if (!serialized) return null
  try {
    localStorage.setItem(storageSnapshotKey, serialized)
  } catch {
    return null
  }
  allLegacyStorageKeys.forEach((key) => localStorage.removeItem(key))
  return snapshot
}

export const restoreStorageSnapshot = (
  fallbackData: StorageSnapshotData,
  now = Date.now(),
): StorageSnapshot | null => {
  const raw = localStorage.getItem(storageSnapshotKey)
  if (raw) {
    const snapshot = parseStorageSnapshotRoot(raw)
    if (!snapshot || snapshotExpiredAt(snapshot, now)) {
      removeRootIfUnchanged(raw)
      return null
    }
    return snapshot
  }
  return migrateLegacyStorageSnapshot(fallbackData, now)
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
