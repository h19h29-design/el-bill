/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from '../data/sampleBills'
import type { DataProvenance } from '../types'
import {
  purgeExpiredStorageSnapshot,
  restoreStorageSnapshot,
  startNewStorageSnapshot,
  storageSnapshotKey,
  updateStorageSnapshot,
  type StorageSnapshotData,
} from './storage'

const now = Date.parse('2026-07-26T00:00:00.000Z')

const makeData = (
  provenance: DataProvenance = { bills: 'uploaded', powerPlanner: 'none' },
): StorageSnapshotData => ({
  bills: sampleBills,
  profile: defaultSchoolProfile,
  scenario: defaultScenario,
  ratePlans: defaultRatePlans,
  powerPlanner: null,
  provenance,
})

const legacyPayload = (
  data: unknown,
  expiresAt = '2026-07-27T00:00:00.000Z',
) => JSON.stringify({
  createdAt: '2026-07-26T00:00:00.000Z',
  expiresAt,
  data,
})

describe('atomic storage snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('commits and immediately restores a complete snapshot through one root key', () => {
    const result = startNewStorageSnapshot(makeData(), now, 'upload-session')

    expect(result.ok).toBe(true)
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem(storageSnapshotKey)).not.toBeNull()
    expect(restoreStorageSnapshot(makeData(), now)).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        session: expect.objectContaining({ sessionId: 'upload-session' }),
        data: expect.objectContaining({
          bills: sampleBills,
          provenance: { bills: 'uploaded', powerPlanner: 'none' },
        }),
      }),
    )
  })

  it('removes leftover legacy keys only after a new root upload commits', () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:data-mode', legacyPayload('uploaded'))

    const result = startNewStorageSnapshot(makeData(), now, 'new-upload')

    expect(result.ok).toBe(true)
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem(storageSnapshotKey)).not.toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:data-mode')).toBeNull()
  })

  it('leaves the previous committed snapshot untouched when quota blocks an upload', () => {
    const first = startNewStorageSnapshot(makeData(), now, 'first-session')
    expect(first.ok).toBe(true)
    const previousRoot = localStorage.getItem(storageSnapshotKey)
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === storageSnapshotKey) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })

    const failed = startNewStorageSnapshot(
      makeData({ bills: 'sample', powerPlanner: 'none' }),
      now + 1,
      'failed-session',
    )

    expect(failed).toEqual(expect.objectContaining({ ok: false, reason: 'storage-error' }))
    expect(localStorage.getItem(storageSnapshotKey)).toBe(previousRoot)
  })

  it('rejects a stale-tab edit after a newer upload has replaced its session', () => {
    const stale = startNewStorageSnapshot(makeData(), now, 'stale-session')
    expect(stale.ok).toBe(true)
    const current = startNewStorageSnapshot(makeData(), now + 1, 'current-session')
    expect(current.ok).toBe(true)

    const result = updateStorageSnapshot(
      'stale-session',
      makeData({ bills: 'sample', powerPlanner: 'none' }),
      now + 2,
    )

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'stale-session' }))
    expect(restoreStorageSnapshot(makeData(), now + 2)?.session.sessionId).toBe(
      'current-session',
    )
  })

  it('does not overwrite a newer root that appears immediately before a CAS commit', () => {
    expect(
      startNewStorageSnapshot(makeData(), now, 'stale-session').ok,
    ).toBe(true)
    const staleRoot = localStorage.getItem(storageSnapshotKey)!
    expect(
      startNewStorageSnapshot(makeData(), now + 1, 'newer-session').ok,
    ).toBe(true)
    const newerRoot = localStorage.getItem(storageSnapshotKey)!
    localStorage.setItem(storageSnapshotKey, staleRoot)
    const nativeGetItem = Storage.prototype.getItem
    const nativeSetItem = Storage.prototype.setItem
    let rootReadCount = 0
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key !== storageSnapshotKey) return nativeGetItem.call(this, key)
      rootReadCount += 1
      if (rootReadCount === 2) {
        nativeSetItem.call(this, storageSnapshotKey, newerRoot)
      }
      return nativeGetItem.call(this, key)
    })

    const result = updateStorageSnapshot('stale-session', makeData(), now + 2)

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'stale-session' }),
    )
    expect(nativeGetItem.call(localStorage, storageSnapshotKey)).toBe(newerRoot)
  })

  it('rejects an edit at the exact expiry without changing the committed root', () => {
    const started = startNewStorageSnapshot(makeData(), now, 'expired-session')
    expect(started.ok).toBe(true)
    const previousRoot = localStorage.getItem(storageSnapshotKey)

    const result = updateStorageSnapshot(
      'expired-session',
      makeData({ bills: 'sample', powerPlanner: 'none' }),
      now + 24 * 60 * 60 * 1000,
    )

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'expired' }))
    expect(localStorage.getItem(storageSnapshotKey)).toBe(previousRoot)
  })

  it.each([
    ['malformed JSON', '{broken'],
    [
      'incomplete data',
      JSON.stringify({
        schemaVersion: 1,
        session: {
          sessionId: 'incomplete',
          createdAt: '2026-07-26T00:00:00.000Z',
          expiresAt: '2026-07-27T00:00:00.000Z',
        },
        data: { bills: sampleBills },
      }),
    ],
    [
      'incoherent provenance',
      JSON.stringify({
        schemaVersion: 1,
        session: {
          sessionId: 'incoherent',
          createdAt: '2026-07-26T00:00:00.000Z',
          expiresAt: '2026-07-27T00:00:00.000Z',
        },
        data: makeData({
          bills: 'sample',
          powerPlanner: 'uploaded',
        }),
      }),
    ],
  ])('ignores and purges a %s root snapshot', (_, root) => {
    localStorage.setItem(storageSnapshotKey, root)

    expect(restoreStorageSnapshot(makeData(), now)).toBeNull()
    expect(localStorage.getItem(storageSnapshotKey)).toBeNull()
  })

  it('migrates complete legacy keys once and keeps their earliest expiry', () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem(
      'el-bill:profile',
      legacyPayload(defaultSchoolProfile, '2026-07-26T12:00:00.000Z'),
    )
    localStorage.setItem('el-bill:scenario', legacyPayload(defaultScenario))
    localStorage.setItem('el-bill:rate-plans', legacyPayload(defaultRatePlans))
    localStorage.setItem('el-bill:power-planner', legacyPayload(null))
    localStorage.setItem(
      'el-bill:data-provenance',
      legacyPayload({ bills: 'uploaded', powerPlanner: 'none' }),
    )

    const migrated = restoreStorageSnapshot(makeData(), now)

    expect(migrated?.session.expiresAt).toBe('2026-07-26T12:00:00.000Z')
    expect(migrated?.data.provenance).toEqual({
      bills: 'uploaded',
      powerPlanner: 'none',
    })
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem(storageSnapshotKey)).not.toBeNull()
  })

  it('migrates a complete legacy session and commit with matching payload IDs', () => {
    const session = {
      createdAt: '2026-07-26T00:00:00.000Z',
      expiresAt: '2026-07-27T00:00:00.000Z',
      sessionId: 'legacy-committed',
    }
    localStorage.setItem('el-bill:storage-session', JSON.stringify(session))
    localStorage.setItem('el-bill:storage-commit', JSON.stringify(session))
    const write = (key: string, data: unknown) =>
      localStorage.setItem(key, JSON.stringify({ ...session, data }))
    write('el-bill:bills', sampleBills)
    write('el-bill:profile', defaultSchoolProfile)
    write('el-bill:scenario', defaultScenario)
    write('el-bill:rate-plans', defaultRatePlans)
    write('el-bill:power-planner', null)
    write('el-bill:data-provenance', {
      bills: 'uploaded',
      powerPlanner: 'none',
    })

    const migrated = restoreStorageSnapshot(makeData(), now)

    expect(migrated?.data.provenance.bills).toBe('uploaded')
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem(storageSnapshotKey)).not.toBeNull()
  })

  it('does not merge a legacy payload whose session ID differs from its commit', () => {
    const session = {
      createdAt: '2026-07-26T00:00:00.000Z',
      expiresAt: '2026-07-27T00:00:00.000Z',
      sessionId: 'legacy-committed',
    }
    localStorage.setItem('el-bill:storage-session', JSON.stringify(session))
    localStorage.setItem('el-bill:storage-commit', JSON.stringify(session))
    localStorage.setItem(
      'el-bill:bills',
      JSON.stringify({ ...session, sessionId: 'stale-payload', data: sampleBills }),
    )
    localStorage.setItem(
      'el-bill:profile',
      JSON.stringify({ ...session, data: defaultSchoolProfile }),
    )

    expect(restoreStorageSnapshot(makeData(), now)).toBeNull()
    expect(localStorage.getItem(storageSnapshotKey)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).not.toBeNull()
  })

  it('keeps all legacy keys when the atomic migration commit fails', () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    localStorage.setItem('el-bill:scenario', legacyPayload(defaultScenario))
    localStorage.setItem('el-bill:rate-plans', legacyPayload(defaultRatePlans))
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === storageSnapshotKey) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })

    expect(restoreStorageSnapshot(makeData(), now)).toBeNull()
    expect(localStorage.getItem(storageSnapshotKey)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).not.toBeNull()
    expect(localStorage.getItem('el-bill:profile')).not.toBeNull()
  })

  it('purges the root at exactly 24 hours but never purges a newer session', () => {
    const first = startNewStorageSnapshot(makeData(), now, 'first-session')
    expect(first.ok).toBe(true)
    expect(
      purgeExpiredStorageSnapshot('first-session', now + 24 * 60 * 60 * 1000 - 1),
    ).toBe(false)

    const second = startNewStorageSnapshot(makeData(), now + 1, 'second-session')
    expect(second.ok).toBe(true)
    expect(
      purgeExpiredStorageSnapshot('first-session', now + 24 * 60 * 60 * 1000),
    ).toBe(false)
    expect(localStorage.getItem(storageSnapshotKey)).not.toBeNull()

    expect(
      purgeExpiredStorageSnapshot(
        'second-session',
        now + 1 + 24 * 60 * 60 * 1000,
      ),
    ).toBe(true)
    expect(localStorage.getItem(storageSnapshotKey)).toBeNull()
  })
})
