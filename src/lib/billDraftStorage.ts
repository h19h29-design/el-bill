import type { ManualBillDraftRow } from './billInput'
import {
  readStorageActivePointer,
  runWithStorageMutationLock,
} from './storage'

const dayMs = 24 * 60 * 60 * 1000
const maxDateMs = 8_640_000_000_000_000
const maxDraftRows = 36
const maxCleanupKeys = 64
const billEntryDraftPrefix = 'el-bill:bill-entry-draft:v1:'

const draftRowFields = [
  'id',
  'yearMonth',
  'usageKwh',
  'totalBillWon',
  'maxDemandKw',
  'appliedPowerKw',
  'baseChargeWon',
  'energyChargeWon',
  'powerFactorChargeWon',
  'climateChargeWon',
  'fuelAdjustmentWon',
  'vatWon',
  'fundWon',
  'note',
] as const satisfies readonly (keyof ManualBillDraftRow)[]

const draftFields = [
  'version',
  'sessionId',
  'revision',
  'createdAt',
  'expiresAt',
  'rows',
] as const

const legacyPointerFields = ['version', 'sessionId'] as const
const pointerFields = ['version', 'sessionId', 'generationId'] as const

export interface BillEntryDraft {
  version: 1
  sessionId: string
  revision: number
  createdAt: string
  expiresAt: string
  rows: ManualBillDraftRow[]
}

export type BillDraftWriteResult =
  | { ok: true; draft: BillEntryDraft }
  | {
      ok: false
      reason: 'invalid' | 'expired' | 'stale' | 'storage-error' | 'lock-error'
    }

interface BillEntryDraftPointer {
  version: 1
  sessionId: string
  generationId?: string
}

type DraftReadState =
  | { status: 'missing'; pointerRaw: null }
  | { status: 'malformed-pointer'; pointerRaw: string }
  | {
      status: 'missing-draft' | 'malformed-draft'
      pointerRaw: string
      pointer: BillEntryDraftPointer
      key: string
      draftRaw: string | null
    }
  | {
      status: 'expired' | 'valid'
      pointerRaw: string
      pointer: BillEntryDraftPointer
      key: string
      draftRaw: string
      draft: BillEntryDraft
    }

interface CleanupResult {
  removed: boolean
  failed: boolean
}

export const billEntryDraftPointerKey = 'el-bill:bill-entry-draft-active'

const toWellFormedIdentifier = (value: string) => {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1]
        index += 1
      } else {
        result += '\ufffd'
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\ufffd'
    } else {
      result += value[index]
    }
  }
  return result
}

const isValidStorageIdentifier = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

const encodeStorageIdentifier = (value: string) =>
  encodeURIComponent(toWellFormedIdentifier(value))

const legacyDraftKeyFor = (sessionId: string) =>
  `${billEntryDraftPrefix}${encodeStorageIdentifier(sessionId)}`

const generationKeyFor = (sessionId: string, generationId: string) =>
  `${legacyDraftKeyFor(sessionId)}:${encodeStorageIdentifier(generationId)}`

const pointerKeyFor = (pointer: BillEntryDraftPointer) =>
  pointer.generationId
    ? generationKeyFor(pointer.sessionId, pointer.generationId)
    : legacyDraftKeyFor(pointer.sessionId)

const hasExactKeys = (
  value: Record<string, unknown>,
  fields: readonly string[],
) => {
  const keys = Object.keys(value)
  return (
    keys.length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  )
}

const isValidTimestamp = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maxDateMs

const isValidNow = (value: number) => isValidTimestamp(value)

const isValidRevision = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0

const parseDraftPointer = (
  raw: string | null,
): BillEntryDraftPointer | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const pointer = value as Record<string, unknown>
    const isLegacy = hasExactKeys(pointer, legacyPointerFields)
    const isGenerationPointer = hasExactKeys(pointer, pointerFields)
    if (
      (!isLegacy && !isGenerationPointer) ||
      pointer.version !== 1 ||
      !isValidStorageIdentifier(pointer.sessionId) ||
      (isGenerationPointer &&
        !isValidStorageIdentifier(pointer.generationId))
    ) {
      return null
    }
    return {
      version: 1,
      sessionId: pointer.sessionId,
      ...(isGenerationPointer
        ? { generationId: pointer.generationId as string }
        : {}),
    }
  } catch {
    return null
  }
}

export const billEntryDraftKeyFor = (sessionId: string): string => {
  const legacyKey = legacyDraftKeyFor(sessionId)
  try {
    const pointer = parseDraftPointer(
      localStorage.getItem(billEntryDraftPointerKey),
    )
    return pointer?.sessionId === sessionId && pointer.generationId
      ? generationKeyFor(pointer.sessionId, pointer.generationId)
      : legacyKey
  } catch {
    return legacyKey
  }
}

