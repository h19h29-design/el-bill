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

const draftStorageKeys = () =>
  Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  ).filter((key): key is string =>
    Boolean(key?.startsWith('el-bill:bill-entry-draft:v1:')),
  )

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
    const pointer = JSON.parse(
      localStorage.getItem(billEntryDraftPointerKey) ?? 'null',
    )
    expect(pointer).toEqual({
      version: 1,
      sessionId: 'active/session',
      generationId: expect.any(String),
    })
    expect(
      localStorage.getItem(billEntryDraftKeyFor('active/session')),
    ).not.toBeNull()
    expect(billEntryDraftKeyFor('active/session')).toContain('active%2Fsession')
  })

  it('keeps key derivation total and removes an unpaired-surrogate session pointer through locked cleanup', async () => {
    const malformedSessionId = '\uD800'
    expect(() => billEntryDraftKeyFor(malformedSessionId)).not.toThrow()
    const fallbackKey = billEntryDraftKeyFor(malformedSessionId)
    expect(fallbackKey).toContain('%EF%BF%BD')
    const orphanKey = `${fallbackKey}:orphan`
    const pointerRaw = JSON.stringify({
      version: 1,
      sessionId: malformedSessionId,
      generationId: 'generation-orphan',
    })
    localStorage.setItem(billEntryDraftPointerKey, pointerRaw)
    localStorage.setItem(orphanKey, '{malformed')

    expect(readBillEntryDraft(2_000)).toBeNull()
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBe(pointerRaw)
    expect(await cleanupExpiredBillEntryDraft(2_000)).toBe(true)
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
    expect(localStorage.getItem(orphanKey)).toBeNull()
  })

  it('removes an unpaired-surrogate generation pointer and its orphaned data', async () => {
    const orphanKey = `${billEntryDraftKeyFor('surrogate-removal')}:orphan`
    localStorage.setItem(
      billEntryDraftPointerKey,
      JSON.stringify({
        version: 1,
        sessionId: 'surrogate-removal',
        generationId: '\uDFFF',
      }),
    )
    localStorage.setItem(orphanKey, '{malformed')

    expect(readBillEntryDraft(2_000)).toBeNull()
    expect(await removeBillEntryDraft()).toBe(true)
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
    expect(localStorage.getItem(orphanKey)).toBeNull()
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

  it('preserves CAS, timestamps, and monotonic revision across data-session transitions', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    localStorage.setItem(
      storageActivePointerKey,
      JSON.stringify({ schemaVersion: 1, sessionId: 'new-data-session' }),
    )

    const transitioned = await writeBillEntryDraft(
      [makeDraft({ usageKwh: '123' })],
      first.draft.revision,
      2_000,
    )

    expect(transitioned).toMatchObject({
      ok: true,
      draft: {
        sessionId: 'new-data-session',
        revision: first.draft.revision + 1,
        createdAt: first.draft.createdAt,
        expiresAt: first.draft.expiresAt,
      },
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

  it('physically removes a malformed draft and its pointer only through locked cleanup', async () => {
    const written = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const key = billEntryDraftKeyFor(written.draft.sessionId)
    localStorage.setItem(key, '{malformed')

    expect(readBillEntryDraft(2_000)).toBeNull()
    expect(localStorage.getItem(key)).toBe('{malformed')
    expect(localStorage.getItem(billEntryDraftPointerKey)).not.toBeNull()
    expect(await cleanupExpiredBillEntryDraft(2_000)).toBe(true)
    expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
  })

  it('never mutates localStorage during a synchronous expired read', async () => {
    const written = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
    const key = billEntryDraftKeyFor(written.draft.sessionId)
    const draftRaw = localStorage.getItem(key)
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

    expect(readBillEntryDraft(1_000 + dayMs)).toBeNull()
    expect(removeItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBe(pointerRaw)
    expect(localStorage.getItem(key)).toBe(draftRaw)
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
    const expiredKey = billEntryDraftKeyFor(first.draft.sessionId)

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: '123' })],
        first.draft.revision,
        1_000 + dayMs,
      ),
    ).resolves.toEqual({ ok: false, reason: 'expired' })
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
    expect(localStorage.getItem(expiredKey)).toBeNull()
  })

  it('reports storage-error when expired-write cleanup cannot remove the active generation', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const key = billEntryDraftKeyFor(first.draft.sessionId)
    const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
    const draftRaw = localStorage.getItem(key)
    const nativeRemoveItem = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      storageKey,
    ) {
      if (storageKey === key) {
        throw new DOMException('remove failed', 'UnknownError')
      }
      nativeRemoveItem.call(this, storageKey)
    })

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: 'expired' })],
        first.draft.revision,
        1_000 + dayMs,
      ),
    ).resolves.toEqual({ ok: false, reason: 'storage-error' })
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBe(pointerRaw)
    expect(localStorage.getItem(key)).toBe(draftRaw)
  })

  it('reports storage-error when stale-malformed cleanup cannot remove retryable data', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const key = billEntryDraftKeyFor(first.draft.sessionId)
    const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
    localStorage.setItem(key, '{malformed')
    const nativeRemoveItem = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      storageKey,
    ) {
      if (storageKey === key) {
        throw new DOMException('remove failed', 'UnknownError')
      }
      nativeRemoveItem.call(this, storageKey)
    })

    await expect(
      writeBillEntryDraft([makeDraft()], 99, 2_000),
    ).resolves.toEqual({ ok: false, reason: 'storage-error' })
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBe(pointerRaw)
    expect(localStorage.getItem(key)).toBe('{malformed')
  })

  it('keeps the prior immutable generation readable when candidate readback and rollback fail', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const previousPointer = localStorage.getItem(billEntryDraftPointerKey)
    const previousKey = billEntryDraftKeyFor(first.draft.sessionId)
    const previousRaw = localStorage.getItem(previousKey)
    const nativeSetItem = Storage.prototype.setItem
    const nativeGetItem = Storage.prototype.getItem
    let candidateKey: string | null = null
    let failReadback = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (
        key.startsWith('el-bill:bill-entry-draft:v1:') &&
        JSON.parse(value).revision === first.draft.revision + 1
      ) {
        candidateKey = key
      } else if (
        candidateKey &&
        key === previousKey &&
        value === previousRaw
      ) {
        throw new DOMException('rollback failed', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (failReadback && candidateKey && key === candidateKey) {
        failReadback = false
        return null
      }
      return nativeGetItem.call(this, key)
    })

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: '123' })],
        first.draft.revision,
        2_000,
      ),
    ).resolves.toEqual({ ok: false, reason: 'storage-error' })
    expect(nativeGetItem.call(localStorage, billEntryDraftPointerKey)).toBe(
      previousPointer,
    )
    expect(nativeGetItem.call(localStorage, previousKey)).toBe(previousRaw)
    expect(readBillEntryDraft(2_000)).toEqual(first.draft)
  })

  it('keeps the prior generation readable when pointer commit and candidate cleanup fail', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const previousPointer = localStorage.getItem(billEntryDraftPointerKey)
    const previousKey = billEntryDraftKeyFor(first.draft.sessionId)
    const previousRaw = localStorage.getItem(previousKey)
    const nativeSetItem = Storage.prototype.setItem
    const nativeGetItem = Storage.prototype.getItem
    const nativeRemoveItem = Storage.prototype.removeItem
    let candidateKey: string | null = null
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (
        key.startsWith('el-bill:bill-entry-draft:v1:') &&
        JSON.parse(value).revision === first.draft.revision + 1
      ) {
        candidateKey = key
        nativeSetItem.call(this, key, value)
        return
      }
      if (candidateKey && key === billEntryDraftPointerKey) {
        throw new DOMException('pointer failed', 'QuotaExceededError')
      }
      if (
        candidateKey &&
        key === previousKey &&
        value === previousRaw
      ) {
        throw new DOMException('rollback failed', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (candidateKey && key === candidateKey) {
        throw new DOMException('candidate cleanup failed', 'UnknownError')
      }
      nativeRemoveItem.call(this, key)
    })

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: '123' })],
        first.draft.revision,
        2_000,
      ),
    ).resolves.toEqual({ ok: false, reason: 'storage-error' })
    expect(nativeGetItem.call(localStorage, billEntryDraftPointerKey)).toBe(
      previousPointer,
    )
    expect(nativeGetItem.call(localStorage, previousKey)).toBe(previousRaw)
    expect(readBillEntryDraft(2_000)).toEqual(first.draft)
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
      if (
        storageKey.startsWith('el-bill:bill-entry-draft:v1:') &&
        JSON.parse(value).revision === first.draft.revision + 1
      ) {
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

  it('cleans malformed, expired, wrong-session, and superseded generations in bounded passes', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const activeKey = billEntryDraftKeyFor(first.draft.sessionId)
    const activeRaw = localStorage.getItem(activeKey)
    const baseKey = billEntryDraftKeyFor(first.draft.sessionId)
    for (let index = 0; index < 70; index += 1) {
      const key = `${baseKey}:orphan-${index}`
      const raw =
        index === 0
          ? '{malformed'
          : JSON.stringify({
              ...first.draft,
              sessionId: index === 2 ? 'wrong-session' : first.draft.sessionId,
              createdAt:
                index === 1
                  ? new Date(0).toISOString()
                  : first.draft.createdAt,
              expiresAt:
                index === 1
                  ? new Date(1).toISOString()
                  : first.draft.expiresAt,
            })
      localStorage.setItem(key, raw)
    }

    expect(await cleanupExpiredBillEntryDraft(2_000)).toBe(true)
    expect(localStorage.getItem(activeKey)).toBe(activeRaw)
    expect(readBillEntryDraft(2_000)).toEqual(first.draft)
    const afterFirstPass = draftStorageKeys().filter(
      (key) => key !== activeKey,
    )
    expect(afterFirstPass.length).toBeGreaterThan(0)
    expect(afterFirstPass.length).toBeLessThan(70)

    expect(await cleanupExpiredBillEntryDraft(2_000)).toBe(true)
    expect(draftStorageKeys()).toEqual([activeKey])
    expect(await cleanupExpiredBillEntryDraft(2_000)).toBe(false)
  })

  it('reports generation removal failure and retries it on later cleanup', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const activeKey = billEntryDraftKeyFor(first.draft.sessionId)
    const orphanKey = `${billEntryDraftKeyFor(first.draft.sessionId)}:orphan`
    localStorage.setItem(orphanKey, JSON.stringify(first.draft))
    const nativeRemoveItem = Storage.prototype.removeItem
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(function (this: Storage, key) {
        if (key === orphanKey) {
          throw new DOMException('remove failed', 'UnknownError')
        }
        nativeRemoveItem.call(this, key)
      })

    expect(await cleanupExpiredBillEntryDraft(2_000)).toBe(false)
    expect(localStorage.getItem(orphanKey)).not.toBeNull()
    expect(localStorage.getItem(activeKey)).not.toBeNull()

    removeItem.mockRestore()
    expect(await cleanupExpiredBillEntryDraft(2_000)).toBe(true)
    expect(localStorage.getItem(orphanKey)).toBeNull()
    expect(localStorage.getItem(activeKey)).not.toBeNull()
  })

  it('rejects unsafe revisions and refuses safe-integer overflow', async () => {
    const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const key = billEntryDraftKeyFor(first.draft.sessionId)
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
    stored.revision = Number.MAX_SAFE_INTEGER
    const maxRevisionRaw = JSON.stringify(stored)
    localStorage.setItem(key, maxRevisionRaw)

    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: 'unsafe' })],
        Number.MAX_SAFE_INTEGER + 1,
        2_000,
      ),
    ).resolves.toEqual({ ok: false, reason: 'invalid' })
    await expect(
      writeBillEntryDraft(
        [makeDraft({ usageKwh: 'overflow' })],
        Number.MAX_SAFE_INTEGER,
        2_000,
      ),
    ).resolves.toEqual({ ok: false, reason: 'invalid' })
    expect(localStorage.getItem(key)).toBe(maxRevisionRaw)
  })

  it('rejects invalid timestamps without reading or mutating valid data', async () => {
    for (const invalidNow of [
      Number.NaN,
      -1,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      localStorage.clear()
      const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
      expect(first.ok).toBe(true)
      if (!first.ok) return
      const pointerRaw = localStorage.getItem(billEntryDraftPointerKey)
      const key = billEntryDraftKeyFor(first.draft.sessionId)
      const draftRaw = localStorage.getItem(key)

      expect(readBillEntryDraft(invalidNow)).toBeNull()
      expect(await cleanupExpiredBillEntryDraft(invalidNow)).toBe(false)
      await expect(
        writeBillEntryDraft(
          [makeDraft({ usageKwh: 'invalid-now' })],
          first.draft.revision,
          invalidNow,
        ),
      ).resolves.toEqual({ ok: false, reason: 'invalid' })
      expect(localStorage.getItem(billEntryDraftPointerKey)).toBe(pointerRaw)
      expect(localStorage.getItem(key)).toBe(draftRaw)
    }
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
    const key = billEntryDraftKeyFor(first.draft.sessionId)

    expect(await removeBillEntryDraft()).toBe(true)
    expect(localStorage.getItem(billEntryDraftPointerKey)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
    expect(await removeBillEntryDraft()).toBe(false)
  })
})
