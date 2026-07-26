/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from '../data/sampleBills'
import { defaultCalculationSettings } from './calculationSettings'
import { samplePowerPlannerDataSource } from '../data/samplePowerPlanner'
import {
  applyPowerPlannerStorageIntent,
  type PowerPlannerSaveResult,
  type PowerPlannerStorageIntent,
} from './powerPlanner'
import {
  applyPeakScenarioIntent,
  applyRatePlanIntent,
} from './persistedIntents'
import {
  cleanupExpiredStorageSnapshots,
  getNextStorageSnapshotExpiry,
  getNextStorageExpiry,
  initializeStorageAfterMount,
  purgeExpiredStorageSnapshot,
  readStorageSnapshot,
  removeStorageSnapshot,
  rotateNewStorageSnapshot,
  startNewStorageSnapshot,
  storageActivePointerKey,
  storageMutationLockName,
  storageSnapshotKeyFor,
  updateStorageSnapshot,
  type StorageSnapshotData,
} from './storage'

const dayMs = 24 * 60 * 60 * 1000
const now = Date.parse('2026-07-26T00:00:00.000Z')

const makeData = (): StorageSnapshotData => ({
  bills: sampleBills,
  profile: defaultSchoolProfile,
  scenario: defaultScenario,
  ratePlans: defaultRatePlans,
  calculationSettings: defaultCalculationSettings,
  powerPlanner: null,
  provenance: { bills: 'uploaded', powerPlanner: 'none' },
})

const legacyPayload = (data: unknown) =>
  JSON.stringify({
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + dayMs).toISOString(),
    data,
  })

interface QueuedLockRequest {
  callback: (lock: Lock) => unknown
  reject: (reason?: unknown) => void
  resolve: (value: unknown | PromiseLike<unknown>) => void
}

const setLocks = (locks: Pick<LockManager, 'request'> | undefined) => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  })
}

const installSerialLock = () => {
  const names: string[] = []
  let tail = Promise.resolve<unknown>(undefined)
  setLocks({
    request: ((name: string, ...args: unknown[]) => {
      names.push(name)
      const callback = args.at(-1) as (lock: Lock) => unknown
      const run = tail.then(() =>
        callback({ name, mode: 'exclusive' } as Lock),
      )
      tail = run.catch(() => undefined)
      return run
    }) as LockManager['request'],
  })
  return names
}

const installManualLock = () => {
  const pending: QueuedLockRequest[] = []
  setLocks({
    request: ((_: string, ...args: unknown[]) => {
      const callback = args.at(-1) as (lock: Lock) => unknown
      return new Promise<unknown>((resolve, reject) => {
        pending.push({ callback, resolve, reject })
      })
    }) as LockManager['request'],
  })
  const run = async (index: number) => {
    const request = pending[index]
    try {
      const value = await request.callback({
        name: storageMutationLockName,
        mode: 'exclusive',
      } as Lock)
      request.resolve(value)
    } catch (error) {
      request.reject(error)
    }
  }
  return { pending, run }
}

