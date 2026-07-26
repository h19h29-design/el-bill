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
  removeStorageSnapshot,
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

describe('session-scoped atomic storage snapshots', () => {
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

  it('writes a complete session snapshot before switching the active pointer', () => {
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

    const result = startNewStorageSnapshot(makeData(), now, 'upload-session')

    expect(result.ok).toBe(true)
    expect(writes.slice(0, 2)).toEqual([
      storageSnapshotKeyFor('upload-session'),
      storageActivePointerKey,
    ])
    expect(readStorageSnapshot(now)).toEqual(result.ok && result.snapshot)
  })

  it('leaves the previous active session untouched when snapshot storage fails', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'first-session').ok).toBe(true)
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

    const result = startNewStorageSnapshot(makeData(), now + 1, 'failed-session')

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'storage-error' }),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(previousPointer)
    expect(localStorage.getItem(storageSnapshotKeyFor('first-session'))).toBe(
      previousSnapshot,
    )
  })

  it('leaves the previous pointer active and removes its uncommitted snapshot when pointer storage fails', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'first-session').ok).toBe(true)
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

    const result = startNewStorageSnapshot(makeData(), now + 1, 'failed-session')

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'storage-error' }),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(previousPointer)
    expect(localStorage.getItem(storageSnapshotKeyFor('failed-session'))).toBeNull()
  })

  it('leaves the previous active session untouched when serialization fails', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'first-session').ok).toBe(true)
    const previousPointer = localStorage.getItem(storageActivePointerKey)
    const previousSnapshot = localStorage.getItem(
      storageSnapshotKeyFor('first-session'),
    )
    const circular = makeData() as StorageSnapshotData & {
      unsupported?: unknown
    }
    circular.unsupported = circular

    const result = startNewStorageSnapshot(
      circular,
      now + 1,
      'serialization-failure',
    )

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid-data' }),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(previousPointer)
    expect(localStorage.getItem(storageSnapshotKeyFor('first-session'))).toBe(
      previousSnapshot,
    )
    expect(
      localStorage.getItem(storageSnapshotKeyFor('serialization-failure')),
    ).toBeNull()
  })

  it('rejects a new upload that tries to reuse an existing session key', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'reused-session').ok).toBe(
      true,
    )
    const previous = localStorage.getItem(
      storageSnapshotKeyFor('reused-session'),
    )

    const result = startNewStorageSnapshot(
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

  it('cannot damage a newer upload injected after a stale writer last checks the pointer', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'stale-session').ok).toBe(true)
    const winnerData = makeData({ bills: 'sample', powerPlanner: 'none' })
    const staleKey = storageSnapshotKeyFor('stale-session')
    const nativeSetItem = Storage.prototype.setItem
    let injected = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === staleKey && !injected) {
        injected = true
        expect(
          startNewStorageSnapshot(winnerData, now + 1, 'winner-session').ok,
        ).toBe(true)
      }
      nativeSetItem.call(this, key, value)
    })

    const result = updateStorageSnapshot(
      'stale-session',
      makeData(),
      now + 2,
    )

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'stale-session' }),
    )
    expect(readStorageSnapshot(now + 2)).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({ sessionId: 'winner-session' }),
        data: winnerData,
      }),
    )
  })

  it('keeps the complete winner in a dual-new-upload race', () => {
    const nativeSetItem = Storage.prototype.setItem
    let injected = false
    const winnerData = makeData({ bills: 'sample', powerPlanner: 'none' })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      nativeSetItem.call(this, key, value)
      if (
        key === storageActivePointerKey &&
        JSON.parse(value).sessionId === 'first-upload' &&
        !injected
      ) {
        injected = true
        expect(
          startNewStorageSnapshot(winnerData, now + 1, 'second-upload').ok,
        ).toBe(true)
      }
    })

    const first = startNewStorageSnapshot(makeData(), now, 'first-upload')

    expect(first).toEqual(
      expect.objectContaining({ ok: false, reason: 'stale-session' }),
    )
    expect(readStorageSnapshot(now + 2)).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({ sessionId: 'second-upload' }),
        data: winnerData,
      }),
    )
    expect(
      JSON.parse(localStorage.getItem(storageSnapshotKeyFor('second-upload'))!),
    ).toEqual(readStorageSnapshot(now + 2))
  })

  it('removes only the stale session key when a winner appears immediately before removal', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'stale-session').ok).toBe(true)
    const staleKey = storageSnapshotKeyFor('stale-session')
    const nativeRemoveItem = Storage.prototype.removeItem
    let injected = false
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === staleKey && !injected) {
        injected = true
        expect(
          startNewStorageSnapshot(makeData(), now + 1, 'winner-session').ok,
        ).toBe(true)
      }
      nativeRemoveItem.call(this, key)
    })

    expect(removeStorageSnapshot('stale-session')).toBe(false)
    expect(readStorageSnapshot(now + 2)?.session.sessionId).toBe('winner-session')
    expect(localStorage.getItem(storageSnapshotKeyFor('winner-session'))).not.toBeNull()
  })

  it('rejects edits at expiry and purges data at exactly 24 hours', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'expiry-session').ok).toBe(true)

    expect(
      updateStorageSnapshot('expiry-session', makeData(), now + dayMs),
    ).toEqual(expect.objectContaining({ ok: false, reason: 'expired' }))
    expect(cleanupExpiredStorageSnapshots(now + dayMs)).toContain(
      storageSnapshotKeyFor('expiry-session'),
    )
    expect(localStorage.getItem(storageSnapshotKeyFor('expiry-session'))).toBeNull()
    expect(readStorageSnapshot(now + dayMs)).toBeNull()
  })

  it.each([
    ['zero duration', now, now],
    ['negative duration', now, now - 1],
    ['more than 24 hours', now, now + dayMs + 1],
  ])('rejects and purges a %s session', (_, createdAt, expiresAt) => {
    const invalid = snapshot('invalid-duration', makeData(), createdAt, expiresAt)
    localStorage.setItem(
      storageSnapshotKeyFor('invalid-duration'),
      JSON.stringify(invalid),
    )
    localStorage.setItem(storageActivePointerKey, pointer('invalid-duration'))

    expect(readStorageSnapshot(now)).toBeNull()
    initializeStorageAfterMount(makeData(), now)
    expect(localStorage.getItem(storageSnapshotKeyFor('invalid-duration'))).toBeNull()
  })

  it.each([
    ['malformed JSON', '{broken'],
    [
      'incomplete data',
      JSON.stringify({
        ...snapshot('invalid-root'),
        data: { bills: sampleBills },
      }),
    ],
  ])('purely ignores then effect-purges a %s snapshot', (_, raw) => {
    const key = storageSnapshotKeyFor('invalid-root')
    localStorage.setItem(key, raw)
    localStorage.setItem(storageActivePointerKey, pointer('invalid-root'))

    expect(readStorageSnapshot(now)).toBeNull()
    expect(localStorage.getItem(key)).toBe(raw)

    initializeStorageAfterMount(makeData(), now)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('purges an expired stale session without touching a winner injected before removal', () => {
    const stale = snapshot(
      'expired-stale',
      makeData(),
      now - dayMs,
      now,
    )
    const staleKey = storageSnapshotKeyFor('expired-stale')
    localStorage.setItem(staleKey, JSON.stringify(stale))
    localStorage.setItem(storageActivePointerKey, pointer('expired-stale'))
    const nativeRemoveItem = Storage.prototype.removeItem
    let injected = false
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === staleKey && !injected) {
        injected = true
        expect(
          startNewStorageSnapshot(makeData(), now, 'cleanup-winner').ok,
        ).toBe(true)
      }
      nativeRemoveItem.call(this, key)
    })

    cleanupExpiredStorageSnapshots(now)

    expect(readStorageSnapshot(now)?.session.sessionId).toBe('cleanup-winner')
    expect(localStorage.getItem(storageSnapshotKeyFor('cleanup-winner'))).not.toBeNull()
  })
})

