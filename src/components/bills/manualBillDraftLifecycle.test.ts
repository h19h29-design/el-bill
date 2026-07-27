import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManualBillDraftRow } from '../../lib/billInput'
import type {
  BillDraftRemovalResult,
  BillEntryDraftIdentity,
} from '../../lib/billDraftStorage'
import {
  createManualBillDraftLifecycle,
  type ManualBillDraftPersistence,
} from './manualBillDraftLifecycle'

const makeRow = (
  patch: Partial<ManualBillDraftRow> = {},
): ManualBillDraftRow => ({
  id: 'row-1',
  yearMonth: '2026-07',
  usageKwh: '10',
  totalBillWon: '100',
  maxDemandKw: '',
  appliedPowerKw: '',
  baseChargeWon: '',
  energyChargeWon: '',
  powerFactorChargeWon: '',
  climateChargeWon: '',
  fuelAdjustmentWon: '',
  vatWon: '',
  fundWon: '',
  note: '',
  ...patch,
})

const identityFor = (revision: number): BillEntryDraftIdentity => ({
  sessionId: 'draft-session',
  revision,
  generationId: `generation-${revision}`,
  storageKey: `el-bill:bill-entry-draft:v1:draft-session:generation-${revision}`,
})

const successfulWrite = (revision = 0) => ({
  ok: true as const,
  draft: {
    version: 1 as const,
    sessionId: 'draft-session',
    revision,
    createdAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-02T00:00:00.000Z',
    rows: [makeRow()],
  },
  identity: identityFor(revision),
})

const createPersistence = (): ManualBillDraftPersistence => ({
  read: vi.fn(() => null),
  write: vi.fn(async () => successfulWrite()),
  remove: vi.fn(async () => ({ ok: true as const, removed: true })),
})

