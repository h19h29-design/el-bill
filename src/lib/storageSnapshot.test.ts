/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import { defaultCalculationSettings } from './calculationSettings'
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
  calculationSettings: defaultCalculationSettings,
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
  it('restores custom calculation settings without changing the session expiry', async () => {
    const now = Date.parse('2026-07-26T00:00:00.000Z')
    const calculationSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
      fuelAdjustmentWonPerKwh: -4,
    }
    expect(
      (
        await startNewStorageSnapshot(
          { ...makeData(), calculationSettings },
          now,
          'calculation-settings',
        )
      ).ok,
    ).toBe(true)

    const restored = readStorageSnapshot(now + 1_000)
    expect(restored?.data.calculationSettings).toEqual(calculationSettings)
    expect(restored?.session.expiresAt).toBe(
      new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    )
  })

  it('defaults calculation settings in an old atomic snapshot without extending TTL', async () => {
    const now = Date.parse('2026-07-26T00:00:00.000Z')
    const oldRoot = snapshot('old-calculation-settings', makeData(), now)
    const oldData = { ...oldRoot.data } as Partial<StorageSnapshotData>
    delete oldData.calculationSettings
    localStorage.setItem(
      storageSnapshotKeyFor(oldRoot.session.sessionId),
      JSON.stringify({ ...oldRoot, data: oldData }),
    )
    localStorage.setItem(
      storageActivePointerKey,
      JSON.stringify({
        schemaVersion: 1,
        sessionId: oldRoot.session.sessionId,
      }),
    )

    const restored = readStorageSnapshot(now + 1_000)
    expect(restored?.data.calculationSettings).toEqual(
      defaultCalculationSettings,
    )
    expect(restored?.session.expiresAt).toBe(oldRoot.session.expiresAt)
  })

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

  it('normalizes legacy PowerPlanner duplicates and persists the sanitized snapshot', async () => {
    const duplicateRecord = {
      id: 'hourly-1',
      dataType: 'hourlyUsage' as const,
      date: '2026-07-01',
      hour: 13,
      usageKwh: 120,
      sourceRowIndex: 0,
    }
    const powerPlanner = {
      id: 'legacy-power-planner',
      provider: 'kepco-power-planner' as const,
      sourceName: 'power-planner.csv',
      sourceLabel: '파워플래너 자료',
      importedAt: '2026-07-26T00:00:00.000Z',
      records: [
        duplicateRecord,
        { ...duplicateRecord, id: 'hourly-duplicate', sourceRowIndex: 1 },
      ],
      memo: '중복 레거시',
    }
    const sessionId = 'duplicate-power-planner'
    const legacy = snapshot(sessionId, {
      ...makeData({ bills: 'uploaded', powerPlanner: 'uploaded' }),
      powerPlanner,
    })
    localStorage.setItem(storageSnapshotKeyFor(sessionId), JSON.stringify(legacy))
    localStorage.setItem(storageActivePointerKey, pointer(sessionId))

    const initialized = await initializeStorageAfterMount(makeData(), now)

    expect(initialized?.data.powerPlanner?.records).toHaveLength(1)
    expect(initialized?.data.provenance.powerPlanner).toBe('uploaded')
    const persisted = JSON.parse(
      localStorage.getItem(storageSnapshotKeyFor(sessionId)) ?? '{}',
    )
    expect(persisted.data.powerPlanner.records).toHaveLength(1)
  })

  it('drops only PowerPlanner data when restored unique records exceed 10,000', async () => {
    const records = Array.from({ length: 10_001 }, (_, index) => ({
      id: `hourly-${index}`,
      dataType: 'hourlyUsage' as const,
      date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
      hour: index % 24,
      usageKwh: index + 1,
      sourceRowIndex: index,
    }))
    const sessionId = 'oversized-power-planner'
    const legacy = snapshot(sessionId, {
      ...makeData({ bills: 'uploaded', powerPlanner: 'uploaded' }),
      powerPlanner: {
        id: 'oversized',
        provider: 'kepco-power-planner',
        sourceName: 'oversized.csv',
        sourceLabel: '파워플래너 자료',
        importedAt: '2026-07-26T00:00:00.000Z',
        records,
        memo: '레거시 초과',
      },
    })
    localStorage.setItem(storageSnapshotKeyFor(sessionId), JSON.stringify(legacy))
    localStorage.setItem(storageActivePointerKey, pointer(sessionId))

    const initialized = await initializeStorageAfterMount(makeData(), now)

    expect(initialized?.data.bills).toEqual(sampleBills)
    expect(initialized?.data.profile).toEqual(defaultSchoolProfile)
    expect(initialized?.data.powerPlanner).toBeNull()
    expect(initialized?.data.provenance.powerPlanner).toBe('none')
  })

  it('drops only PowerPlanner data when a restored record has negative usage', async () => {
    const sessionId = 'invalid-power-planner-record'
    const legacy = snapshot(sessionId, {
      ...makeData({ bills: 'uploaded', powerPlanner: 'uploaded' }),
      powerPlanner: {
        id: 'invalid-record-source',
        provider: 'kepco-power-planner',
        sourceName: 'invalid.csv',
        sourceLabel: '파워플래너 자료',
        importedAt: '2026-07-26T00:00:00.000Z',
        records: [
          {
            id: 'negative-usage',
            dataType: 'hourlyUsage',
            date: '2026-07-01',
            hour: 13,
            usageKwh: -1,
            sourceRowIndex: 0,
          },
        ],
        memo: '잘못된 레거시',
      },
    })
    localStorage.setItem(storageSnapshotKeyFor(sessionId), JSON.stringify(legacy))
    localStorage.setItem(storageActivePointerKey, pointer(sessionId))

    const initialized = await initializeStorageAfterMount(makeData(), now)

    expect(initialized?.data.bills).toEqual(sampleBills)
    expect(initialized?.data.powerPlanner).toBeNull()
    expect(initialized?.data.provenance.powerPlanner).toBe('none')
  })

  it.each([
    ['negative bill usage', { bills: sampleBills.map((bill) => ({ ...bill, usageKwh: -1 })) }],
    ['non-finite bill total', { bills: sampleBills.map((bill) => ({ ...bill, totalBillWon: Number.POSITIVE_INFINITY })) }],
    ['negative tariff', { ratePlans: defaultRatePlans.map((plan, index) => index === 0 ? { ...plan, baseRateWonPerKw: -1 } : plan) }],
    ['duplicate tariff id', { ratePlans: [defaultRatePlans[0], { ...defaultRatePlans[1], id: defaultRatePlans[0].id }] }],
    ['duplicate tariff tuple', { ratePlans: [defaultRatePlans[0], { ...defaultRatePlans[1], id: 'unique', contractType: ` ${defaultRatePlans[0].contractType} `, voltageType: defaultRatePlans[0].voltageType, planName: ` ${defaultRatePlans[0].planName} ` }] }],
    ['invalid school power', { profile: { ...defaultSchoolProfile, contractPowerKw: -1 } }],
    ['invalid required scenario', { scenario: { ...defaultScenario, expectedPeakKw: -1 } }],
  ])('does not restore a snapshot containing %s', (_label, patch) => {
    const sessionId = 'invalid-domain-data'
    const invalid = snapshot(sessionId, { ...makeData(), ...patch })
    localStorage.setItem(storageSnapshotKeyFor(sessionId), JSON.stringify(invalid))
    localStorage.setItem(storageActivePointerKey, pointer(sessionId))

    expect(readStorageSnapshot(now)).toBeNull()
  })

  it('normalizes restored EHP groups and persists the sanitized snapshot', async () => {
    const sessionId = 'normalized-peak-scenario'
    const restored = snapshot(sessionId, {
      ...makeData(),
      scenario: {
        ...defaultScenario,
        mainBuildingEhpGroups: 1_000_000_000,
        annexEhpGroups: 0,
      },
    })
    localStorage.setItem(
      storageSnapshotKeyFor(sessionId),
      JSON.stringify(restored),
    )
    localStorage.setItem(storageActivePointerKey, pointer(sessionId))

    const initialized = await initializeStorageAfterMount(makeData(), now)

    expect(initialized?.data.scenario).toMatchObject({
      mainBuildingEhpGroups: 100,
      annexEhpGroups: 2,
    })
    const persisted = JSON.parse(
      localStorage.getItem(storageSnapshotKeyFor(sessionId)) ?? '{}',
    )
    expect(persisted.data.scenario).toMatchObject({
      mainBuildingEhpGroups: 100,
      annexEhpGroups: 2,
    })
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

  it('normalizes duplicate legacy PowerPlanner records without losing bills', async () => {
    const powerPlanner = {
      id: 'legacy-power-planner',
      provider: 'kepco-power-planner' as const,
      sourceName: 'legacy.csv',
      sourceLabel: '한전 파워플래너 사용자 업로드',
      importedAt: '2026-07-26T01:00:00.000Z',
      memo: '레거시',
      records: [
        {
          id: 'first',
          dataType: 'hourlyUsage' as const,
          date: '2026-06-01',
          hour: 13,
          usageKwh: 100,
          sourceRowIndex: 0,
        },
        {
          id: 'duplicate',
          dataType: 'hourlyUsage' as const,
          date: '2026/06/01',
          hour: 13,
          usageKwh: 100,
          sourceRowIndex: 1,
        },
      ],
    }
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    localStorage.setItem('el-bill:scenario', legacyPayload(defaultScenario))
    localStorage.setItem('el-bill:rate-plans', legacyPayload(defaultRatePlans))
    localStorage.setItem(
      'el-bill:power-planner',
      legacyPayload(powerPlanner),
    )
    localStorage.setItem(
      'el-bill:data-provenance',
      legacyPayload({ bills: 'uploaded', powerPlanner: 'uploaded' }),
    )

    const migrated = await initializeStorageAfterMount(makeData(), now)

    expect(migrated?.data.bills).toEqual(sampleBills)
    expect(migrated?.data.provenance).toEqual({
      bills: 'uploaded',
      powerPlanner: 'uploaded',
    })
    expect(migrated?.data.powerPlanner?.records).toHaveLength(1)
  })

  it('normalizes legacy EHP groups before restoring and persists the sanitized snapshot', async () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    localStorage.setItem(
      'el-bill:scenario',
      legacyPayload({
        ...defaultScenario,
        mainBuildingEhpGroups: 1_000_000_000,
        annexEhpGroups: 0,
      }),
    )
    localStorage.setItem('el-bill:rate-plans', legacyPayload(defaultRatePlans))

    const migrated = await initializeStorageAfterMount(makeData(), now)

    expect(migrated?.data.scenario).toMatchObject({
      mainBuildingEhpGroups: 100,
      annexEhpGroups: 2,
    })
    const persisted = JSON.parse(
      localStorage.getItem(
        storageSnapshotKeyFor(migrated?.session.sessionId ?? ''),
      ) ?? '{}',
    )
    expect(persisted.data.scenario).toMatchObject({
      mainBuildingEhpGroups: 100,
      annexEhpGroups: 2,
    })
  })

  it('drops invalid legacy PowerPlanner data only and preserves uploaded bills', async () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    localStorage.setItem('el-bill:scenario', legacyPayload(defaultScenario))
    localStorage.setItem('el-bill:rate-plans', legacyPayload(defaultRatePlans))
    localStorage.setItem(
      'el-bill:power-planner',
      legacyPayload({
        id: 'invalid-power-planner',
        provider: 'kepco-power-planner',
        sourceName: 'invalid.csv',
        sourceLabel: '한전 파워플래너 사용자 업로드',
        importedAt: '2026-07-26T01:00:00.000Z',
        memo: '잘못된 레거시',
        records: [
          {
            id: 'invalid-date',
            dataType: 'hourlyUsage',
            date: '2026-02-30',
            hour: 13,
            usageKwh: 100,
            sourceRowIndex: 0,
          },
        ],
      }),
    )
    localStorage.setItem(
      'el-bill:data-provenance',
      legacyPayload({ bills: 'uploaded', powerPlanner: 'uploaded' }),
    )

    const migrated = await initializeStorageAfterMount(makeData(), now)

    expect(migrated?.data.bills).toEqual(sampleBills)
    expect(migrated?.data.profile).toEqual(defaultSchoolProfile)
    expect(migrated?.data.powerPlanner).toBeNull()
    expect(migrated?.data.provenance).toEqual({
      bills: 'uploaded',
      powerPlanner: 'none',
    })
  })

  it('drops over-limit legacy PowerPlanner data only and preserves uploaded bills', async () => {
    const records = Array.from({ length: 10_001 }, (_, index) => ({
      id: `legacy-hourly-${index}`,
      dataType: 'hourlyUsage',
      date: '2026-07-01',
      hour: 13,
      usageKwh: index + 1,
      sourceRowIndex: index,
    }))
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    localStorage.setItem('el-bill:scenario', legacyPayload(defaultScenario))
    localStorage.setItem('el-bill:rate-plans', legacyPayload(defaultRatePlans))
    localStorage.setItem(
      'el-bill:power-planner',
      legacyPayload({
        id: 'oversized-power-planner',
        provider: 'kepco-power-planner',
        sourceName: 'oversized.csv',
        sourceLabel: '한전 파워플래너 사용자 업로드',
        importedAt: '2026-07-26T01:00:00.000Z',
        memo: '초과 레거시',
        records,
      }),
    )
    localStorage.setItem(
      'el-bill:data-provenance',
      legacyPayload({ bills: 'uploaded', powerPlanner: 'uploaded' }),
    )

    const migrated = await initializeStorageAfterMount(makeData(), now)

    expect(migrated?.data.bills).toEqual(sampleBills)
    expect(migrated?.data.profile).toEqual(defaultSchoolProfile)
    expect(migrated?.data.powerPlanner).toBeNull()
    expect(migrated?.data.provenance).toEqual({
      bills: 'uploaded',
      powerPlanner: 'none',
    })
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