const isManualBillDraftRow = (
  value: unknown,
): value is ManualBillDraftRow => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    hasExactKeys(row, draftRowFields) &&
    draftRowFields.every((field) => typeof row[field] === 'string') &&
    Boolean(row.id)
  )
}

const isValidDraftRows = (
  rows: unknown,
): rows is ManualBillDraftRow[] => {
  if (!Array.isArray(rows) || rows.length > maxDraftRows) return false
  const ids = new Set<string>()
  for (const row of rows) {
    if (!isManualBillDraftRow(row) || ids.has(row.id)) return false
    ids.add(row.id)
  }
  return true
}

const parseBillEntryDraft = (
  raw: string | null,
  expectedSessionId: string,
): BillEntryDraft | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const draft = value as Record<string, unknown>
    const createdAt =
      typeof draft.createdAt === 'string'
        ? Date.parse(draft.createdAt)
        : Number.NaN
    const expiresAt =
      typeof draft.expiresAt === 'string'
        ? Date.parse(draft.expiresAt)
        : Number.NaN
    const duration = expiresAt - createdAt
    if (
      !hasExactKeys(draft, draftFields) ||
      draft.version !== 1 ||
      draft.sessionId !== expectedSessionId ||
      !isValidRevision(draft.revision) ||
      !isValidTimestamp(createdAt) ||
      !isValidTimestamp(expiresAt) ||
      duration <= 0 ||
      duration > dayMs ||
      !isValidDraftRows(draft.rows)
    ) {
      return null
    }
    return draft as unknown as BillEntryDraft
  } catch {
    return null
  }
}

const readDraftState = (now: number): DraftReadState => {
  const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
  if (!pointerRaw) return { status: 'missing', pointerRaw: null }
  const pointer = parseDraftPointer(pointerRaw)
  if (!pointer) return { status: 'malformed-pointer', pointerRaw }
  const key = pointerKeyFor(pointer)
  const draftRaw = localStorage.getItem(key)
  if (draftRaw === null) {
    return { status: 'missing-draft', pointerRaw, pointer, key, draftRaw }
  }
  const draft = parseBillEntryDraft(draftRaw, pointer.sessionId)
  if (!draft) {
    return { status: 'malformed-draft', pointerRaw, pointer, key, draftRaw }
  }
  return Date.parse(draft.expiresAt) <= now
    ? { status: 'expired', pointerRaw, pointer, key, draftRaw, draft }
    : { status: 'valid', pointerRaw, pointer, key, draftRaw, draft }
}

export const readBillEntryDraft = (
  now = Date.now(),
): BillEntryDraft | null => {
  if (!isValidNow(now)) return null
  try {
    const state = readDraftState(now)
    return state.status === 'valid' ? state.draft : null
  } catch {
    return null
  }
}

const listDraftKeysBounded = () => {
  const keys: string[] = []
  for (
    let index = 0;
    index < localStorage.length && keys.length < maxCleanupKeys;
    index += 1
  ) {
    const key = localStorage.key(index)
    if (key?.startsWith(billEntryDraftPrefix)) keys.push(key)
  }
  return keys
}

const removeStorageKey = (key: string) => {
  try {
    localStorage.removeItem(key)
    return localStorage.getItem(key) === null
  } catch {
    return false
  }
}

const cleanupDraftStorageUnlocked = (now: number): CleanupResult => {
  const state = readDraftState(now)
  const listedKeys = listDraftKeysBounded()
  let removed = false
  let failed = false
  let protectedKey: string | null =
    state.status === 'valid' ? state.key : null

  if (state.status !== 'missing' && state.status !== 'valid') {
    if ('key' in state && localStorage.getItem(state.key) !== null) {
      if (removeStorageKey(state.key)) {
        removed = true
      } else {
        failed = true
        protectedKey = state.key
      }
    }
    if (!protectedKey) {
      if (removeStorageKey(billEntryDraftPointerKey)) {
        removed = true
      } else {
        failed = true
      }
    }
  }

  for (const key of listedKeys) {
    if (key === protectedKey) continue
    if (localStorage.getItem(key) === null) continue
    if (removeStorageKey(key)) removed = true
    else failed = true
  }

  return { removed, failed }
}

const createDraftSessionId = () => `draft-${globalThis.crypto.randomUUID()}`
const createGenerationId = () => `generation-${globalThis.crypto.randomUUID()}`

const discardCandidate = (key: string) => {
  try {
    localStorage.removeItem(key)
    return localStorage.getItem(key) === null
  } catch {
    return false
  }
}

