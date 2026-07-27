/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManualBillDraftRow } from './billInput'
import {
  billEntryDraftKeyFor,
  billEntryDraftPointerKey,
  cleanupExpiredBillEntryDraft,
  readBillEntryDraft,
  removeBillEntryDraft,
  writeBillEntryDraft,
} from './billDraftStorage'
import { storageActivePointerKey } from './storage'

const dayMs = 24 * 60 * 60 * 1000

const makeDraft = (
  patch: Partial<ManualBillDraftRow> = {},
): ManualBillDraftRow => ({
  id: 'row-1',
  yearMonth: '',
  usageKwh: '',
  totalBillWon: '',
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

const setLocks = (locks: Pick<LockManager, 'request'> | undefined) => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  })
}

const draftPointer = (sessionId: string) =>
  JSON.stringify({ version: 1, sessionId })

describe('expiring manual bill draft storage', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocks(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    setLocks(undefined)
  })

  it('restores a bounded draft without extending expiry on edits', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const edited = await writeBillEntryDraft(
      [{ ...makeDraft(), usageKwh: '123' }],
      first.draft.revision,
      2_000,
    )
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.draft.createdAt).toBe(first.draft.createdAt)
    expect(edited.draft.expiresAt).toBe(first.draft.expiresAt)
    expect(edited.draft.revision).toBe(first.draft.revision + 1)
    expect(readBillEntryDraft(2_000)).toEqual(edited.draft)
  })

  it('physically deletes an expired draft', async () => {
    await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(await cleanupExpiredBillEntryDraft(86_401_001)).toBe(true)
    expect(readBillEntryDraft(86_401_001)).toBeNull()
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
    expect(
      Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
        .some((key) => key?.startsWith('el-bill:bill-entry-draft:')),
    ).toBe(false)
  })

  it('rejects stale concurrent revisions', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    await expect(
      writeBillEntryDraft([makeDraft()], 99, 2_000),
    ).resolves.toEqual({
      ok: false,
      reason: 'stale',
    })
  })

  it('uses the active data session and an encoded session-scoped key', async () => {
    localStorage.setItem(
      storageActivePointerKey,
      JSON.stringify({ schemaVersion: 1, sessionId: 'active/session' }),
    )

    const result = await writeBillEntryDraft([makeDraft()], undefined, 1_000)

    expect(result).toMatchObject({
      ok: true,
      draft: { sessionId: 'active/session', revision: 0 },
    })
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBe(
      draftPointer('active/session'),
    )
    expect(
      localStorage.getItem(billEntryDraftKeyFor('active/session')),
    ).not.toBeNull()
    expect(billEntryDraftKeyFor('active/session')).toContain('active%2Fsession')
  })

  it('creates and retains a draft-only session when data has no active session', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await writeBillEntryDraft(
      [makeDraft({ usageKwh: '2' })],
      first.draft.revision,
      2_000,
    )

    expect(first.draft.sessionId).toMatch(/^draft-/)
    expect(second).toMatchObject({
      ok: true,
      draft: { sessionId: first.draft.sessionId },
    })
  })

  it('rejects invalid row collections without replacing a valid draft', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const key = billEntryDraftKeyFor(first.draft.sessionId)
    const previousRaw = localStorage.getItem(key)
    const invalidCases = [
      Array.from({ length: 37 }, (_, index) =>
        makeDraft({ id: `row-${index}` }),
      ),
      [makeDraft(), makeDraft()],
      [{ ...makeDraft(), note: 1 } as unknown as ManualBillDraftRow],
      [
        {
          ...makeDraft(),
          unexpected: 'not part of the draft schema',
        } as ManualBillDraftRow,
      ],
    ]

    for (const rows of invalidCases) {
      await expect(
        writeBillEntryDraft(rows, first.draft.revision, 2_000),
      ).resolves.toEqual({ ok: false, reason: 'invalid' })
      expect(localStorage.getItem(key)).toBe(previousRaw)
      expect(readBillEntryDraft(2_000)).toEqual(first.draft)
    }
  })

  it('physically removes a malformed draft and its pointer when read', () => {
    const sessionId = 'malformed'
    const key = billEntryDraftKeyFor(sessionId)
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      sessionId,
      revision: 0,
      createdAt: new Date(1_000).toISOString(),
      expiresAt: new Date(1_000 + dayMs).toISOString(),
      rows: [{ ...makeDraft(), usageKwh: 123 }],
    }))
    localStorage.setItem(billEntryDraftPointerKey, draftPointer(sessionId))

    expect(readBillEntryDraft(2_000)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
  })

  it('does not remove a valid pointer that replaces a malformed pointer during read', async () => {
    const written = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const validPointer = localStorage.getItem(billEntryDraftPointerKey)
    const validKey = billEntryDraftKeyFor(written.draft.sessionId)
    const validRaw = localStorage.getItem(validKey)
    localStorage.clear()
    localStorage.setItem(billEntryDraftPointerKey, '{malformed')
    const nativeGetItem = Storage.prototype.getItem
    const nativeSetItem = Storage.prototype.setItem
    let replaced = false
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === billEntryDraftPointerKey && !replaced) {
        replaced = true
        nativeSetItem.call(this, billEntryDraftPointerKey, validPointer ?? '')
        nativeSetItem.call(this, validKey, validRaw ?? '')
        return '{malformed'
      }
      return nativeGetItem.call(this, key)
    })

    expect(readBillEntryDraft(2_000)).toBeNull()
    expect(nativeGetItem.call(localStorage, billEntryDraftPointerKey)).toBe(
      validPointer,
    )
    expect(nativeGetItem.call(localStorage, validKey)).toBe(validRaw)
  })

  it('does not remove a valid draft that replaces malformed data during read', async () => {
    const written = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const validPointer = localStorage.getItem(billEntryDraftPointerKey)
    const validKey = billEntryDraftKeyFor(written.draft.sessionId)
    const validRaw = localStorage.getItem(validKey)
    localStorage.setItem(validKey, '{malformed')
    const nativeGetItem = Storage.prototype.getItem
    const nativeSetItem = Storage.prototype.setItem
    let replaced = false
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === validKey && !replaced) {
        replaced = true
        nativeSetItem.call(this, validKey, validRaw ?? '')
        return '{malformed'
      }
      return nativeGetItem.call(this, key)
    })

    expect(readBillEntryDraft(2_000)).toBeNull()
    expect(nativeGetItem.call(localStorage, billEntryDraftPointerKey)).toBe(
      validPointer,
    )
    expect(nativeGetItem.call(localStorage, validKey)).toBe(validRaw)
  })

  it('rejects and physically removes an expired draft before an edit', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: '123' })],
        first.draft.revision,
        1_000 + dayMs,
      ),
    ).resolves.toEqual({ ok: false, reason: 'expired' })
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
    expect(
      localStorage.getItem(billEntryDraftKeyFor(first.draft.sessionId)),
    ).toBeNull()
  })

  it('preserves a valid draft when a later storage write fails', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const key = billEntryDraftKeyFor(first.draft.sessionId)
    const previousRaw = localStorage.getItem(key)
    const previousPointer = localStorage.getItem(billEntryDraftPointerKey)
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      storageKey,
      value,
    ) {
      if (storageKey === key) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, storageKey, value)
    })

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: '123' })],
        first.draft.revision,
        2_000,
      ),
    ).resolves.toEqual({ ok: false, reason: 'storage-error' })
    expect(localStorage.getItem(key)).toBe(previousRaw)
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBe(previousPointer)
  })

  it('reports lock acquisition failures without changing valid storage', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const key = billEntryDraftKeyFor(first.draft.sessionId)
    const previousRaw = localStorage.getItem(key)
    setLocks({
      request: (() => {
        throw new Error('lock unavailable')
      }) as LockManager['request'],
    })

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: '123' })],
        first.draft.revision,
        2_000,
      ),
    ).resolves.toEqual({ ok: false, reason: 'lock-error' })
    expect(localStorage.getItem(key)).toBe(previousRaw)
  })

  it('removes the active draft key and pointer', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(await removeBillEntryDraft()).toBe(true)
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
    expect(
      localStorage.getItem(billEntryDraftKeyFor(first.draft.sessionId)),
    ).toBeNull()
    expect(await removeBillEntryDraft()).toBe(false)
  })
})