const deferred = <Value,>() => {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

describe('manual bill draft lifecycle', () => {
  it('flushes a pending debounce and CAS-removes the resulting identity before apply completes', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const lifecycle = createManualBillDraftLifecycle({ persistence })

    lifecycle.schedule([makeRow()])
    const prepared = await lifecycle.prepareForApply()

    expect(persistence.write).toHaveBeenCalledWith([makeRow()], undefined)
    expect(prepared).toEqual({
      ok: true,
      token: { generation: 1, identity: identityFor(0) },
    })
    if (!prepared.ok) return
    await expect(lifecycle.completeApply(prepared.token)).resolves.toEqual({
      ok: true,
    })
    expect(persistence.remove).toHaveBeenCalledWith(identityFor(0))
    await vi.runAllTimersAsync()
    expect(persistence.write).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight write before preparing exact removal', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const write = deferred<ReturnType<typeof successfulWrite>>()
    persistence.write = vi.fn(() => write.promise)
    const lifecycle = createManualBillDraftLifecycle({ persistence })

    lifecycle.schedule([makeRow()])
    await vi.advanceTimersByTimeAsync(300)
    const preparation = lifecycle.prepareForApply()
    expect(persistence.remove).not.toHaveBeenCalled()
    write.resolve(successfulWrite())
    const prepared = await preparation
    expect(prepared).toEqual({
      ok: true,
      token: { generation: 1, identity: identityFor(0) },
    })
  })

  it('reports rejected writes and removals as honest apply failures', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const statuses: string[] = []
    persistence.write = vi.fn(async () => {
      throw new Error('write failed')
    })
    const lifecycle = createManualBillDraftLifecycle({
      persistence,
      onStatus: (status) => statuses.push(status),
    })

    lifecycle.schedule([makeRow()])
    await expect(lifecycle.prepareForApply()).resolves.toEqual({
      ok: false,
      reason: 'write-failed',
    })
    expect(statuses).toContain('write-failed')

    const removalFailure = createManualBillDraftLifecycle({
      initialRevision: 0,
      initialIdentity: identityFor(0),
      persistence: {
        ...createPersistence(),
        remove: vi.fn(async () => {
          throw new Error('remove failed')
        }),
      },
      onStatus: (status) => statuses.push(status),
    })
    const prepared = await removalFailure.prepareForApply()
    if (!prepared.ok) return
    await expect(
      removalFailure.completeApply(prepared.token),
    ).resolves.toEqual({ ok: false, reason: 'remove-failed' })
    expect(statuses).toContain('remove-failed')
  })

  it('preserves an edit made while CAS removal is in flight and blocks apply completion', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const removal = deferred<BillDraftRemovalResult>()
    persistence.remove = vi.fn(() => removal.promise)
    const lifecycle = createManualBillDraftLifecycle({
      initialRevision: 0,
      initialIdentity: identityFor(0),
      persistence,
    })
    const prepared = await lifecycle.prepareForApply()
    if (!prepared.ok) throw new Error('draft preparation failed')

    const completion = lifecycle.completeApply(prepared.token)
    lifecycle.schedule([makeRow({ usageKwh: '20' })])
    removal.resolve({ ok: true, removed: true })

    await expect(completion).resolves.toEqual({
      ok: false,
      reason: 'changed',
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(persistence.write).toHaveBeenCalledWith(
      [expect.objectContaining({ usageKwh: '20' })],
      undefined,
    )
  })

  it('reports a stale apply removal as a conflict without reading or adopting a newer identity', async () => {
    const persistence = createPersistence()
    const statuses: string[] = []
    persistence.remove = vi.fn(async () => ({
      ok: false as const,
      reason: 'stale' as const,
    }))
    persistence.read = vi.fn(() => ({
      draft: successfulWrite(7).draft,
      identity: identityFor(7),
    }))
    const lifecycle = createManualBillDraftLifecycle({
      initialRevision: 3,
      initialIdentity: identityFor(3),
      persistence,
      onStatus: (status) => statuses.push(status),
    })
    const prepared = await lifecycle.prepareForApply()
    if (!prepared.ok) throw new Error('draft preparation failed')

    await expect(lifecycle.completeApply(prepared.token)).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(persistence.remove).toHaveBeenCalledOnce()
    expect(persistence.remove).toHaveBeenCalledWith(identityFor(3))
    expect(persistence.read).not.toHaveBeenCalled()
    expect(statuses).toEqual(['conflict'])

    await expect(lifecycle.prepareForApply()).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    })
    await expect(lifecycle.remove()).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(persistence.remove).toHaveBeenCalledOnce()
  })

  it('does not persist queued or later edits after a stale removal conflict', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const removal = deferred<BillDraftRemovalResult>()
    persistence.remove = vi.fn(() => removal.promise)
    const lifecycle = createManualBillDraftLifecycle({
      initialRevision: 3,
      initialIdentity: identityFor(3),
      persistence,
    })
    const prepared = await lifecycle.prepareForApply()
    if (!prepared.ok) throw new Error('draft preparation failed')

    const completion = lifecycle.completeApply(prepared.token)
    lifecycle.schedule([makeRow({ usageKwh: '20' })])
    removal.resolve({ ok: false, reason: 'stale' })
    await expect(completion).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    })
    lifecycle.schedule([makeRow({ usageKwh: '30' })])
    await vi.runAllTimersAsync()

    expect(persistence.write).not.toHaveBeenCalled()
    expect(persistence.remove).toHaveBeenCalledOnce()
  })

  it('reports stale writes as conflicts and blocks later writes', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    persistence.write = vi.fn(async () => ({
      ok: false as const,
      reason: 'stale' as const,
    }))
    const statuses: string[] = []
    const lifecycle = createManualBillDraftLifecycle({
      initialRevision: 3,
      initialIdentity: identityFor(3),
      persistence,
      onStatus: (status) => statuses.push(status),
    })

    lifecycle.schedule([makeRow({ usageKwh: '20' })])
    await expect(lifecycle.prepareForApply()).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    })
    lifecycle.schedule([makeRow({ usageKwh: '30' })])
    await vi.runAllTimersAsync()

    expect(statuses).toEqual(['conflict'])
    expect(persistence.write).toHaveBeenCalledOnce()
    expect(persistence.write).toHaveBeenCalledWith(
      [expect.objectContaining({ usageKwh: '20' })],
      3,
    )
  })

  it('retries a transient removal failure only with the original identity', async () => {
    const persistence = createPersistence()
    persistence.remove = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'storage-error' })
      .mockResolvedValueOnce({ ok: true, removed: true })
    persistence.read = vi.fn(() => ({
      draft: successfulWrite(7).draft,
      identity: identityFor(7),
    }))
    const lifecycle = createManualBillDraftLifecycle({
      initialRevision: 3,
      initialIdentity: identityFor(3),
      persistence,
    })

    const firstPrepared = await lifecycle.prepareForApply()
    if (!firstPrepared.ok) throw new Error('first draft preparation failed')
    await expect(
      lifecycle.completeApply(firstPrepared.token),
    ).resolves.toEqual({ ok: false, reason: 'remove-failed' })

    const retryPrepared = await lifecycle.prepareForApply()
    if (!retryPrepared.ok) throw new Error('retry draft preparation failed')
    await expect(
      lifecycle.completeApply(retryPrepared.token),
    ).resolves.toEqual({ ok: true })

    expect(persistence.read).not.toHaveBeenCalled()
    expect(persistence.remove).toHaveBeenNthCalledWith(1, identityFor(3))
    expect(persistence.remove).toHaveBeenNthCalledWith(2, identityFor(3))
  })

  it('cancels a prepared apply without deleting its draft', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const lifecycle = createManualBillDraftLifecycle({
      initialRevision: 0,
      initialIdentity: identityFor(0),
      persistence,
    })
    const prepared = await lifecycle.prepareForApply()
    if (!prepared.ok) return

    lifecycle.cancelApply(prepared.token)
    await vi.runAllTimersAsync()

    expect(persistence.remove).not.toHaveBeenCalled()
    expect(persistence.write).not.toHaveBeenCalled()
  })

  it('disposes pending and future work without touching persistence', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const lifecycle = createManualBillDraftLifecycle({ persistence })

    lifecycle.schedule([makeRow()])
    lifecycle.dispose()
    lifecycle.schedule([makeRow({ usageKwh: '20' })])
    await vi.runAllTimersAsync()

    await expect(lifecycle.prepareForApply()).resolves.toEqual({
      ok: false,
      reason: 'changed',
    })
    expect(persistence.write).not.toHaveBeenCalled()
    expect(persistence.remove).not.toHaveBeenCalled()
  })
})