export const writeBillEntryDraft = (
  rows: ManualBillDraftRow[],
  expectedRevision?: number,
  now = Date.now(),
): Promise<BillDraftWriteResult> => {
  if (
    !isValidDraftRows(rows) ||
    !isValidNow(now) ||
    now > maxDateMs - dayMs ||
    (expectedRevision !== undefined && !isValidRevision(expectedRevision))
  ) {
    return Promise.resolve({ ok: false, reason: 'invalid' })
  }

  return runWithStorageMutationLock((): BillDraftWriteResult => {
    try {
      const state = readDraftState(now)
      if (state.status === 'expired') {
        const cleanup = cleanupDraftStorageUnlocked(now)
        return cleanup.failed
          ? { ok: false, reason: 'storage-error' }
          : { ok: false, reason: 'expired' }
      }
      const current = state.status === 'valid' ? state.draft : null
      if (
        expectedRevision !== undefined &&
        current?.revision !== expectedRevision
      ) {
        if (state.status !== 'valid' && state.status !== 'missing') {
          const cleanup = cleanupDraftStorageUnlocked(now)
          if (cleanup.failed) {
            return { ok: false, reason: 'storage-error' }
          }
        }
        return { ok: false, reason: 'stale' }
      }
      if (current?.revision === Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: 'invalid' }
      }

      const prewriteCleanup = cleanupDraftStorageUnlocked(now)
      if (prewriteCleanup.failed) {
        return { ok: false, reason: 'storage-error' }
      }

      const activeSessionId = readStorageActivePointer()?.sessionId
      const sessionId =
        activeSessionId ?? current?.sessionId ?? createDraftSessionId()
      if (!isValidStorageIdentifier(sessionId)) {
        return { ok: false, reason: 'invalid' }
      }
      const next: BillEntryDraft = {
        version: 1,
        sessionId,
        revision: current ? current.revision + 1 : 0,
        createdAt: current
          ? current.createdAt
          : new Date(now).toISOString(),
        expiresAt: current
          ? current.expiresAt
          : new Date(now + dayMs).toISOString(),
        rows,
      }
      const serialized = JSON.stringify(next)
      if (!parseBillEntryDraft(serialized, sessionId)) {
        return { ok: false, reason: 'invalid' }
      }

      const generationId = createGenerationId()
      if (!isValidStorageIdentifier(generationId)) {
        return { ok: false, reason: 'invalid' }
      }
      const candidateKey = generationKeyFor(sessionId, generationId)
      if (localStorage.getItem(candidateKey) !== null) {
        return { ok: false, reason: 'storage-error' }
      }
      try {
        localStorage.setItem(candidateKey, serialized)
        const readbackRaw = localStorage.getItem(candidateKey)
        const readback = parseBillEntryDraft(readbackRaw, sessionId)
        if (!readback || readbackRaw !== serialized) {
          discardCandidate(candidateKey)
          return { ok: false, reason: 'storage-error' }
        }
      } catch {
        discardCandidate(candidateKey)
        return { ok: false, reason: 'storage-error' }
      }

      const pointerRaw = JSON.stringify({
        version: 1,
        sessionId,
        generationId,
      })
      try {
        localStorage.setItem(billEntryDraftPointerKey, pointerRaw)
      } catch {
        discardCandidate(candidateKey)
        return { ok: false, reason: 'storage-error' }
      }
      return { ok: true, draft: next }
    } catch {
      return { ok: false, reason: 'storage-error' }
    }
  }).catch(() => ({ ok: false, reason: 'lock-error' }))
}

const hasDraftKeys = () => {
  for (let index = 0; index < localStorage.length; index += 1) {
    if (localStorage.key(index)?.startsWith(billEntryDraftPrefix)) return true
  }
  return false
}

const removeCurrentDraftUnlocked = () => {
  const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
  const pointer = parseDraftPointer(pointerRaw)
  const activeKey = pointer ? pointerKeyFor(pointer) : null
  const listedKeys = listDraftKeysBounded()
  const hadData = pointerRaw !== null || listedKeys.length > 0
  let failed = false

  if (activeKey && localStorage.getItem(activeKey) !== null) {
    if (!removeStorageKey(activeKey)) failed = true
  }
  if (!failed && pointerRaw !== null) {
    if (!removeStorageKey(billEntryDraftPointerKey)) failed = true
  }
  for (const key of listedKeys) {
    if (localStorage.getItem(key) === null) continue
    if (!removeStorageKey(key)) failed = true
  }
  if (failed) return false
  if (
    localStorage.getItem(billEntryDraftPointerKey) !== null ||
    hasDraftKeys()
  ) {
    return false
  }
  return hadData
}

export const removeBillEntryDraft = (): Promise<boolean> =>
  runWithStorageMutationLock(() => {
    try {
      return removeCurrentDraftUnlocked()
    } catch {
      return false
    }
  }).catch(() => false)

export const cleanupExpiredBillEntryDraft = (
  now = Date.now(),
): Promise<boolean> => {
  if (!isValidNow(now)) return Promise.resolve(false)
  return runWithStorageMutationLock(() => {
    try {
      const result = cleanupDraftStorageUnlocked(now)
      return !result.failed && result.removed
    } catch {
      return false
    }
  }).catch(() => false)
}
