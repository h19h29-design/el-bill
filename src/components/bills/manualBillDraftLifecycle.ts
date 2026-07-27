import type { ManualBillDraftRow } from '../../lib/billInput'
import {
  readBillEntryDraft,
  removeBillEntryDraft,
  writeBillEntryDraft,
  type BillDraftWriteResult,
  type BillEntryDraft,
} from '../../lib/billDraftStorage'

export interface ManualBillDraftPersistence {
  read?: () => BillEntryDraft | null
  write: (
    rows: ManualBillDraftRow[],
    expectedRevision?: number,
  ) => Promise<BillDraftWriteResult>
  remove: () => Promise<boolean>
}

export type ManualBillDraftLifecycleStatus =
  | 'saved'
  | 'write-failed'
  | 'remove-failed'

interface ManualBillDraftLifecycleOptions {
  initialRevision?: number
  persistence?: ManualBillDraftPersistence
  onStatus?: (status: ManualBillDraftLifecycleStatus) => void
  debounceMs?: number
}

export interface ManualBillDraftLifecycle {
  schedule: (rows: ManualBillDraftRow[]) => void
  remove: () => Promise<{ ok: boolean }>
  dispose: () => void
}

const defaultPersistence: ManualBillDraftPersistence = {
  read: readBillEntryDraft,
  write: writeBillEntryDraft,
  remove: removeBillEntryDraft,
}

export const createManualBillDraftLifecycle = ({
  initialRevision,
  persistence = defaultPersistence,
  onStatus,
  debounceMs = 300,
}: ManualBillDraftLifecycleOptions = {}): ManualBillDraftLifecycle => {
  let revision = initialRevision
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let writeChain = Promise.resolve()
  let removing = false
  let deferredRows: ManualBillDraftRow[] | null = null
  let disposed = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const takeDeferredRows = (): ManualBillDraftRow[] | null => {
    const nextRows = deferredRows
    deferredRows = null
    return nextRows
  }

  const scheduleSnapshot = (snapshot: ManualBillDraftRow[]) => {
    if (disposed) return
    generation += 1
    const writeGeneration = generation
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      writeChain = writeChain.then(async () => {
        if (writeGeneration !== generation || removing || disposed) return
        let result: BillDraftWriteResult
        try {
          result = await persistence.write(snapshot, revision)
        } catch {
          if (writeGeneration === generation && !removing && !disposed) onStatus?.('write-failed')
          return
        }
        if (writeGeneration !== generation || removing || disposed) return
        if (result.ok) {
          revision = result.draft.revision
          onStatus?.('saved')
          return
        }
        onStatus?.('write-failed')
      })
    }, debounceMs)
  }

  const schedule = (rows: ManualBillDraftRow[]) => {
    if (disposed) return
    const snapshot = rows.map((row) => ({ ...row }))
    if (removing) {
      deferredRows = snapshot
      return
    }
    scheduleSnapshot(snapshot)
  }

  const remove = async () => {
    if (disposed) return { ok: true }
    generation += 1
    clearTimer()
    deferredRows = null
    removing = true
    await writeChain
    let removed = false
    try {
      removed = await persistence.remove()
    } catch {
      removed = false
    }
    removing = false
    let currentDraft: BillEntryDraft | null | undefined
    try {
      currentDraft = persistence.read?.()
    } catch {
      currentDraft = undefined
    }
    const nextRows = takeDeferredRows()
    if (removed || currentDraft === null) {
      revision = undefined
      if (nextRows?.length) scheduleSnapshot(nextRows)
      return { ok: true }
    }
    revision = currentDraft?.revision ?? revision
    onStatus?.('remove-failed')
    if (nextRows?.length) scheduleSnapshot(nextRows)
    return { ok: false }
  }

  const dispose = () => {
    disposed = true
    generation += 1
    clearTimer()
    deferredRows = null
  }

  return { schedule, remove, dispose }
}
