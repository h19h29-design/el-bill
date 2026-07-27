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

export interface ManualBillDraftApplyToken {
  generation: number
  identity: BillEntryDraftIdentity | null
}

export type ManualBillDraftPrepareResult =
  | { ok: true; token: ManualBillDraftApplyToken }
  | { ok: false; reason: 'changed' | 'write-failed' }

export type ManualBillDraftCompleteResult =
  | { ok: true }
  | { ok: false; reason: 'changed' | 'remove-failed' }

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
  remove: () => Promise<{ ok: boolean }>
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
  let disposed = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const refreshIdentity = () => {
    try {
      const record = persistence.read?.()
      revision = record?.draft.revision
      identity = record?.identity ?? null
    } catch {
      // Keep the last observed identity so a later retry remains a CAS operation.
    }
  }

  const persist = (snapshot: PendingSnapshot) => {
    let outcome: BillDraftWriteResult | null = null
    writeChain = writeChain.then(async () => {
      if (disposed) return
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
        onStatus?.('write-failed')
      }
    })
    return writeChain.then(() => outcome)
  }

  const armPendingWrite = () => {
    if (
      disposed ||
      applyingToken !== null ||
      pending === null ||
      timer !== null
    ) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      const snapshot = pending
      if (!snapshot || applyingToken !== null || disposed) return
      pending = null
      void persist(snapshot).then(() => armPendingWrite())
    }, debounceMs)
  }

  const releaseApply = () => {
    applyingToken = null
    armPendingWrite()
  }

  const schedule = (rows: ManualBillDraftRow[]) => {
    if (disposed) return
    generation += 1
    pending = {
      generation,
      rows: cloneRows(rows),
    }
    clearTimer()
    armPendingWrite()
  }

  const prepareForApply = async (): Promise<ManualBillDraftPrepareResult> => {
    if (disposed || applyingToken !== null) {
      return { ok: false, reason: 'changed' }
    }
    clearTimer()
    const applyGeneration = generation
    applyingToken = { generation: applyGeneration, identity }
    await writeChain
    if (disposed || generation !== applyGeneration) {
      releaseApply()
      return { ok: false, reason: 'changed' }
    }

    const snapshot = pending
    if (snapshot) {
      pending = null
      const result = await persist(snapshot)
      if (!result?.ok) {
        releaseApply()
        return { ok: false, reason: 'write-failed' }
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
    if (result.ok) {
      revision = undefined
      identity = null
    } else {
      refreshIdentity()
    }
    releaseApply()

    if (changed) return { ok: false, reason: 'changed' }
    if (!result.ok) {
      onStatus?.('remove-failed')
      return { ok: false, reason: 'remove-failed' }
    }
    return { ok: true }
  }

  const cancelApply = (token: ManualBillDraftApplyToken) => {
    if (applyingToken !== token) return
    releaseApply()
  }

  const remove = async () => {
    if (disposed) return { ok: true }
    generation += 1
    const removalGeneration = generation
    pending = null
    clearTimer()
    applyingToken = {
      generation: removalGeneration,
      identity,
    }
    await writeChain

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
    } else {
      refreshIdentity()
      onStatus?.('remove-failed')
    }
    releaseApply()
    return { ok: result.ok }
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
