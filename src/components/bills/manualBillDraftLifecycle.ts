import type { ManualBillDraftRow } from '../../lib/billInput'
import {
  readBillEntryDraftRecord,
  removeBillEntryDraft,
  writeBillEntryDraft,
  type BillDraftRemovalResult,
  type BillDraftWriteResult,
  type BillEntryDraftIdentity,
  type BillEntryDraftRecord,
} from '../../lib/billDraftStorage'

export interface ManualBillDraftPersistence {
  read?: () => BillEntryDraftRecord | null
  write: (
    rows: ManualBillDraftRow[],
    expectedRevision?: number,
  ) => Promise<BillDraftWriteResult>
  remove: (
    expected: BillEntryDraftIdentity | null,
  ) => Promise<BillDraftRemovalResult>
}

export type ManualBillDraftLifecycleStatus =
  | 'saved'
  | 'write-failed'
  | 'remove-failed'
  | 'conflict'

export interface ManualBillDraftApplyToken {
  generation: number
  identity: BillEntryDraftIdentity | null
}

export type ManualBillDraftPrepareResult =
  | { ok: true; token: ManualBillDraftApplyToken }
  | { ok: false; reason: 'changed' | 'write-failed' | 'conflict' }

export type ManualBillDraftCompleteResult =
  | { ok: true }
  | { ok: false; reason: 'changed' | 'remove-failed' | 'conflict' }

export type ManualBillDraftRemoveResult =
  | { ok: true }
  | { ok: false; reason: 'remove-failed' | 'conflict' }

interface ManualBillDraftLifecycleOptions {
  initialRevision?: number
  initialIdentity?: BillEntryDraftIdentity
  persistence?: ManualBillDraftPersistence
  onStatus?: (status: ManualBillDraftLifecycleStatus) => void
  debounceMs?: number
}

export interface ManualBillDraftLifecycle {
  schedule: (rows: ManualBillDraftRow[]) => void
  prepareForApply: () => Promise<ManualBillDraftPrepareResult>
  completeApply: (
    token: ManualBillDraftApplyToken,
  ) => Promise<ManualBillDraftCompleteResult>
  cancelApply: (token: ManualBillDraftApplyToken) => void
  remove: () => Promise<ManualBillDraftRemoveResult>
  dispose: () => void
}

const defaultPersistence: ManualBillDraftPersistence = {
  read: readBillEntryDraftRecord,
  write: writeBillEntryDraft,
  remove: removeBillEntryDraft,
}

interface PendingSnapshot {
  generation: number
  rows: ManualBillDraftRow[]
}

const cloneRows = (rows: ManualBillDraftRow[]) =>
  rows.map((row) => ({ ...row }))

