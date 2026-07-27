import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManualBillDraftRow } from '../../lib/billInput'
import {
  createManualBillDraftLifecycle,
  type ManualBillDraftPersistence,
} from './manualBillDraftLifecycle'

const makeRow = (patch: Partial<ManualBillDraftRow> = {}): ManualBillDraftRow => ({
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
})

const createPersistence = (): ManualBillDraftPersistence => ({
  write: vi.fn(async () => successfulWrite()),
  remove: vi.fn(async () => true),
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
  it('cancels a pending debounce before removal', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const lifecycle = createManualBillDraftLifecycle({ persistence })

    lifecycle.schedule([makeRow()])
    await lifecycle.remove()
    await vi.runAllTimersAsync()

    expect(persistence.write).not.toHaveBeenCalled()
    expect(persistence.remove).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight write before removing the draft', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    let finishWrite: ((value: ReturnType<typeof successfulWrite>) => void) | undefined
    persistence.write = vi.fn(() => new Promise<ReturnType<typeof successfulWrite>>((resolve) => {
      finishWrite = resolve
    }))
    const lifecycle = createManualBillDraftLifecycle({ persistence })

    lifecycle.schedule([makeRow()])
    await vi.advanceTimersByTimeAsync(300)
    const removal = lifecycle.remove()
    expect(persistence.remove).not.toHaveBeenCalled()
    finishWrite?.(successfulWrite())
    await removal

    expect(persistence.remove).toHaveBeenCalledTimes(1)
  })

  it('reports a removal failure without treating a stale write completion as saved', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const statuses: string[] = []
    let finishWrite: ((value: ReturnType<typeof successfulWrite>) => void) | undefined
    persistence.write = vi.fn(() => new Promise<ReturnType<typeof successfulWrite>>((resolve) => {
      finishWrite = resolve
    }))
    persistence.remove = vi.fn(async () => false)
    const lifecycle = createManualBillDraftLifecycle({
      persistence,
      onStatus: (status) => statuses.push(status),
    })

    lifecycle.schedule([makeRow()])
    await vi.advanceTimersByTimeAsync(300)
    const removal = lifecycle.remove()
    finishWrite?.(successfulWrite())

    await expect(removal).resolves.toEqual({ ok: false })
    expect(statuses).not.toContain('saved')
    expect(statuses).toContain('remove-failed')
  })

  it('converts rejected writes and removals into honest failure statuses', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const statuses: string[] = []
    persistence.write = vi.fn(async () => { throw new Error('write failed') })
    persistence.remove = vi.fn(async () => { throw new Error('remove failed') })
    const lifecycle = createManualBillDraftLifecycle({
      persistence,
      onStatus: (status) => statuses.push(status),
    })

    lifecycle.schedule([makeRow()])
    await vi.advanceTimersByTimeAsync(300)
    await expect(lifecycle.remove()).resolves.toEqual({ ok: false })

    expect(statuses).toContain('write-failed')
    expect(statuses).toContain('remove-failed')
  })

  it('writes the latest edit scheduled during a successful removal without reviving the old snapshot', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const removal = deferred<boolean>()
    persistence.remove = vi.fn(() => removal.promise)
    const lifecycle = createManualBillDraftLifecycle({ persistence })

    lifecycle.schedule([makeRow({ usageKwh: '10' })])
    const remove = lifecycle.remove()
    await Promise.resolve()
    lifecycle.schedule([makeRow({ usageKwh: '20' })])
    removal.resolve(true)
    await expect(remove).resolves.toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(300)

    expect(persistence.write).toHaveBeenCalledTimes(1)
    expect(persistence.write).toHaveBeenLastCalledWith(
      [expect.objectContaining({ usageKwh: '20' })],
      undefined,
    )
  })

  it('writes the latest edit after a failed removal with the refreshed revision', async () => {
    vi.useFakeTimers()
    const persistence = createPersistence()
    const removal = deferred<boolean>()
    persistence.remove = vi.fn(() => removal.promise)
    persistence.read = vi.fn(() => ({ ...successfulWrite(7).draft, revision: 7 }))
    const lifecycle = createManualBillDraftLifecycle({
      initialRevision: 3,
      persistence,
    })

    lifecycle.schedule([makeRow({ usageKwh: '10' })])
    const remove = lifecycle.remove()
    await Promise.resolve()
    lifecycle.schedule([makeRow({ usageKwh: '30' })])
    removal.resolve(false)
    await expect(remove).resolves.toEqual({ ok: false })
    await vi.advanceTimersByTimeAsync(300)

    expect(persistence.write).toHaveBeenCalledTimes(1)
    expect(persistence.write).toHaveBeenLastCalledWith(
      [expect.objectContaining({ usageKwh: '30' })],
      7,
    )
  })
})
