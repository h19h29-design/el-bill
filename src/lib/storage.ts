import type {
  CalculationSettings,
  DataProvenance,
  MonthlyBill,
  PeakScenario,
  PowerPlannerDataSource,
  PowerPlannerDataType,
  PowerPlannerRecord,
  RatePlan,
  SchoolProfile,
} from '../types'
import {
  defaultCalculationSettings,
  isCalculationSettings,
} from './calculationSettings'

const dayMs = 24 * 60 * 60 * 1000

export const storageActivePointerKey = 'el-bill:storage-active'
export const storageSnapshotPrefix = 'el-bill:storage-snapshot:'
export const legacyAtomicStorageSnapshotKey = 'el-bill:storage-snapshot'
export const dataProvenanceStorageKey = 'el-bill:data-provenance'
export const legacyDataModeStorageKey = 'el-bill:data-mode'
export const powerPlannerStorageKey = 'el-bill:power-planner'
export const storageSessionKey = 'el-bill:storage-session'
export const storageCommitKey = 'el-bill:storage-commit'
export const billsStorageKey = 'el-bill:bills'
export const profileStorageKey = 'el-bill:profile'
export const scenarioStorageKey = 'el-bill:scenario'
export const ratePlansStorageKey = 'el-bill:rate-plans'

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
  calculationSettings: CalculationSettings
  powerPlanner: PowerPlannerDataSource | null
  provenance: DataProvenance
}

export interface StorageSnapshot {
  schemaVersion: 1
  revision: number
  session: StorageSession
  data: StorageSnapshotData
}

export type StorageSnapshotPatch = Partial<StorageSnapshotData>
export type StorageSnapshotUpdater = (
  latest: Readonly<StorageSnapshotData>,
) => StorageSnapshotPatch

interface StorageActivePointer {
  schemaVersion: 1
  sessionId: string
}

interface LegacyPayload {
  createdAt: string
  expiresAt: string
  sessionId?: string
  data: unknown
}

export type StorageSnapshotWriteResult =
  | {
      ok: true
      snapshot: StorageSnapshot
      cleanupPendingSessionIds?: string[]
    }
  | {
      ok: false
      reason:
        | 'invalid-data'
        | 'storage-error'
        | 'missing'
        | 'malformed'
        | 'expired'
        | 'stale-session'
        | 'lock-error'
    }

export type StorageSnapshotRemovalResult =
  | {
      ok: true
      outcome: 'active-deactivated'
      snapshotRemoved: boolean
    }
  | { ok: true; outcome: 'orphan-cleaned' }
  | {
      ok: false
      outcome: 'active-retained' | 'orphan-retained'
      reason: 'storage-error' | 'lock-error'
    }

export const storageMutationLockName = 'el-bill:storage-mutation'
let fallbackMutationQueue: Promise<unknown> = Promise.resolve()

export const usesSameTabStorageLockFallback = () =>
  typeof navigator === 'undefined' || !navigator.locks?.request

const withStorageMutationLock = async <T>(
  operation: () => T | Promise<T>,
): Promise<T> => {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return await navigator.locks.request(
      storageMutationLockName,
      { mode: 'exclusive' },
      operation,
    )
  }
  const run = fallbackMutationQueue.then(operation, operation)
  fallbackMutationQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return await run
}

const legacyDataKeys = [
  billsStorageKey,
  profileStorageKey,
  scenarioStorageKey,
  ratePlansStorageKey,
  powerPlannerStorageKey,
  dataProvenanceStorageKey,
] as const

const allLegacyPerKeyStorageKeys = [
  ...legacyDataKeys,
  legacyDataModeStorageKey,
  storageSessionKey,
  storageCommitKey,
] as const

const createSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `session-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const storageSnapshotKeyFor = (sessionId: string) =>
  `${storageSnapshotPrefix}${encodeURIComponent(sessionId)}`

export const isSessionSnapshotStorageKey = (key: string | null) =>
  Boolean(key?.startsWith(storageSnapshotPrefix))

const parseTimestamp = (value: unknown) =>
  typeof value === 'string' ? Date.parse(value) : Number.NaN

const isStrictSessionWindow = (value: unknown): value is {
  createdAt: string
  expiresAt: string
} => {
  if (!value || typeof value !== 'object') return false
  const session = value as Record<string, unknown>
  const createdAt = parseTimestamp(session.createdAt)
  const expiresAt = parseTimestamp(session.expiresAt)
  const duration = expiresAt - createdAt
  return (
    Number.isFinite(createdAt) &&
    Number.isFinite(expiresAt) &&
    duration > 0 &&
    duration <= dayMs
  )
}

const isStorageSession = (value: unknown): value is StorageSession =>
  isStrictSessionWindow(value) &&
  typeof (value as Record<string, unknown>).sessionId === 'string' &&
  Boolean((value as Record<string, unknown>).sessionId)

const isSessionExpired = (session: StorageSession, now: number) =>
  Date.parse(session.expiresAt) <= now

const sessionsMatch = (left: StorageSession, right: StorageSession) =>
  left.sessionId === right.sessionId &&
  left.createdAt === right.createdAt &&
  left.expiresAt === right.expiresAt

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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isOptionalFiniteNumber = (value: unknown) =>
  value === undefined || isFiniteNumber(value)

const isOptionalString = (value: unknown) =>
  value === undefined || typeof value === 'string'

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
    billNumberFields.every((field) => isFiniteNumber(bill[field])) &&
    (bill.note === undefined || typeof bill.note === 'string') &&
    (bill.observedFields === undefined ||
      (Array.isArray(bill.observedFields) &&
        bill.observedFields.every((field) => typeof field === 'string')))
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

export const isStoredMonthlyBillCollection = (
  value: unknown,
): value is MonthlyBill[] =>
  Array.isArray(value) && value.every(isStoredMonthlyBill)

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

const powerPlannerDataTypes = new Set<PowerPlannerDataType>([
  'monthlyUsage',
  'dailyUsage',
  'hourlyUsage',
  'maxDemand',
  'estimatedBill',
  'patternAnalysis',
])

const isValidPowerPlannerRecord = (
  value: unknown,
): value is PowerPlannerRecord => {
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
  if (!numericFields.every((field) => isOptionalFiniteNumber(record[field]))) {
    return false
  }
  if (
    !['date', 'loadType', 'patternLabel', 'patternSummary'].every((field) =>
      isOptionalString(record[field]),
    )
  ) {
    return false
  }
  switch (record.dataType) {
    case 'hourlyUsage':
      return (
        isFiniteNumber(record.hour) &&
        record.hour >= 0 &&
        record.hour <= 23 &&
        isFiniteNumber(record.usageKwh)
      )
    case 'maxDemand':
      return isFiniteNumber(record.maxDemandKw)
    case 'monthlyUsage':
    case 'dailyUsage':
      return isFiniteNumber(record.usageKwh)
    case 'estimatedBill':
      return isFiniteNumber(record.estimatedBillWon)
    case 'patternAnalysis':
      return (
        typeof record.patternLabel === 'string' ||
        typeof record.patternSummary === 'string'
      )
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

const isStorageSnapshotData = (
  value: unknown,
  allowMissingCalculationSettings = false,
): value is StorageSnapshotData => {
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
    (isCalculationSettings(data.calculationSettings) ||
      (allowMissingCalculationSettings &&
        data.calculationSettings === undefined)) &&
    (data.powerPlanner === null || hasPowerPlanner) &&
    isDataProvenance(provenance) &&
    (provenance.powerPlanner === 'none'
      ? data.powerPlanner === null
      : hasPowerPlanner)
  )
}

const parseStorageSnapshot = (
  raw: string | null,
  expectedSessionId?: string,
): StorageSnapshot | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return null
    const candidate = value as Record<string, unknown>
    if (
      candidate.schemaVersion !== 1 ||
      !isStorageSession(candidate.session) ||
      !isStorageSnapshotData(candidate.data, true) ||
      (candidate.revision !== undefined &&
        (!Number.isInteger(candidate.revision) ||
          Number(candidate.revision) < 0))
    ) {
      return null
    }
    const parsed = {
      ...candidate,
      revision: candidate.revision ?? 0,
      data: {
        ...(candidate.data as StorageSnapshotData),
        calculationSettings: isCalculationSettings(
          (candidate.data as unknown as Record<string, unknown>)
            .calculationSettings,
        )
          ? (candidate.data as StorageSnapshotData).calculationSettings
          : defaultCalculationSettings,
      },
    } as unknown as StorageSnapshot
    if (
      expectedSessionId &&
      parsed.session.sessionId !== expectedSessionId
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const serializeStorageSnapshot = (snapshot: StorageSnapshot) => {
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !isStorageSession(snapshot.session) ||
    !isStorageSnapshotData(snapshot.data)
  ) {
    return null
  }
  try {
    return JSON.stringify(snapshot)
  } catch {
    return null
  }
}

const parseActivePointer = (raw: string | null): StorageActivePointer | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return null
    const pointer = value as Record<string, unknown>
    return pointer.schemaVersion === 1 &&
      typeof pointer.sessionId === 'string' &&
      Boolean(pointer.sessionId)
      ? (pointer as unknown as StorageActivePointer)
      : null
  } catch {
    return null
  }
}

export const readStorageActivePointer = () =>
  parseActivePointer(localStorage.getItem(storageActivePointerKey))

export const readStorageSnapshotForSession = (
  sessionId: string,
  now = Date.now(),
) => {
  const snapshot = parseStorageSnapshot(
    localStorage.getItem(storageSnapshotKeyFor(sessionId)),
    sessionId,
  )
  return snapshot && !isSessionExpired(snapshot.session, now) ? snapshot : null
}

export const readStorageSnapshot = (
  now = Date.now(),
): StorageSnapshot | null => {
  const active = readStorageActivePointer()
  if (!active) return null
  return readStorageSnapshotForSession(active.sessionId, now)
}

export const createStorageSession = (
  now = Date.now(),
  sessionId = createSessionId(),
): StorageSession => ({
  sessionId,
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + dayMs).toISOString(),
})

const removeSnapshotIfInactive = (sessionId: string) => {
  try {
    if (readStorageActivePointer()?.sessionId === sessionId) return false
    const key = storageSnapshotKeyFor(sessionId)
    localStorage.removeItem(key)
    return localStorage.getItem(key) === null
  } catch {
    return false
  }
}

const commitNewActiveSnapshotUnlocked = (
  snapshot: StorageSnapshot,
): StorageSnapshotWriteResult => {
  const serialized = serializeStorageSnapshot(snapshot)
  if (!serialized) return { ok: false, reason: 'invalid-data' }
  const sessionId = snapshot.session.sessionId
  const snapshotKey = storageSnapshotKeyFor(sessionId)
  try {
    const existing = localStorage.getItem(snapshotKey)
    if (existing !== null && existing !== serialized) {
      return { ok: false, reason: 'stale-session' }
    }
    if (existing === null) localStorage.setItem(snapshotKey, serialized)
    const written = parseStorageSnapshot(localStorage.getItem(snapshotKey), sessionId)
    if (!written || JSON.stringify(written) !== serialized) {
      removeSnapshotIfInactive(sessionId)
      return { ok: false, reason: 'storage-error' }
    }
    localStorage.setItem(
      storageActivePointerKey,
      JSON.stringify({ schemaVersion: 1, sessionId }),
    )
  } catch {
    try {
      removeSnapshotIfInactive(sessionId)
    } catch {
      // The unpointed session can be retried by expiry cleanup.
    }
    return { ok: false, reason: 'storage-error' }
  }
  if (readStorageActivePointer()?.sessionId !== sessionId) {
    removeSnapshotIfInactive(sessionId)
    return { ok: false, reason: 'stale-session' }
  }
  return { ok: true, snapshot }
}

export const startNewStorageSnapshot = (
  data: StorageSnapshotData,
  now?: number,
  sessionId = createSessionId(),
): Promise<StorageSnapshotWriteResult> => {
  if (!sessionId) {
    return Promise.resolve({ ok: false, reason: 'invalid-data' })
  }
  return withStorageMutationLock(() => {
    const previousActiveSessionId = readStorageActivePointer()?.sessionId
    const result = commitNewActiveSnapshotUnlocked({
      schemaVersion: 1,
      revision: 0,
      session: createStorageSession(now ?? Date.now(), sessionId),
      data,
    })
    if (result.ok) {
      const cleanupPendingSessionIds: string[] = []
      if (
        previousActiveSessionId &&
        previousActiveSessionId !== sessionId &&
        readStorageActivePointer()?.sessionId === sessionId &&
        !removeSnapshotIfInactive(previousActiveSessionId)
      ) {
        cleanupPendingSessionIds.push(previousActiveSessionId)
      }
      try {
        localStorage.removeItem(legacyAtomicStorageSnapshotKey)
      } catch {
        // Cleanup retries after the next mount.
      }
      removeLegacyPerKeyStorage()
      return cleanupPendingSessionIds.length
        ? { ...result, cleanupPendingSessionIds }
        : result
    }
    return result
  }).catch(() => ({ ok: false, reason: 'lock-error' }))
}

export const updateStorageSnapshot = (
  expectedSessionId: string,
  patchOrUpdater: StorageSnapshotPatch | StorageSnapshotUpdater,
  now?: number,
): Promise<StorageSnapshotWriteResult> =>
  withStorageMutationLock(() => {
    const before = readStorageActivePointer()
    if (!before) return { ok: false, reason: 'missing' } as const
    if (before.sessionId !== expectedSessionId) {
      return { ok: false, reason: 'stale-session' } as const
    }
    const key = storageSnapshotKeyFor(expectedSessionId)
    const current = parseStorageSnapshot(
      localStorage.getItem(key),
      expectedSessionId,
    )
    if (!current) return { ok: false, reason: 'malformed' } as const
    if (isSessionExpired(current.session, now ?? Date.now())) {
      return { ok: false, reason: 'expired' } as const
    }
    let patch: StorageSnapshotPatch
    try {
      patch =
        typeof patchOrUpdater === 'function'
          ? patchOrUpdater(current.data)
          : patchOrUpdater
    } catch {
      return { ok: false, reason: 'invalid-data' } as const
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, reason: 'invalid-data' } as const
    }
    const next: StorageSnapshot = {
      ...current,
      revision: current.revision + 1,
      data: { ...current.data, ...patch },
    }
    const serialized = serializeStorageSnapshot(next)
    if (!serialized) return { ok: false, reason: 'invalid-data' } as const
    if (readStorageActivePointer()?.sessionId !== expectedSessionId) {
      return { ok: false, reason: 'stale-session' } as const
    }
    try {
      localStorage.setItem(key, serialized)
      const readback = parseStorageSnapshot(
        localStorage.getItem(key),
        expectedSessionId,
      )
      if (
        !readback ||
        readback.revision !== next.revision ||
        JSON.stringify(readback) !== serialized
      ) {
        return { ok: false, reason: 'storage-error' } as const
      }
    } catch {
      return { ok: false, reason: 'storage-error' } as const
    }
    if (readStorageActivePointer()?.sessionId !== expectedSessionId) {
      removeSnapshotIfInactive(expectedSessionId)
      return { ok: false, reason: 'stale-session' } as const
    }
    return { ok: true, snapshot: next } as const
  }).catch(
    (): StorageSnapshotWriteResult => ({ ok: false, reason: 'lock-error' }),
  )

const clearActivePointerUnlocked = (expectedSessionId: string) => {
  if (readStorageActivePointer()?.sessionId !== expectedSessionId) return false
  localStorage.removeItem(storageActivePointerKey)
  return true
}

export const removeStorageSnapshot = (
  expectedSessionId: string,
): Promise<StorageSnapshotRemovalResult> =>
  withStorageMutationLock(() => {
    const activeSessionId = readStorageActivePointer()?.sessionId
    if (activeSessionId === expectedSessionId) {
      try {
        clearActivePointerUnlocked(expectedSessionId)
      } catch {
        return {
          ok: false,
          outcome: 'active-retained',
          reason: 'storage-error',
        } as const
      }
      let snapshotRemoved = false
      try {
        localStorage.removeItem(storageSnapshotKeyFor(expectedSessionId))
        snapshotRemoved =
          localStorage.getItem(storageSnapshotKeyFor(expectedSessionId)) === null
      } catch {
        snapshotRemoved = false
      }
      return {
        ok: true,
        outcome: 'active-deactivated',
        snapshotRemoved,
      } as const
    }
    try {
      localStorage.removeItem(storageSnapshotKeyFor(expectedSessionId))
      if (
        localStorage.getItem(storageSnapshotKeyFor(expectedSessionId)) !== null
      ) {
        return {
          ok: false,
          outcome: 'orphan-retained',
          reason: 'storage-error',
        } as const
      }
      return { ok: true, outcome: 'orphan-cleaned' } as const
    } catch {
      return {
        ok: false,
        outcome: 'orphan-retained',
        reason: 'storage-error',
      } as const
    }
  }).catch(
    (): StorageSnapshotRemovalResult => ({
      ok: false,
      outcome: 'active-retained',
      reason: 'lock-error',
    }),
  )

export const purgeExpiredStorageSnapshot = (
  expectedSessionId: string,
  now?: number,
) =>
  withStorageMutationLock(() => {
    const key = storageSnapshotKeyFor(expectedSessionId)
    const raw = localStorage.getItem(key)
    if (!raw) return false
    const candidate = parseStorageSnapshot(raw, expectedSessionId)
    if (
      candidate &&
      !isSessionExpired(candidate.session, now ?? Date.now())
    ) {
      return false
    }
    try {
      clearActivePointerUnlocked(expectedSessionId)
      localStorage.removeItem(key)
      return true
    } catch {
      return false
    }
  })

const sessionSnapshotKeys = () => {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(storageSnapshotPrefix)) keys.push(key)
  }
  return keys
}

const sessionIdFromSnapshotKey = (key: string) => {
  const encodedSessionId = key.slice(storageSnapshotPrefix.length)
  try {
    return decodeURIComponent(encodedSessionId)
  } catch {
    return encodedSessionId
  }
}

const cleanupExpiredStorageSnapshotsUnlocked = (now: number) => {
  const removed: string[] = []
  const rawActivePointer = localStorage.getItem(storageActivePointerKey)
  if (rawActivePointer && !parseActivePointer(rawActivePointer)) {
    try {
      localStorage.removeItem(storageActivePointerKey)
      removed.push(storageActivePointerKey)
    } catch {
      // A later focus or timer pass retries deletion.
    }
  }
  const activeSessionId = readStorageActivePointer()?.sessionId
  if (
    activeSessionId &&
    localStorage.getItem(storageSnapshotKeyFor(activeSessionId)) === null
  ) {
    try {
      clearActivePointerUnlocked(activeSessionId)
      if (readStorageActivePointer()?.sessionId !== activeSessionId) {
        removed.push(storageActivePointerKey)
      }
    } catch {
      // A later focus or timer pass retries deletion.
    }
  }
  sessionSnapshotKeys().forEach((key) => {
    const sessionId = sessionIdFromSnapshotKey(key)
    const candidate = parseStorageSnapshot(localStorage.getItem(key), sessionId)
    const isActive = sessionId === activeSessionId
    if (isActive && candidate && !isSessionExpired(candidate.session, now)) {
      return
    }
    try {
      if (isActive) {
        clearActivePointerUnlocked(sessionId)
      }
      localStorage.removeItem(key)
      removed.push(key)
    } catch {
      // A later focus or timer pass retries deletion.
    }
  })
  return removed
}

export const cleanupExpiredStorageSnapshots = (now?: number) =>
  withStorageMutationLock(() =>
    cleanupExpiredStorageSnapshotsUnlocked(now ?? Date.now()),
  )

export const getNextStorageExpiry = (now = Date.now()) => {
  const active = readStorageActivePointer()
  if (!active) return null
  const candidate = parseStorageSnapshot(
    localStorage.getItem(storageSnapshotKeyFor(active.sessionId)),
    active.sessionId,
  )
  if (!candidate) return now
  const expiresAt = Date.parse(candidate.session.expiresAt)
  return expiresAt <= now ? now : expiresAt
}

export const getPendingStorageCleanupKeys = (now = Date.now()) => {
  const pending = new Set<string>()
  const rawActivePointer = localStorage.getItem(storageActivePointerKey)
  const active = parseActivePointer(rawActivePointer)
  if (rawActivePointer && !active) pending.add(storageActivePointerKey)
  if (
    active &&
    localStorage.getItem(storageSnapshotKeyFor(active.sessionId)) === null
  ) {
    pending.add(storageActivePointerKey)
  }
  sessionSnapshotKeys().forEach((key) => {
    const sessionId = sessionIdFromSnapshotKey(key)
    const candidate = parseStorageSnapshot(localStorage.getItem(key), sessionId)
    if (
      active?.sessionId !== sessionId ||
      !candidate ||
      isSessionExpired(candidate.session, now)
    ) {
      pending.add(key)
    }
  })
  return [...pending]
}

export const getNextStorageSnapshotExpiry = (now = Date.now()) => {
  const rawActivePointer = localStorage.getItem(storageActivePointerKey)
  const active = parseActivePointer(rawActivePointer)
  if (rawActivePointer && !active) return now
  if (
    active &&
    localStorage.getItem(storageSnapshotKeyFor(active.sessionId)) === null
  ) {
    return now
  }
  let nextExpiry: number | null = null
  for (const key of sessionSnapshotKeys()) {
    const sessionId = sessionIdFromSnapshotKey(key)
    const candidate = parseStorageSnapshot(localStorage.getItem(key), sessionId)
    if (!candidate) return now
    const expiresAt = Date.parse(candidate.session.expiresAt)
    if (expiresAt <= now) return now
    nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt)
  }
  return nextExpiry
}

const removeLegacyPerKeyStorage = () => {
  allLegacyPerKeyStorageKeys.forEach((key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      // Cleanup is idempotent and retries on the next mount.
    }
  })
}

const normalizeLegacyBills = (value: unknown): MonthlyBill[] | null => {
  if (!isStoredMonthlyBillCollection(value)) return null
  return value.map((bill) => ({
    ...bill,
    note: typeof bill.note === 'string' ? bill.note : '',
    observedFields: Array.isArray(bill.observedFields)
      ? bill.observedFields.filter(
          (field): field is MonthlyBill['observedFields'][number] =>
            typeof field === 'string',
        )
      : [],
  }))
}

const parseLegacyPayload = (raw: string | null): LegacyPayload | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (
      !isStrictSessionWindow(value) ||
      !Object.prototype.hasOwnProperty.call(value, 'data')
    ) {
      return null
    }
    const candidate = value as Record<string, unknown>
    if (
      candidate.sessionId !== undefined &&
      (typeof candidate.sessionId !== 'string' || !candidate.sessionId)
    ) {
      return null
    }
    return candidate as unknown as LegacyPayload
  } catch {
    return null
  }
}

const migrateLegacyFixedRoot = (
  now: number,
): { attempted: boolean; snapshot: StorageSnapshot | null } => {
  const raw = localStorage.getItem(legacyAtomicStorageSnapshotKey)
  if (!raw) return { attempted: false, snapshot: null }
  const candidate = parseStorageSnapshot(raw)
  if (!candidate || isSessionExpired(candidate.session, now)) {
    localStorage.removeItem(legacyAtomicStorageSnapshotKey)
    return { attempted: true, snapshot: null }
  }
  const winner = readStorageSnapshot(now)
  if (winner) return { attempted: true, snapshot: winner }
  const result = commitNewActiveSnapshotUnlocked(candidate)
  if (!result.ok) return { attempted: true, snapshot: null }
  localStorage.removeItem(legacyAtomicStorageSnapshotKey)
  removeLegacyPerKeyStorage()
  return { attempted: true, snapshot: result.snapshot }
}

const readCommittedLegacySession = () => {
  const rawSession = localStorage.getItem(storageSessionKey)
  const rawCommit = localStorage.getItem(storageCommitKey)
  if (!rawSession && !rawCommit) {
    return { valid: true, session: null as StorageSession | null }
  }
  if (!rawSession || !rawCommit) return { valid: false, session: null }
  try {
    const session = JSON.parse(rawSession) as unknown
    const commit = JSON.parse(rawCommit) as unknown
    return {
      valid:
        isStorageSession(session) &&
        isStorageSession(commit) &&
        sessionsMatch(session, commit),
      session: isStorageSession(session) ? session : null,
    }
  } catch {
    return { valid: false, session: null }
  }
}

const migrateLegacyPerKeyStorage = (
  fallbackData: StorageSnapshotData,
  now: number,
): StorageSnapshot | null => {
  const presentKeys = allLegacyPerKeyStorageKeys.filter(
    (key) => localStorage.getItem(key) !== null,
  )
  if (!presentKeys.length) return null

  const committed = readCommittedLegacySession()
  const payloadKeys = [...legacyDataKeys, legacyDataModeStorageKey].filter(
    (key) => localStorage.getItem(key) !== null,
  )
  const payloads = new Map<string, LegacyPayload>()
  let valid = committed.valid
  payloadKeys.forEach((key) => {
    const payload = parseLegacyPayload(localStorage.getItem(key))
    if (!payload || Date.parse(payload.expiresAt) <= now) {
      valid = false
      return
    }
    if (
      committed.session
        ? payload.sessionId !== committed.session.sessionId
        : payload.sessionId !== undefined
    ) {
      valid = false
      return
    }
    payloads.set(key, payload)
  })
  if (!valid) {
    removeLegacyPerKeyStorage()
    return null
  }

  const dataPayloads = legacyDataKeys
    .map((key) => payloads.get(key))
    .filter((payload): payload is LegacyPayload => Boolean(payload))
  if (!dataPayloads.length) {
    removeLegacyPerKeyStorage()
    return null
  }
  const metadata = [
    ...(committed.session ? [committed.session] : []),
    ...payloads.values(),
  ]
  const createdAt = Math.max(
    ...metadata.map((entry) => Date.parse(entry.createdAt)),
  )
  const expiresAt = Math.min(
    ...metadata.map((entry) => Date.parse(entry.expiresAt)),
  )
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt <= createdAt ||
    expiresAt - createdAt > dayMs
  ) {
    removeLegacyPerKeyStorage()
    return null
  }

  const bills = normalizeLegacyBills(payloads.get(billsStorageKey)?.data)
  const explicitProvenance = payloads.get(dataProvenanceStorageKey)?.data
  const provenance = isDataProvenance(explicitProvenance)
    ? explicitProvenance
    : { bills: 'sample' as const, powerPlanner: 'none' as const }
  const legacyPowerPlanner = payloads.get(powerPlannerStorageKey)?.data
  const powerPlanner =
    provenance.powerPlanner !== 'none' &&
    isValidPowerPlannerDataSource(legacyPowerPlanner)
      ? legacyPowerPlanner
      : null
  const safeProvenance: DataProvenance = {
    bills: bills && provenance.bills === 'uploaded' ? 'uploaded' : 'sample',
    powerPlanner: powerPlanner ? provenance.powerPlanner : 'none',
  }
  const profile = payloads.get(profileStorageKey)?.data
  const scenario = payloads.get(scenarioStorageKey)?.data
  const ratePlans = payloads.get(ratePlansStorageKey)?.data
  const migrationSnapshot: StorageSnapshot = {
    schemaVersion: 1,
    revision: 0,
    session: {
      sessionId: createSessionId(),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    },
    data: {
      bills: bills ?? fallbackData.bills,
      profile: isSchoolProfile(profile) ? profile : fallbackData.profile,
      scenario: isPeakScenario(scenario) ? scenario : fallbackData.scenario,
      ratePlans:
        Array.isArray(ratePlans) && ratePlans.every(isRatePlan)
          ? ratePlans
          : fallbackData.ratePlans,
      calculationSettings: fallbackData.calculationSettings,
      powerPlanner,
      provenance: safeProvenance,
    },
  }
  const winner = readStorageSnapshot(now)
  if (winner) {
    removeLegacyPerKeyStorage()
    return winner
  }
  const result = commitNewActiveSnapshotUnlocked(migrationSnapshot)
  if (!result.ok) return null
  removeLegacyPerKeyStorage()
  return result.snapshot
}

export const initializeStorageAfterMount = (
  fallbackData: StorageSnapshotData,
  now?: number,
) =>
  withStorageMutationLock(() => {
    const currentTime = now ?? Date.now()
    cleanupExpiredStorageSnapshotsUnlocked(currentTime)
    const active = readStorageSnapshot(currentTime)
    if (active) {
      const activeKey = storageSnapshotKeyFor(active.session.sessionId)
      const serialized = serializeStorageSnapshot(active)
      try {
        if (
          serialized &&
          localStorage.getItem(activeKey) !== serialized
        ) {
          localStorage.setItem(activeKey, serialized)
        }
        localStorage.removeItem(legacyAtomicStorageSnapshotKey)
      } catch {
        // Cleanup and revision upgrade retry after the next mount.
      }
      removeLegacyPerKeyStorage()
      return active
    }

    const fixed = migrateLegacyFixedRoot(currentTime)
    if (fixed.snapshot) return fixed.snapshot
    const fixedRaceWinner = readStorageSnapshot(currentTime)
    if (fixedRaceWinner) return fixedRaceWinner
    if (
      fixed.attempted &&
      localStorage.getItem(legacyAtomicStorageSnapshotKey)
    ) {
      return null
    }
    const migrated = migrateLegacyPerKeyStorage(fallbackData, currentTime)
    return migrated ?? readStorageSnapshot(currentTime)
  })