export const createManualBillDraftLifecycle = ({
  initialRevision,
  initialIdentity,
  persistence = defaultPersistence,
  onStatus,
  debounceMs = 300,
}: ManualBillDraftLifecycleOptions = {}): ManualBillDraftLifecycle => {
  let revision = initialRevision
  let identity = initialIdentity ?? null
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let writeChain = Promise.resolve()
  let pending: PendingSnapshot | null = null
  let applyingToken: ManualBillDraftApplyToken | null = null
  let conflicted = false
  let removalRecovery = false
  let disposed = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const enterConflict = () => {
    conflicted = true
    removalRecovery = false
    clearTimer()
    pending = null
    onStatus?.('conflict')
  }

  const enterRemovalRecovery = () => {
    removalRecovery = true
    clearTimer()
    onStatus?.('remove-failed')
  }

  const persist = (snapshot: PendingSnapshot) => {
    let outcome: BillDraftWriteResult | null = null
    writeChain = writeChain.then(async () => {
      if (disposed || conflicted || removalRecovery) return
      try {
        outcome = await persistence.write(snapshot.rows, revision)
      } catch {
        outcome = { ok: false, reason: 'storage-error' }
      }
      if (outcome.ok) {
        revision = outcome.draft.revision
        identity = outcome.identity
        if (
          snapshot.generation === generation &&
          applyingToken === null &&
          !disposed
        ) {
          onStatus?.('saved')
        }
      } else if (!disposed) {
        if (outcome.reason === 'stale') {
          enterConflict()
        } else {
          onStatus?.('write-failed')
        }
      }
    })
    return writeChain.then(() => outcome)
  }

  const armPendingWrite = () => {
    if (
      disposed ||
      conflicted ||
      removalRecovery ||
      applyingToken !== null ||
      pending === null ||
      timer !== null
    ) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      const snapshot = pending
      if (
        !snapshot ||
        applyingToken !== null ||
        disposed ||
        conflicted ||
        removalRecovery
      ) return
      pending = null
      void persist(snapshot).then(() => armPendingWrite())
    }, debounceMs)
  }

  const releaseApply = () => {
    applyingToken = null
    armPendingWrite()
  }

  const schedule = (rows: ManualBillDraftRow[]) => {
    if (disposed || conflicted) return
    generation += 1
    pending = {
      generation,
      rows: cloneRows(rows),
    }
    clearTimer()
    armPendingWrite()
  }

  const prepareForApply = async (): Promise<ManualBillDraftPrepareResult> => {
    if (conflicted) {
      return { ok: false, reason: 'conflict' }
    }
    if (disposed || applyingToken !== null) {
      return { ok: false, reason: 'changed' }
    }
    clearTimer()
    const applyGeneration = generation
    applyingToken = { generation: applyGeneration, identity }
    await writeChain
    if (conflicted) {
      releaseApply()
      return { ok: false, reason: 'conflict' }
    }
    if (disposed || generation !== applyGeneration) {
      releaseApply()
      return { ok: false, reason: 'changed' }
    }

    const snapshot = pending
    if (snapshot && !removalRecovery) {
      pending = null
      const result = await persist(snapshot)
      if (!result?.ok) {
        releaseApply()
        return {
          ok: false,
          reason: conflicted ? 'conflict' : 'write-failed',
        }
      }
      if (disposed || generation !== applyGeneration) {
        releaseApply()
        return { ok: false, reason: 'changed' }
      }
    }

    const token = { generation: applyGeneration, identity }
    applyingToken = token
    return { ok: true, token }
  }

  const completeApply = async (
    token: ManualBillDraftApplyToken,
  ): Promise<ManualBillDraftCompleteResult> => {
    if (conflicted) {
      return { ok: false, reason: 'conflict' }
    }
    if (
      disposed ||
      applyingToken !== token ||
      generation !== token.generation
    ) {
      releaseApply()
      return { ok: false, reason: 'changed' }
    }

    let result: BillDraftRemovalResult
    try {
      result = await persistence.remove(token.identity)
    } catch {
      result = { ok: false, reason: 'storage-error' }
    }

    const changed = generation !== token.generation
    const wasRemovalRecovery = removalRecovery
    if (result.ok) {
      revision = undefined
      identity = null
      removalRecovery = false
      if (wasRemovalRecovery && !changed) pending = null
    } else if (result.reason === 'stale') {
      enterConflict()
    } else {
      enterRemovalRecovery()
    }
    releaseApply()

    if (!result.ok && result.reason === 'stale') {
      return { ok: false, reason: 'conflict' }
    }
    if (!result.ok) {
      return { ok: false, reason: 'remove-failed' }
    }
    if (changed) return { ok: false, reason: 'changed' }
    return { ok: true }
  }

  const cancelApply = (token: ManualBillDraftApplyToken) => {
    if (applyingToken !== token) return
    releaseApply()
  }

  const remove = async (): Promise<ManualBillDraftRemoveResult> => {
    if (disposed) return { ok: true }
    if (conflicted) return { ok: false, reason: 'conflict' }
    generation += 1
    const removalGeneration = generation
    pending = null
    clearTimer()
    applyingToken = {
      generation: removalGeneration,
      identity,
    }
    await writeChain
    if (conflicted) {
      releaseApply()
      return { ok: false, reason: 'conflict' }
    }

    const expectedIdentity = identity
    let result: BillDraftRemovalResult
    try {
      result = await persistence.remove(expectedIdentity)
    } catch {
      result = { ok: false, reason: 'storage-error' }
    }
    if (result.ok) {
      revision = undefined
      identity = null
      removalRecovery = false
    } else if (result.reason === 'stale') {
      enterConflict()
    } else {
      enterRemovalRecovery()
    }
    releaseApply()
    if (result.ok) return { ok: true }
    return {
      ok: false,
      reason: result.reason === 'stale' ? 'conflict' : 'remove-failed',
    }
  }

  const dispose = () => {
    disposed = true
    generation += 1
    clearTimer()
    pending = null
    applyingToken = null
  }

  return {
    schedule,
    prepareForApply,
    completeApply,
    cancelApply,
    remove,
    dispose,
  }
}
