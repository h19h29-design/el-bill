import type {
  CalculationSettings,
  DataProvenance,
  MonthlyBill,
  PeakScenario,
  PowerPlannerDataSource,
  RatePlan,
  SchoolProfile,
} from '../types'
import { isCalculationSettings } from './calculationSettings'
import {
  isValidPeakScenario,
  isValidSchoolProfile,
  isValidMonthlyBill,
  normalizePeakScenario,
  validateRatePlanCollection,
} from './domainValidation'
import {
  normalizePowerPlannerRecords,
} from './powerPlanner'

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
export const calculationSettingsStorageKey = 'el-bill:calculation-settings'

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
  calculationSettingsStorageKey,
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
    (provenance.bills === 'sample' ||
      provenance.bills === 'uploaded' ||
      provenance.bills === 'pasted' ||
      provenance.bills === 'manual') &&
    (provenance.powerPlanner === 'none' ||
      provenance.powerPlanner === 'sample' ||
      provenance.powerPlanner === 'uploaded')
  )
}

const isStoredMonthlyBill = (value: unknown): value is MonthlyBill => {
  return isValidMonthlyBill(value)
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

const isSchoolProfile = (value: unknown): value is SchoolProfile => {
  return isValidSchoolProfile(value)
}

const isPeakScenario = (value: unknown): value is PeakScenario => {
  return isValidPeakScenario(value)
}

const normalizePowerPlannerDataSource = (
  value: unknown,
): { dataSource: PowerPlannerDataSource | null; changed: boolean } => {
  if (!value || typeof value !== 'object') {
    return { dataSource: null, changed: value !== null }
  }
  const source = value as Record<string, unknown>
  const metadataIsValid =
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
    Array.isArray(source.records)
  if (!metadataIsValid) return { dataSource: null, changed: true }

  const normalizedRecords = normalizePowerPlannerRecords(source.records)
  if (!normalizedRecords.records) return { dataSource: null, changed: true }

  return {
    dataSource: {
      ...(source as unknown as PowerPlannerDataSource),
      records: normalizedRecords.records,
    },
    changed: normalizedRecords.changed,
  }
}

const isValidPowerPlannerDataSource = (
  value: unknown,
): value is PowerPlannerDataSource => {
  const normalized = normalizePowerPlannerDataSource(value)
  return normalized.dataSource !== null && !normalized.changed
}

const isStorageSnapshotData = (
  value: unknown,
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
    validateRatePlanCollection(data.ratePlans).valid &&
    isCalculationSettings(data.calculationSettings) &&
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
    const rawData =
      candidate.data && typeof candidate.data === 'object'
        ? (candidate.data as Record<string, unknown>)
        : null
    const normalizedPowerPlanner = normalizePowerPlannerDataSource(
      rawData?.powerPlanner,
    )
    const normalizedScenario = normalizePeakScenario(rawData?.scenario)
    const hasValidCalculationSettings = isCalculationSettings(
      rawData?.calculationSettings,
    )
    if (
      !rawData ||
      !normalizedScenario.scenario ||
      normalizedScenario.changed ||
      !hasValidCalculationSettings
    ) {
      return null
    }
    const rawProvenance =
      rawData?.provenance && typeof rawData.provenance === 'object'
        ? (rawData.provenance as DataProvenance)
        : null
    const sanitizedData = rawData
      ? {
          ...rawData,
          scenario: normalizedScenario.scenario,
          calculationSettings: rawData.calculationSettings,
          powerPlanner: normalizedPowerPlanner.dataSource,
          provenance: rawProvenance
            ? {
                ...rawProvenance,
                powerPlanner: normalizedPowerPlanner.dataSource
                  ? rawProvenance.powerPlanner
                  : 'none',
              }
            : rawData.provenance,
        }
      : candidate.data
    if (
      candidate.schemaVersion !== 1 ||
      !isStorageSession(candidate.session) ||
      !isStorageSnapshotData(sanitizedData) ||
      (candidate.revision !== undefined &&
        (!Number.isInteger(candidate.revision) ||
          Number(candidate.revision) < 0))
    ) {
      return null
    }
    const parsed = {
      ...candidate,
      revision: candidate.revision ?? 0,
      data: sanitizedData as StorageSnapshotData,
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

export const rotateNewStorageSnapshot = (
  fallbackData: StorageSnapshotData,
  patchOrUpdater: StorageSnapshotPatch | StorageSnapshotUpdater,
  now?: number,
  sessionId = createSessionId(),
): Promise<StorageSnapshotWriteResult> => {
  if (!sessionId) {
    return Promise.resolve({ ok: false, reason: 'invalid-data' })
  }
  return withStorageMutationLock(() => {
    const rotationTime = now ?? Date.now()
    const previousActiveSessionId = readStorageActivePointer()?.sessionId
    let baseData: StorageSnapshotData
    if (previousActiveSessionId) {
      const active = parseStorageSnapshot(
        localStorage.getItem(storageSnapshotKeyFor(previousActiveSessionId)),
        previousActiveSessionId,
      )
      if (!active) return { ok: false, reason: 'malformed' } as const
      if (isSessionExpired(active.session, rotationTime)) {
        return { ok: false, reason: 'expired' } as const
      }
      baseData = active.data
    } else {
      if (!isStorageSnapshotData(fallbackData)) {
        return { ok: false, reason: 'invalid-data' } as const
      }
      baseData = fallbackData
    }

    let patch: StorageSnapshotPatch
    try {
      patch =
        typeof patchOrUpdater === 'function'
          ? patchOrUpdater(baseData)
          : patchOrUpdater
    } catch {
      return { ok: false, reason: 'invalid-data' } as const
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, reason: 'invalid-data' } as const
    }

    const result = commitNewActiveSnapshotUnlocked({
      schemaVersion: 1,
      revision: 0,
      session: createStorageSession(rotationTime, sessionId),
      data: { ...baseData, ...patch },
    })
    if (!result.ok) return result

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
  }).catch(
    (): StorageSnapshotWriteResult => ({ ok: false, reason: 'lock-error' }),
  )
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
  fallbackData: StorageSnapshotData,
): { attempted: boolean; snapshot: StorageSnapshot | null } => {
  const raw = localStorage.getItem(legacyAtomicStorageSnapshotKey)
  if (!raw) return { attempted: false, snapshot: null }
  const candidate = parseStorageSnapshot(raw)
  if (!candidate) {
    let legacySession: StorageSession | null = null
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      legacySession = isStorageSession(parsed.session)
        ? parsed.session
        : null
    } catch {
      legacySession = null
    }
    if (legacySession && !isSessionExpired(legacySession, now)) {
      const fallbackResult = commitNewActiveSnapshotUnlocked({
        schemaVersion: 1,
        revision: 0,
        session: createStorageSession(now),
        data: {
          ...fallbackData,
          powerPlanner: null,
          provenance: { bills: 'sample', powerPlanner: 'none' },
        },
      })
      if (!fallbackResult.ok) {
        return { attempted: true, snapshot: null }
      }
      localStorage.removeItem(legacyAtomicStorageSnapshotKey)
      removeLegacyPerKeyStorage()
      return { attempted: true, snapshot: fallbackResult.snapshot }
    }
    localStorage.removeItem(legacyAtomicStorageSnapshotKey)
    return { attempted: true, snapshot: null }
  }
  if (isSessionExpired(candidate.session, now)) {
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
  let malformedProvenancePayload = false
  payloadKeys.forEach((key) => {
    const payload = parseLegacyPayload(localStorage.getItem(key))
    if (!payload) {
      if (key === dataProvenanceStorageKey) {
        malformedProvenancePayload = true
      }
      valid = false
      return
    }
    if (Date.parse(payload.expiresAt) <= now) {
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
    if (malformedProvenancePayload) {
      const fallbackResult = commitNewActiveSnapshotUnlocked({
        schemaVersion: 1,
        revision: 0,
        session: createStorageSession(now),
        data: {
          ...fallbackData,
          powerPlanner: null,
          provenance: { bills: 'sample', powerPlanner: 'none' },
        },
      })
      if (!fallbackResult.ok) return null
      removeLegacyPerKeyStorage()
      return fallbackResult.snapshot
    }
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
    : null
  const legacyPowerPlanner = payloads.get(powerPlannerStorageKey)?.data
  const normalizedLegacyPowerPlanner =
    normalizePowerPlannerDataSource(legacyPowerPlanner)
  const hasLegacyPowerPlannerData =
    legacyPowerPlanner !== undefined && legacyPowerPlanner !== null
  const provenanceMatchesPayloads =
    provenance?.bills === 'uploaded' &&
    (provenance.powerPlanner === 'none'
      ? !hasLegacyPowerPlannerData
      : hasLegacyPowerPlannerData &&
        normalizedLegacyPowerPlanner.dataSource !== null)
  const powerPlanner =
    provenance?.powerPlanner !== 'none' &&
    normalizedLegacyPowerPlanner.dataSource
      ? normalizedLegacyPowerPlanner.dataSource
      : null
  const profile = payloads.get(profileStorageKey)?.data
  const scenario = payloads.get(scenarioStorageKey)?.data
  const ratePlans = payloads.get(ratePlansStorageKey)?.data
  const calculationSettings = payloads.get(
    calculationSettingsStorageKey,
  )?.data
  const validProfile = isSchoolProfile(profile)
  const normalizedScenario = normalizePeakScenario(scenario)
  const validRatePlans = validateRatePlanCollection(ratePlans).valid
  const validCalculationSettings = isCalculationSettings(calculationSettings)
  const usedFallbackDomainData =
    !provenanceMatchesPayloads ||
    !bills ||
    !validProfile ||
    !normalizedScenario.scenario ||
    normalizedScenario.changed ||
    !validRatePlans ||
    !validCalculationSettings
  const migratedData: StorageSnapshotData = usedFallbackDomainData
    ? {
        ...fallbackData,
        powerPlanner: null,
        provenance: { bills: 'sample', powerPlanner: 'none' },
      }
    : {
        bills: bills as MonthlyBill[],
        profile: profile as SchoolProfile,
        scenario: normalizedScenario.scenario as PeakScenario,
        ratePlans: ratePlans as RatePlan[],
        calculationSettings: calculationSettings as CalculationSettings,
        powerPlanner,
        provenance: provenance as DataProvenance,
      }
  const migrationSnapshot: StorageSnapshot = {
    schemaVersion: 1,
    revision: 0,
    session: {
      sessionId: createSessionId(),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    },
    data: migratedData,
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
    const activeBeforeCleanup = readStorageActivePointer()
    if (activeBeforeCleanup) {
      const invalidActiveKey = storageSnapshotKeyFor(
        activeBeforeCleanup.sessionId,
      )
      const invalidActiveRaw = localStorage.getItem(invalidActiveKey)
      let invalidActiveHasValidSession = false
      try {
        const candidate = JSON.parse(invalidActiveRaw ?? 'null') as
          | Record<string, unknown>
          | null
        invalidActiveHasValidSession = Boolean(
          candidate && isStorageSession(candidate.session),
        )
      } catch {
        invalidActiveHasValidSession = false
      }
      if (
        invalidActiveRaw &&
        invalidActiveHasValidSession &&
        !parseStorageSnapshot(
          invalidActiveRaw,
          activeBeforeCleanup.sessionId,
        )
      ) {
        const safeFallbackData: StorageSnapshotData = {
          ...fallbackData,
          powerPlanner: null,
          provenance: { bills: 'sample', powerPlanner: 'none' },
        }
        const fallbackResult = commitNewActiveSnapshotUnlocked({
          schemaVersion: 1,
          revision: 0,
          session: createStorageSession(currentTime),
          data: safeFallbackData,
        })
        if (!fallbackResult.ok) return null
        try {
          localStorage.removeItem(invalidActiveKey)
          localStorage.removeItem(legacyAtomicStorageSnapshotKey)
        } catch {
          // The active fallback is already safe; cleanup retries later.
        }
        removeLegacyPerKeyStorage()
        return fallbackResult.snapshot
      }
    }
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

    const fixed = migrateLegacyFixedRoot(currentTime, fallbackData)
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
