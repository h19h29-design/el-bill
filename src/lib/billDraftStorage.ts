import type { ManualBillDraftRow } from './billInput'
import {
  readStorageActivePointer,
  runWithStorageMutationLock,
} from './storage'

const dayMs = 24 * 60 * 60 * 1000
const maxDraftRows = 36
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

const pointerFields = ['version', 'sessionId'] as const

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
}

export const billEntryDraftPointerKey = 'el-bill:bill-entry-draft-active'

export const billEntryDraftKeyFor = (sessionId: string): string =>
  `${billEntryDraftPrefix}${encodeURIComponent(sessionId)}`

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

const parseDraftPointer = (
  raw: string | null,
): BillEntryDraftPointer | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return null
    const pointer = value as Record<string, unknown>
    if (
      !hasExactKeys(pointer, pointerFields) ||
      pointer.version !== 1 ||
      typeof pointer.sessionId !== 'string' ||
      !pointer.sessionId
    ) {
      return null
    }
    return { version: 1, sessionId: pointer.sessionId }
  } catch {
    return null
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
      !Number.isInteger(draft.revision) ||
      Number(draft.revision) < 0 ||
      !Number.isFinite(createdAt) ||
      !Number.isFinite(expiresAt) ||
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

const removePointerAndDraftBestEffort = (
  sessionId: string,
  pointerRaw: string | null,
  draftRaw: string | null,
) => {
  let draftRemoved = false
  try {
    const key = billEntryDraftKeyFor(sessionId)
    if (localStorage.getItem(key) !== draftRaw) return
    localStorage.removeItem(key)
    draftRemoved = localStorage.getItem(key) === null
  } catch {
    // A later read or cleanup pass retries physical deletion.
  }
  if (!draftRemoved) return
  try {
    if (localStorage.getItem(billEntryDraftPointerKey) === pointerRaw) {
      localStorage.removeItem(billEntryDraftPointerKey)
    }
  } catch {
    // A later read or cleanup pass retries physical deletion.
  }
}

const removePointerIfUnchanged = (pointerRaw: string) => {
  try {
    if (localStorage.getItem(billEntryDraftPointerKey) === pointerRaw) {
      localStorage.removeItem(billEntryDraftPointerKey)
    }
  } catch {
    // A later read or cleanup pass retries physical deletion.
  }
}

const readCurrentDraft = (
  now: number,
):
  | { state: 'missing' }
  | { state: 'valid'; draft: BillEntryDraft; pointerRaw: string }
  | { state: 'expired'; sessionId: string } => {
  const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
  if (!pointerRaw) return { state: 'missing' }
  const pointer = parseDraftPointer(pointerRaw)
  if (!pointer) {
    removePointerIfUnchanged(pointerRaw)
    return { state: 'missing' }
  }
  const key = billEntryDraftKeyFor(pointer.sessionId)
  const raw = localStorage.getItem(key)
  const draft = parseBillEntryDraft(raw, pointer.sessionId)
  if (!draft) {
    removePointerAndDraftBestEffort(pointer.sessionId, pointerRaw, raw)
    return { state: 'missing' }
  }
  if (Date.parse(draft.expiresAt) <= now) {
    removePointerAndDraftBestEffort(pointer.sessionId, pointerRaw, raw)
    return { state: 'expired', sessionId: pointer.sessionId }
  }
  return { state: 'valid', draft, pointerRaw }
}

export const readBillEntryDraft = (
  now = Date.now(),
): BillEntryDraft | null => {
  try {
    const current = readCurrentDraft(now)
    return current.state === 'valid' ? current.draft : null
  } catch {
    return null
  }
}

const restoreStorageValue = (key: string, raw: string | null) => {
  try {
    if (raw === null) localStorage.removeItem(key)
    else localStorage.setItem(key, raw)
  } catch {
    // The original value remains recoverable when the storage backend permits.
  }
}

const createDraftSessionId = () => `draft-${globalThis.crypto.randomUUID()}`

export const writeBillEntryDraft = (
  rows: ManualBillDraftRow[],
  expectedRevision?: number,
  now = Date.now(),
): Promise<BillDraftWriteResult> => {
  if (
    !isValidDraftRows(rows) ||
    !Number.isFinite(now) ||
    (expectedRevision !== undefined &&
      (!Number.isInteger(expectedRevision) || expectedRevision < 0))
  ) {
    return Promise.resolve({ ok: false, reason: 'invalid' })
  }

  return runWithStorageMutationLock((): BillDraftWriteResult => {
    try {
      const current = readCurrentDraft(now)
      if (current.state === 'expired') {
        return { ok: false, reason: 'expired' }
      }
      if (
        expectedRevision !== undefined &&
        (current.state !== 'valid' ||
          current.draft.revision !== expectedRevision)
      ) {
        return { ok: false, reason: 'stale' }
      }

      const activeSessionId = readStorageActivePointer()?.sessionId
      const sessionId =
        activeSessionId ??
        (current.state === 'valid'
          ? current.draft.sessionId
          : createDraftSessionId())
      const sameSession =
        current.state === 'valid' && current.draft.sessionId === sessionId
      if (
        current.state === 'valid' &&
        !sameSession &&
        expectedRevision !== undefined
      ) {
        return { ok: false, reason: 'stale' }
      }

      const createdAt = sameSession
        ? current.draft.createdAt
        : new Date(now).toISOString()
      const expiresAt = sameSession
        ? current.draft.expiresAt
        : new Date(now + dayMs).toISOString()
      const next: BillEntryDraft = {
        version: 1,
        sessionId,
        revision: sameSession ? current.draft.revision + 1 : 0,
        createdAt,
        expiresAt,
        rows,
      }
      const serialized = JSON.stringify(next)
      if (!parseBillEntryDraft(serialized, sessionId)) {
        return { ok: false, reason: 'invalid' }
      }

      const key = billEntryDraftKeyFor(sessionId)
      const previousDraftRaw = localStorage.getItem(key)
      const previousPointerRaw = localStorage.getItem(billEntryDraftPointerKey)
      const nextPointerRaw = JSON.stringify({ version: 1, sessionId })
      let written: BillEntryDraft
      try {
        localStorage.setItem(key, serialized)
        const readbackRaw = localStorage.getItem(key)
        const readback = parseBillEntryDraft(readbackRaw, sessionId)
        if (!readback || readbackRaw !== serialized) {
          throw new Error('draft readback failed')
        }
        written = readback
        localStorage.setItem(billEntryDraftPointerKey, nextPointerRaw)
        if (localStorage.getItem(billEntryDraftPointerKey) !== nextPointerRaw) {
          throw new Error('draft pointer readback failed')
        }
      } catch {
        restoreStorageValue(key, previousDraftRaw)
        restoreStorageValue(billEntryDraftPointerKey, previousPointerRaw)
        return { ok: false, reason: 'storage-error' }
      }

      if (current.state === 'valid' && !sameSession) {
        try {
          localStorage.removeItem(
            billEntryDraftKeyFor(current.draft.sessionId),
          )
        } catch {
          // The active pointer is valid; orphan cleanup can retry later.
        }
      }
      return { ok: true, draft: written }
    } catch {
      return { ok: false, reason: 'storage-error' }
    }
  }).catch(() => ({ ok: false, reason: 'lock-error' }))
}

const removeCurrentDraftUnlocked = () => {
  const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
  if (!pointerRaw) return false
  const pointer = parseDraftPointer(pointerRaw)
  if (!pointer) {
    localStorage.removeItem(billEntryDraftPointerKey)
    return localStorage.getItem(billEntryDraftPointerKey) === null
  }
  const key = billEntryDraftKeyFor(pointer.sessionId)
  localStorage.removeItem(key)
  if (localStorage.getItem(key) !== null) return false
  localStorage.removeItem(billEntryDraftPointerKey)
  return localStorage.getItem(billEntryDraftPointerKey) === null
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
): Promise<boolean> =>
  runWithStorageMutationLock(() => {
    try {
      const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
      if (!pointerRaw) return false
      const pointer = parseDraftPointer(pointerRaw)
      if (!pointer) return removeCurrentDraftUnlocked()
      const raw = localStorage.getItem(billEntryDraftKeyFor(pointer.sessionId))
      const draft = parseBillEntryDraft(raw, pointer.sessionId)
      if (draft && Date.parse(draft.expiresAt) > now) return false
      return removeCurrentDraftUnlocked()
    } catch {
      return false
    }
  }).catch(() => false)
