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
  cleanupExpiredStorageSnapshots,
  initializeStorageAfterMount,
  legacyAtomicStorageSnapshotKey,
  readStorageSnapshot,
  startNewStorageSnapshot,
  storageActivePointerKey,
  storageSnapshotKeyFor,
  updateStorageSnapshot,
  type StorageSnapshot,
  type StorageSnapshotData,
} from './storage'

const dayMs = 24 * 60 * 60 * 1000
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

const pointer = (sessionId: string) =>
  JSON.stringify({ schemaVersion: 1, sessionId })

const snapshot = (
  sessionId: string,
  data = makeData(),
  createdAt = now,
  expiresAt = now + dayMs,
): StorageSnapshot => ({
  schemaVersion: 1,
  revision: 0,
  session: {
    sessionId,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  },
  data,
})

const legacyPayload = (
  data: unknown,
  expiresAt = '2026-07-27T00:00:00.000Z',
  createdAt = '2026-07-26T00:00:00.000Z',
) => JSON.stringify({ createdAt, expiresAt, data })

describe('locked session-scoped snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    localStorage.clear()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('writes a complete revision-zero snapshot before the active pointer', async () => {
    const writes: string[] = []
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      writes.push(key)
      nativeSetItem.call(this, key, value)
    })

    const result = await startNewStorageSnapshot(
      makeData(),
      now,
      'upload-session',
    )

    expect(result.ok).toBe(true)
    expect(writes.slice(0, 2)).toEqual([
      storageSnapshotKeyFor('upload-session'),
      storageActivePointerKey,
    ])
    expect(readStorageSnapshot(now)).toEqual(
      expect.objectContaining({ revision: 0 }),
    )
  })

  it('leaves the previous session untouched when snapshot quota fails', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'first-session')).ok,
    ).toBe(true)
    const previousPointer = localStorage.getItem(storageActivePointerKey)
    const previousSnapshot = localStorage.getItem(
      storageSnapshotKeyFor('first-session'),
    )
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === storageSnapshotKeyFor('failed-session')) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })

    const result = await startNewStorageSnapshot(
      makeData(),
      now + 1,
      'failed-session',
    )

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'storage-error' }),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(previousPointer)
    expect(localStorage.getItem(storageSnapshotKeyFor('first-session'))).toBe(
      previousSnapshot,
    )
  })

  it('leaves the previous pointer active when pointer storage fails', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'first-session')).ok,
    ).toBe(true)
    const previousPointer = localStorage.getItem(storageActivePointerKey)
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (
        key === storageActivePointerKey &&
        JSON.parse(value).sessionId === 'failed-session'
      ) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })

    const result = await startNewStorageSnapshot(
      makeData(),
      now + 1,
      'failed-session',
    )

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'storage-error' }),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(previousPointer)
    expect(localStorage.getItem(storageSnapshotKeyFor('failed-session'))).toBeNull()
  })

  it('leaves the previous session untouched when serialization fails', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'first-session')).ok,
    ).toBe(true)
    const previousPointer = localStorage.getItem(storageActivePointerKey)
    const circular = makeData() as StorageSnapshotData & {
      unsupported?: unknown
    }
    circular.unsupported = circular

    const result = await startNewStorageSnapshot(
      circular,
      now + 1,
      'serialization-failure',
    )

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid-data' }),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(previousPointer)
  })

  it('rejects reuse of an existing session key', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'reused-session')).ok,
    ).toBe(true)
    const previous = localStorage.getItem(
      storageSnapshotKeyFor('reused-session'),
    )

    const result = await startNewStorageSnapshot(
      makeData({ bills: 'sample', powerPlanner: 'none' }),
      now + 1,
      'reused-session',
    )

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'stale-session' }),
    )
    expect(localStorage.getItem(storageSnapshotKeyFor('reused-session'))).toBe(
      previous,
    )
  })

  it('rejects an edit and clears pointer plus data at exact expiry', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'expiry-session')).ok,
    ).toBe(true)

    expect(
      await updateStorageSnapshot(
        'expiry-session',
        { profile: defaultSchoolProfile },
        now + dayMs,
      ),
    ).toEqual(expect.objectContaining({ ok: false, reason: 'expired' }))
    expect(await cleanupExpiredStorageSnapshots(now + dayMs)).toContain(
      storageSnapshotKeyFor('expiry-session'),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
    expect(readStorageSnapshot(now + dayMs)).toBeNull()
  })

  it.each([
    ['zero duration', now, now],
    ['negative duration', now, now - 1],
    ['more than 24 hours', now, now + dayMs + 1],
  ])('purges a %s session', async (_, createdAt, expiresAt) => {
    const invalid = snapshot(
      'invalid-duration',
      makeData(),
      createdAt,
      expiresAt,
    )
    localStorage.setItem(
      storageSnapshotKeyFor('invalid-duration'),
      JSON.stringify(invalid),
    )
    localStorage.setItem(storageActivePointerKey, pointer('invalid-duration'))

    expect(readStorageSnapshot(now)).toBeNull()
    await initializeStorageAfterMount(makeData(), now)
    expect(localStorage.getItem(storageSnapshotKeyFor('invalid-duration'))).toBeNull()
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
  })

  it('purely ignores then effect-purges an incomplete snapshot', async () => {
    const key = storageSnapshotKeyFor('invalid-root')
    const raw = JSON.stringify({
      ...snapshot('invalid-root'),
      data: { bills: sampleBills },
    })
    localStorage.setItem(key, raw)
    localStorage.setItem(storageActivePointerKey, pointer('invalid-root'))

    expect(readStorageSnapshot(now)).toBeNull()
    expect(localStorage.getItem(key)).toBe(raw)

    await initializeStorageAfterMount(makeData(), now)
    expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
  })

  it('purges a malformed active pointer only after the mount initializer runs', async () => {
    localStorage.setItem(storageActivePointerKey, '{"schemaVersion":1')

    expect(readStorageSnapshot(now)).toBeNull()
    expect(localStorage.getItem(storageActivePointerKey)).not.toBeNull()

    await initializeStorageAfterMount(makeData(), now)
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
  })
})