describe('storage mutation lock and patch protocol', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    localStorage.clear()
    setLocks(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
    setLocks(undefined)
  })

  it('uses one named exclusive Web Lock for every storage mutation', async () => {
    const lockNames = installSerialLock()
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'locked-session')).ok,
    ).toBe(true)
    expect(
      (
        await updateStorageSnapshot('locked-session', {
          profile: {
            ...defaultSchoolProfile,
            displaySchoolName: '변경 학교',
          },
        })
      ).ok,
    ).toBe(true)
    await cleanupExpiredStorageSnapshots(now)
    await purgeExpiredStorageSnapshot('missing-session', now)
    await initializeStorageAfterMount(makeData(), now)
    await removeStorageSnapshot('locked-session')

    expect(lockNames).toEqual([
      storageMutationLockName,
      storageMutationLockName,
      storageMutationLockName,
      storageMutationLockName,
      storageMutationLockName,
      storageMutationLockName,
    ])
  })

  it('returns a lock error when Web Locks cannot acquire the mutation lock', async () => {
    setLocks({
      request: (() => {
        throw new Error('lock unavailable')
      }) as LockManager['request'],
    })

    await expect(
      startNewStorageSnapshot(makeData(), now, 'lock-failure-session'),
    ).resolves.toEqual({ ok: false, reason: 'lock-error' })
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
  })

  it('merges two stale-tab patches into the latest snapshot under Web Locks', async () => {
    const lockNames = installSerialLock()
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'patch-session')).ok,
    ).toBe(true)
    const staleProfile = {
      ...defaultSchoolProfile,
      displaySchoolName: '패치 학교',
    }
    const staleScenario = {
      ...defaultScenario,
      targetPeakKw: 612,
    }
    const staleCalculationSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
    }

    const profileWrite = updateStorageSnapshot('patch-session', {
      profile: staleProfile,
    })
    const scenarioWrite = updateStorageSnapshot('patch-session', {
      scenario: staleScenario,
      calculationSettings: staleCalculationSettings,
    })
    const [profileResult, scenarioResult] = await Promise.all([
      profileWrite,
      scenarioWrite,
    ])

    expect(profileResult.ok).toBe(true)
    expect(scenarioResult.ok).toBe(true)
    expect(readStorageSnapshot(now)).toEqual(
      expect.objectContaining({
        revision: 2,
        data: expect.objectContaining({
          profile: staleProfile,
          scenario: staleScenario,
          calculationSettings: staleCalculationSettings,
        }),
      }),
    )
    expect(lockNames).toHaveLength(3)
  })

  it('rotates a stale bill upload from the latest locked snapshot without overwriting settings', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'bill-base')).ok,
    ).toBe(true)
    const locks = installManualLock()
    const latestSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
      climateEnvironmentWonPerKwh: 17,
    }
    const settingsEdit = updateStorageSnapshot('bill-base', {
      calculationSettings: latestSettings,
      profile: {
        ...defaultSchoolProfile,
        displaySchoolName: '최신 탭 학교',
      },
    })
    const uploadedBills = sampleBills.map((bill) => ({
      ...bill,
      id: `new-${bill.id}`,
    }))
    const staleFallback = makeData()
    const upload = rotateNewStorageSnapshot(
      staleFallback,
      (latest) => ({
        bills: uploadedBills,
        provenance: { ...latest.provenance, bills: 'uploaded' },
      }),
      now + 1,
      'bill-rotation',
    )

    await locks.run(0)
    expect((await settingsEdit).ok).toBe(true)
    await locks.run(1)
    expect((await upload).ok).toBe(true)

    expect(readStorageSnapshot(now + 2)).toEqual(
      expect.objectContaining({
        revision: 0,
        session: expect.objectContaining({ sessionId: 'bill-rotation' }),
        data: expect.objectContaining({
          bills: uploadedBills,
          calculationSettings: latestSettings,
          profile: expect.objectContaining({
            displaySchoolName: '최신 탭 학교',
          }),
          powerPlanner: null,
          provenance: {
            bills: 'uploaded',
            powerPlanner: 'none',
          },
        }),
      }),
    )
  })

  it('rotates a stale PowerPlanner upload while preserving every unrelated latest field', async () => {
    const latestData = {
      ...makeData(),
      scenario: { ...defaultScenario, expectedPeakKw: 777 },
      provenance: { bills: 'uploaded' as const, powerPlanner: 'none' as const },
    }
    expect(
      (await startNewStorageSnapshot(latestData, now, 'planner-base')).ok,
    ).toBe(true)

    const result = await rotateNewStorageSnapshot(
      {
        ...makeData(),
        provenance: { bills: 'sample', powerPlanner: 'none' },
      },
      (latest) => ({
        powerPlanner: samplePowerPlannerDataSource,
        provenance: { ...latest.provenance, powerPlanner: 'uploaded' },
      }),
      now + 1,
      'planner-rotation',
    )

    expect(result.ok).toBe(true)
    expect(readStorageSnapshot(now + 2)?.data).toEqual({
      ...latestData,
      powerPlanner: samplePowerPlannerDataSource,
      provenance: { bills: 'uploaded', powerPlanner: 'uploaded' },
    })
  })

  it('merges concurrent PowerPlanner upload intents into the latest locked snapshot', async () => {
    const latestData = {
      ...makeData(),
      profile: {
        ...defaultSchoolProfile,
        displaySchoolName: '최신 잠금 학교',
      },
      calculationSettings: {
        ...defaultCalculationSettings,
        vatPercent: 7,
      },
    }
    expect(
      (await startNewStorageSnapshot(latestData, now, 'planner-intent-base')).ok,
    ).toBe(true)
    const locks = installManualLock()
    const upload = (
      intent: PowerPlannerStorageIntent,
      sessionId: string,
    ): Promise<PowerPlannerSaveResult> =>
      rotateNewStorageSnapshot(
        makeData(),
        (latest) => {
          const merged = applyPowerPlannerStorageIntent(
            latest.powerPlanner,
            latest.provenance.powerPlanner,
            intent,
          )
          if (!merged.ok) throw new Error(merged.message)
          return {
            powerPlanner: merged.dataSource,
            provenance: {
              ...latest.provenance,
              powerPlanner: 'uploaded',
            },
          }
        },
        now + 1,
        sessionId,
      ).then((result) =>
        result.ok
          ? {
              ok: true,
              dataSource: result.snapshot.data.powerPlanner,
              duplicateCount: 0,
            }
          : { ok: false },
      )
    const makeIntent = (
      id: string,
      hour: number,
    ): PowerPlannerStorageIntent => ({
      type: 'merge-upload',
      sourceName: `${id}.csv`,
      memo: id,
      records: [
        {
          id,
          dataType: 'hourlyUsage',
          date: '2026-07-01',
          hour,
          usageKwh: 400 + hour,
          sourceRowIndex: 0,
        },
      ],
    })

    const uploadA = upload(makeIntent('upload-a', 13), 'planner-upload-a')
    const uploadB = upload(makeIntent('upload-b', 14), 'planner-upload-b')

    await locks.run(0)
    await expect(uploadA).resolves.toMatchObject({
      ok: true,
      dataSource: { records: [expect.objectContaining({ id: 'upload-a' })] },
    })
    await locks.run(1)
    await expect(uploadB).resolves.toMatchObject({
      ok: true,
      dataSource: {
        records: [
          expect.objectContaining({ id: 'upload-a' }),
          expect.objectContaining({ id: 'upload-b' }),
        ],
      },
    })

    expect(readStorageSnapshot(now + 2)?.data).toMatchObject({
      profile: { displaySchoolName: '최신 잠금 학교' },
      calculationSettings: {
        vatPercent: 7,
      },
      powerPlanner: {
        records: [
          expect.objectContaining({ id: 'upload-a' }),
          expect.objectContaining({ id: 'upload-b' }),
        ],
      },
      provenance: {
        bills: 'uploaded',
        powerPlanner: 'uploaded',
      },
    })
  })

  it('uses a validated in-memory base when no active session exists', async () => {
    const fallback = {
      ...makeData(),
      profile: {
        ...defaultSchoolProfile,
        displaySchoolName: '메모리 기준 학교',
      },
    }
    const result = await rotateNewStorageSnapshot(
      fallback,
      { bills: sampleBills.slice(0, 12) },
      now,
      'memory-rotation',
    )

    expect(result.ok).toBe(true)
    expect(readStorageSnapshot(now)?.data).toEqual({
      ...fallback,
      bills: sampleBills.slice(0, 12),
    })
  })

  it('serializes mutations within one tab when Web Locks are unavailable', async () => {
    setLocks(undefined)
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'fallback-session')).ok,
    ).toBe(true)

    await Promise.all([
      updateStorageSnapshot('fallback-session', {
        profile: {
          ...defaultSchoolProfile,
          displaySchoolName: '대체 큐 학교',
        },
      }),
      updateStorageSnapshot('fallback-session', {
        scenario: {
          ...defaultScenario,
          targetPeakKw: 611,
        },
      }),
    ])

    expect(readStorageSnapshot(now)).toEqual(
      expect.objectContaining({
        revision: 2,
        data: expect.objectContaining({
          profile: expect.objectContaining({
            displaySchoolName: '대체 큐 학교',
          }),
          scenario: expect.objectContaining({ targetPeakKw: 611 }),
        }),
      }),
    )
  })

  it('defines queued same-field edits as deterministic last-writer-wins', async () => {
    installSerialLock()
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'same-field-session')).ok,
    ).toBe(true)
    const first = updateStorageSnapshot('same-field-session', {
      profile: {
        ...defaultSchoolProfile,
        displaySchoolName: '첫 번째',
      },
    })
    const second = updateStorageSnapshot('same-field-session', {
      profile: {
        ...defaultSchoolProfile,
        displaySchoolName: '두 번째',
      },
    })

    await Promise.all([first, second])

    expect(readStorageSnapshot(now)?.revision).toBe(2)
    expect(
      readStorageSnapshot(now)?.data.profile.displaySchoolName,
    ).toBe('두 번째')
  })

  it('applies rapid rate-plan field intents to the latest locked collection', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'rate-intent-session')).ok,
    ).toBe(true)
    const locks = installManualLock()
    const planId = defaultRatePlans[0].id
    const first = updateStorageSnapshot('rate-intent-session', (latest) => ({
      ratePlans: applyRatePlanIntent(latest.ratePlans, {
        type: 'patch',
        planId,
        patch: { baseRateWonPerKw: 6_111 },
      }),
    }))
    const second = updateStorageSnapshot('rate-intent-session', (latest) => ({
      ratePlans: applyRatePlanIntent(latest.ratePlans, {
        type: 'patch',
        planId,
        patch: { seasonRates: { summer: 123 } },
      }),
    }))

    await locks.run(0)
    await first
    await locks.run(1)
    await second

    expect(readStorageSnapshot(now)?.data.ratePlans[0]).toMatchObject({
      baseRateWonPerKw: 6_111,
      seasonRates: expect.objectContaining({ summer: 123 }),
    })
  })

  it('applies rapid scenario field intents to the latest locked object', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'scenario-intent-session')).ok,
    ).toBe(true)
    const locks = installManualLock()
    const first = updateStorageSnapshot('scenario-intent-session', (latest) => ({
      scenario: applyPeakScenarioIntent(latest.scenario, {
        type: 'patch',
        patch: { targetPeakKw: 611 },
      }),
    }))
    const second = updateStorageSnapshot('scenario-intent-session', (latest) => ({
      scenario: applyPeakScenarioIntent(latest.scenario, {
        type: 'patch',
        patch: { expectedPeakKw: 622 },
      }),
    }))

    await locks.run(0)
    await first
    await locks.run(1)
    await second

    expect(readStorageSnapshot(now)?.data.scenario).toMatchObject({
      targetPeakKw: 611,
      expectedPeakKw: 622,
    })
  })

  it('uses lock order for same-field intent last-writer-wins', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'intent-order-session')).ok,
    ).toBe(true)
    const locks = installManualLock()
    const first = updateStorageSnapshot('intent-order-session', (latest) => ({
      scenario: applyPeakScenarioIntent(latest.scenario, {
        type: 'patch',
        patch: { targetPeakKw: 611 },
      }),
    }))
    const second = updateStorageSnapshot('intent-order-session', (latest) => ({
      scenario: applyPeakScenarioIntent(latest.scenario, {
        type: 'patch',
        patch: { targetPeakKw: 633 },
      }),
    }))

    await locks.run(0)
    await first
    await locks.run(1)
    await second

    expect(readStorageSnapshot(now)?.data.scenario.targetPeakKw).toBe(633)
  })

  it('does not resurrect a session when a stale edit is queued after reset', async () => {
    const locks = installManualLock()
    const upload = startNewStorageSnapshot(
      makeData(),
      now,
      'resurrection-session',
    )
    expect(locks.pending).toHaveLength(1)
    await locks.run(0)
    expect((await upload).ok).toBe(true)

    const reset = removeStorageSnapshot('resurrection-session')
    const staleEdit = updateStorageSnapshot('resurrection-session', {
      profile: {
        ...defaultSchoolProfile,
        displaySchoolName: '부활 시도',
      },
    })
    expect(locks.pending).toHaveLength(3)
    await locks.run(1)
    expect(await reset).toEqual({
      ok: true,
      outcome: 'active-deactivated',
      snapshotRemoved: true,
    })
    await locks.run(2)
    expect(await staleEdit).toEqual(
      expect.objectContaining({ ok: false }),
    )

    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
    expect(readStorageSnapshot(now)).toBeNull()
  })

  it('deactivates the active session even when snapshot deletion fails, then safely retries the orphan', async () => {
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          now,
          'deactivated-orphan',
        )
      ).ok,
    ).toBe(true)
    const snapshotKey = storageSnapshotKeyFor('deactivated-orphan')
    const nativeRemoveItem = Storage.prototype.removeItem
    let rejectSnapshotRemoval = true
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === snapshotKey && rejectSnapshotRemoval) {
        throw new DOMException('remove failed', 'QuotaExceededError')
      }
      nativeRemoveItem.call(this, key)
    })

    expect(await removeStorageSnapshot('deactivated-orphan')).toEqual({
      ok: true,
      outcome: 'active-deactivated',
      snapshotRemoved: false,
    })
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
    expect(localStorage.getItem(snapshotKey)).not.toBeNull()
    expect(readStorageSnapshot(now)).toBeNull()
    expect(getNextStorageExpiry(now)).toBeNull()

    rejectSnapshotRemoval = false
    expect(await cleanupExpiredStorageSnapshots(now)).toContain(snapshotKey)
    expect(localStorage.getItem(snapshotKey)).toBeNull()
  })

  it('reports inactive snapshot deletion as orphan cleanup without changing the winner', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'old-session')).ok,
    ).toBe(true)
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          now + 1,
          'winner-session',
        )
      ).ok,
    ).toBe(true)

    expect(await removeStorageSnapshot('old-session')).toEqual({
      ok: true,
      outcome: 'orphan-cleaned',
    })
    expect(readStorageSnapshot(now + 2)?.session.sessionId).toBe(
      'winner-session',
    )
  })

  it('keeps active UI expiry separate while tracking every scoped snapshot expiry', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'earlier-orphan')).ok,
    ).toBe(true)
    const earlierKey = storageSnapshotKeyFor('earlier-orphan')
    const nativeRemoveItem = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === earlierKey) {
        throw new DOMException('remove failed', 'QuotaExceededError')
      }
      nativeRemoveItem.call(this, key)
    })
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          now + 1_000,
          'later-active',
        )
      ).ok,
    ).toBe(true)

    expect(getNextStorageExpiry(now + 2_000)).toBe(now + 1_000 + dayMs)
    expect(getNextStorageSnapshotExpiry(now + 2_000)).toBe(now + dayMs)
  })

  it('removes the losing upload after the last locked pointer commit wins', async () => {
    const locks = installManualLock()
    const first = startNewStorageSnapshot(
      makeData(),
      now,
      'first-upload-session',
    )
    const secondData = {
      ...makeData(),
      profile: {
        ...defaultSchoolProfile,
        displaySchoolName: '두 번째 업로드',
      },
    }
    const second = startNewStorageSnapshot(
      secondData,
      now + 1,
      'second-upload-session',
    )

    await locks.run(0)
    expect((await first).ok).toBe(true)
    await locks.run(1)
    expect((await second).ok).toBe(true)

    expect(readStorageSnapshot(now + 2)?.session.sessionId).toBe(
      'second-upload-session',
    )
    expect(
      localStorage.getItem(storageSnapshotKeyFor('first-upload-session')),
    ).toBeNull()
    expect(
      localStorage.getItem(storageSnapshotKeyFor('second-upload-session')),
    ).not.toBeNull()
  })

  it('leaves only the current snapshot after repeated uploads', async () => {
    for (const [index, sessionId] of [
      'repeat-first',
      'repeat-second',
      'repeat-third',
    ].entries()) {
      expect(
        (
          await startNewStorageSnapshot(
            makeData(),
            now + index,
            sessionId,
          )
        ).ok,
      ).toBe(true)
    }

    expect(readStorageSnapshot(now + 3)?.session.sessionId).toBe('repeat-third')
    expect(
      Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      ).filter((key) => key?.startsWith('el-bill:storage-snapshot:')),
    ).toEqual([storageSnapshotKeyFor('repeat-third')])
  })

  it('keeps the new winner when prior snapshot deletion fails and reports retry work', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'prior-upload')).ok,
    ).toBe(true)
    const priorKey = storageSnapshotKeyFor('prior-upload')
    const nativeRemoveItem = Storage.prototype.removeItem
    let rejectPriorRemoval = true
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === priorKey && rejectPriorRemoval) {
        throw new DOMException('remove failed', 'QuotaExceededError')
      }
      nativeRemoveItem.call(this, key)
    })

    const winner = await startNewStorageSnapshot(
      makeData(),
      now + 1,
      'retained-winner',
    )

    expect(winner).toEqual(
      expect.objectContaining({
        ok: true,
        cleanupPendingSessionIds: ['prior-upload'],
      }),
    )
    expect(readStorageSnapshot(now + 2)?.session.sessionId).toBe(
      'retained-winner',
    )
    expect(localStorage.getItem(priorKey)).not.toBeNull()

    rejectPriorRemoval = false
    expect(await cleanupExpiredStorageSnapshots(now + 2)).toContain(priorKey)
    expect(localStorage.getItem(priorKey)).toBeNull()
    expect(readStorageSnapshot(now + 2)?.session.sessionId).toBe(
      'retained-winner',
    )
  })

  it('removes inactive and active snapshots at their exact 24-hour boundaries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'inactive-expiry')).ok,
    ).toBe(true)
    const inactiveKey = storageSnapshotKeyFor('inactive-expiry')
    const nativeRemoveItem = Storage.prototype.removeItem
    let rejectInactiveRemoval = true
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === inactiveKey && rejectInactiveRemoval) {
        throw new DOMException('remove failed', 'QuotaExceededError')
      }
      nativeRemoveItem.call(this, key)
    })
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          now + 1_000,
          'active-expiry',
        )
      ).ok,
    ).toBe(true)
    rejectInactiveRemoval = false

    vi.setSystemTime(now + dayMs)
    expect(await cleanupExpiredStorageSnapshots(Date.now())).toContain(
      inactiveKey,
    )
    expect(localStorage.getItem(inactiveKey)).toBeNull()
    expect(
      localStorage.getItem(storageSnapshotKeyFor('active-expiry')),
    ).not.toBeNull()

    vi.setSystemTime(now + 1_000 + dayMs)
    expect(await cleanupExpiredStorageSnapshots(Date.now())).toContain(
      storageSnapshotKeyFor('active-expiry'),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
    expect(
      Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      ).filter((key) => key?.startsWith('el-bill:storage-snapshot:')),
    ).toEqual([])
  })

  it('does not let stale expiry cleanup clear a newer upload pointer', async () => {
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          now - dayMs,
          'expired-session',
        )
      ).ok,
    ).toBe(true)
    const locks = installManualLock()
    const winner = startNewStorageSnapshot(
      makeData(),
      now,
      'cleanup-winner',
    )
    const cleanup = cleanupExpiredStorageSnapshots(now)

    await locks.run(0)
    expect((await winner).ok).toBe(true)
    await locks.run(1)
    expect(await cleanup).toEqual([])
    expect(
      localStorage.getItem(storageSnapshotKeyFor('expired-session')),
    ).toBeNull()

    expect(readStorageSnapshot(now)?.session.sessionId).toBe('cleanup-winner')
    expect(
      localStorage.getItem(storageSnapshotKeyFor('cleanup-winner')),
    ).not.toBeNull()
  })

  it('makes migration adopt a new upload that wins while migration waits for the lock', async () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem(
      'el-bill:profile',
      legacyPayload(defaultSchoolProfile),
    )
    const locks = installManualLock()
    const migration = initializeStorageAfterMount(makeData(), now)
    const winnerData = {
      ...makeData(),
      provenance: { bills: 'sample' as const, powerPlanner: 'none' as const },
    }
    const upload = startNewStorageSnapshot(
      winnerData,
      now + 1,
      'migration-lock-winner',
    )
    expect(locks.pending).toHaveLength(2)

    await locks.run(1)
    expect((await upload).ok).toBe(true)
    await locks.run(0)

    expect(await migration).toEqual(
      expect.objectContaining({
        revision: 0,
        session: expect.objectContaining({
          sessionId: 'migration-lock-winner',
        }),
        data: winnerData,
      }),
    )
    expect(readStorageSnapshot(now + 2)?.session.sessionId).toBe(
      'migration-lock-winner',
    )
  })
})
