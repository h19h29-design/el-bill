/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from '../data/sampleBills'
import {
  cleanupExpiredStorageSnapshots,
  getNextStorageExpiry,
  initializeStorageAfterMount,
  purgeExpiredStorageSnapshot,
  readStorageSnapshot,
  removeStorageSnapshot,
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

    const profileWrite = updateStorageSnapshot('patch-session', {
      profile: staleProfile,
    })
    const scenarioWrite = updateStorageSnapshot('patch-session', {
      scenario: staleScenario,
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
        }),
      }),
    )
    expect(lockNames).toHaveLength(3)
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

  it('schedules live expiry from the active pointer and ignores an earlier inactive orphan', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'earlier-orphan')).ok,
    ).toBe(true)
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
  })

  it('keeps both uploads complete and lets the last locked pointer commit win', async () => {
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
    ).not.toBeNull()
    expect(
      localStorage.getItem(storageSnapshotKeyFor('second-upload-session')),
    ).not.toBeNull()
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
    expect(await cleanup).toContain(
      storageSnapshotKeyFor('expired-session'),
    )

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