describe('one-time legacy migration', () => {
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

  it('migrates valid per-key data to a scoped snapshot without extending the earliest expiry', () => {
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

    const migrated = initializeStorageAfterMount(makeData(), now)

    expect(migrated?.session.expiresAt).toBe('2026-07-26T12:00:00.000Z')
    expect(migrated?.data.provenance.bills).toBe('uploaded')
    expect(localStorage.getItem(storageActivePointerKey)).not.toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:profile')).toBeNull()
  })

  it('migrates the former fixed root through the pointer protocol', () => {
    const oldRoot = snapshot('fixed-root-session')
    localStorage.setItem(legacyAtomicStorageSnapshotKey, JSON.stringify(oldRoot))

    const migrated = initializeStorageAfterMount(makeData(), now)

    expect(migrated).toEqual(oldRoot)
    expect(localStorage.getItem(legacyAtomicStorageSnapshotKey)).toBeNull()
    expect(localStorage.getItem(storageSnapshotKeyFor('fixed-root-session'))).toBe(
      JSON.stringify(oldRoot),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(
      pointer('fixed-root-session'),
    )
  })

  it('preserves valid unexpired legacy data when migration storage fails', () => {
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

    expect(initializeStorageAfterMount(makeData(), now)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).not.toBeNull()
    expect(localStorage.getItem('el-bill:profile')).not.toBeNull()
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
  })

  it('adopts a valid new-upload winner when migration loses the pointer race', () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    const winnerData = makeData({ bills: 'sample', powerPlanner: 'none' })
    const nativeSetItem = Storage.prototype.setItem
    let injected = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      nativeSetItem.call(this, key, value)
      if (key === storageActivePointerKey && !injected) {
        injected = true
        expect(
          startNewStorageSnapshot(
            winnerData,
            now + 1,
            'migration-race-winner',
          ).ok,
        ).toBe(true)
      }
    })

    const initialized = initializeStorageAfterMount(makeData(), now + 2)

    expect(initialized).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({
          sessionId: 'migration-race-winner',
        }),
        data: winnerData,
      }),
    )
    expect(readStorageSnapshot(now + 2)).toEqual(initialized)
  })

  it('always removes expired legacy PII even when migration storage would fail', () => {
    localStorage.setItem(
      'el-bill:bills',
      legacyPayload(sampleBills, '2026-07-26T00:00:00.000Z'),
    )
    localStorage.setItem(
      'el-bill:profile',
      legacyPayload(defaultSchoolProfile, '2026-07-26T00:00:00.000Z'),
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(initializeStorageAfterMount(makeData(), now)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:profile')).toBeNull()
  })

  it('always removes malformed and session-mismatched legacy data', () => {
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

    expect(initializeStorageAfterMount(makeData(), now)).toBeNull()
    expect(localStorage.getItem('el-bill:storage-session')).toBeNull()
    expect(localStorage.getItem('el-bill:storage-commit')).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:profile')).toBeNull()
  })

  it('rejects and removes a legacy fixture whose lifetime exceeds 24 hours', () => {
    localStorage.setItem(
      'el-bill:bills',
      legacyPayload(
        sampleBills,
        '2026-07-27T00:00:00.001Z',
        '2026-07-26T00:00:00.000Z',
      ),
    )

    expect(initializeStorageAfterMount(makeData(), now)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('keeps ambiguous legacy provenance at sample and none', () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:data-mode', legacyPayload('uploaded'))

    const migrated = initializeStorageAfterMount(makeData(), now)

    expect(migrated?.data.provenance).toEqual({
      bills: 'sample',
      powerPlanner: 'none',
    })
  })
})