describe('locked one-time migration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    localStorage.clear()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('migrates valid per-key data without extending earliest expiry', async () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem(
      'el-bill:profile',
      legacyPayload(defaultSchoolProfile, '2026-07-26T12:00:00.000Z'),
    )
    localStorage.setItem('el-bill:scenario', legacyPayload(defaultScenario))
    localStorage.setItem('el-bill:rate-plans', legacyPayload(defaultRatePlans))
    localStorage.setItem(
      'el-bill:data-provenance',
      legacyPayload({ bills: 'uploaded', powerPlanner: 'none' }),
    )

    const migrated = await initializeStorageAfterMount(makeData(), now)

    expect(migrated?.revision).toBe(0)
    expect(migrated?.session.expiresAt).toBe('2026-07-26T12:00:00.000Z')
    expect(migrated?.data.provenance.bills).toBe('uploaded')
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('upgrades the former revisionless fixed root', async () => {
    const oldRoot = snapshot('fixed-root-session')
    const { revision: _, ...revisionless } = oldRoot
    localStorage.setItem(
      legacyAtomicStorageSnapshotKey,
      JSON.stringify(revisionless),
    )

    const migrated = await initializeStorageAfterMount(makeData(), now)

    expect(migrated).toEqual(oldRoot)
    expect(localStorage.getItem(legacyAtomicStorageSnapshotKey)).toBeNull()
    expect(
      JSON.parse(
        localStorage.getItem(storageSnapshotKeyFor('fixed-root-session'))!,
      ).revision,
    ).toBe(0)
  })

  it('preserves valid legacy data when migration snapshot storage fails', async () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key.startsWith('el-bill:storage-snapshot:')) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })

    expect(await initializeStorageAfterMount(makeData(), now)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).not.toBeNull()
    expect(localStorage.getItem('el-bill:profile')).not.toBeNull()
  })

  it('always removes expired, malformed, or session-mismatched legacy PII', async () => {
    const session = {
      createdAt: '2026-07-26T00:00:00.000Z',
      expiresAt: '2026-07-27T00:00:00.000Z',
      sessionId: 'legacy-committed',
    }
    localStorage.setItem('el-bill:storage-session', JSON.stringify(session))
    localStorage.setItem('el-bill:storage-commit', JSON.stringify(session))
    localStorage.setItem(
      'el-bill:bills',
      JSON.stringify({
        ...session,
        sessionId: 'stale-payload',
        data: sampleBills,
      }),
    )
    localStorage.setItem('el-bill:profile', '{broken')

    expect(await initializeStorageAfterMount(makeData(), now)).toBeNull()
    expect(localStorage.getItem('el-bill:storage-session')).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:profile')).toBeNull()
  })

  it('rejects and removes a legacy lifetime above 24 hours', async () => {
    localStorage.setItem(
      'el-bill:bills',
      legacyPayload(
        sampleBills,
        '2026-07-27T00:00:00.001Z',
        '2026-07-26T00:00:00.000Z',
      ),
    )

    expect(await initializeStorageAfterMount(makeData(), now)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('keeps ambiguous legacy provenance at sample and none', async () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:data-mode', legacyPayload('uploaded'))

    const migrated = await initializeStorageAfterMount(makeData(), now)

    expect(migrated?.data.provenance).toEqual({
      bills: 'sample',
      powerPlanner: 'none',
    })
  })
})
