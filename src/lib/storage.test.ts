/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStorageSession,
  loadForSession,
  loadWithExpiry,
  purgeExpiredKeys,
  purgeInvalidCurrentStorageSession,
  purgeStorageSession,
  restoreStorageSession,
  saveForSession,
  saveWithExpiry,
  startNewStorageSession,
  storageCommitKey,
  storageSessionKey,
} from './storage'

describe('local demo storage TTL harness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00+09:00'))
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('removes data after the 24-hour demo TTL expires', () => {
    saveWithExpiry('el-bill:test', { schoolName: 'A고등학교' })

    expect(loadWithExpiry<{ schoolName: string }>('el-bill:test')?.data.schoolName).toBe(
      'A고등학교',
    )

    vi.setSystemTime(new Date('2026-07-01T00:00:01+09:00'))

    expect(loadWithExpiry('el-bill:test')).toBeNull()
    expect(localStorage.getItem('el-bill:test')).toBeNull()
  })

  it('purges expired keys without touching valid demo data', () => {
    saveWithExpiry('el-bill:expired', 'old')

    vi.setSystemTime(new Date('2026-06-30T12:00:00+09:00'))
    saveWithExpiry('el-bill:valid', 'new')

    vi.setSystemTime(new Date('2026-07-01T00:00:01+09:00'))
    purgeExpiredKeys(['el-bill:expired', 'el-bill:valid'])

    expect(localStorage.getItem('el-bill:expired')).toBeNull()
    expect(loadWithExpiry<string>('el-bill:valid')?.data).toBe('new')
  })

  it('does not extend the absolute expiry when saved data is updated', () => {
    const initial = saveWithExpiry('el-bill:absolute', { version: 1 })

    vi.setSystemTime(new Date('2026-06-30T23:00:00+09:00'))
    const updated = saveWithExpiry('el-bill:absolute', { version: 2 })

    expect(updated.createdAt).toBe(initial.createdAt)
    expect(updated.expiresAt).toBe(initial.expiresAt)

    vi.setSystemTime(new Date('2026-07-01T00:00:01+09:00'))
    expect(loadWithExpiry('el-bill:absolute')).toBeNull()
  })

  it('starts a fresh 24-hour session when user data is uploaded', () => {
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    const first = createStorageSession()

    vi.setSystemTime(new Date('2026-07-26T23:00:00Z'))
    const uploaded = createStorageSession()

    expect(Date.parse(uploaded.expiresAt) - Date.parse(uploaded.createdAt)).toBe(
      24 * 60 * 60 * 1000,
    )
    expect(uploaded.expiresAt).not.toBe(first.expiresAt)
    expect(uploaded.sessionId).not.toBe(first.sessionId)
  })

  it('keeps ordinary edits on the shared upload expiry', () => {
    const session = startNewStorageSession([['el-bill:bills', { version: 1 }]])

    vi.advanceTimersByTime(23 * 60 * 60 * 1000)
    saveForSession('el-bill:profile', { version: 2 }, session)

    const bills = JSON.parse(localStorage.getItem('el-bill:bills') ?? '{}')
    const profile = JSON.parse(localStorage.getItem('el-bill:profile') ?? '{}')
    expect(profile.expiresAt).toBe(bills.expiresAt)
    expect(profile.expiresAt).toBe(session.expiresAt)
  })

  it('purges every user key when the shared session expires', () => {
    const session = createStorageSession()
    localStorage.setItem(storageSessionKey, JSON.stringify(session))
    saveForSession('el-bill:bills', { version: 1 }, session)
    saveForSession('el-bill:profile', { version: 1 }, session)

    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(purgeStorageSession(['el-bill:bills', 'el-bill:profile'], session)).toBe(true)
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:profile')).toBeNull()
    expect(localStorage.getItem(storageSessionKey)).toBeNull()
  })

  it('migrates legacy payloads to their earliest existing expiry without extending them', () => {
    localStorage.setItem(
      'el-bill:bills',
      JSON.stringify({
        createdAt: '2026-06-30T00:00:00.000Z',
        expiresAt: '2026-07-01T00:00:00.000Z',
        data: { version: 1 },
      }),
    )
    localStorage.setItem(
      'el-bill:profile',
      JSON.stringify({
        createdAt: '2026-06-30T12:00:00.000Z',
        expiresAt: '2026-07-01T12:00:00.000Z',
        data: { version: 1 },
      }),
    )

    const session = restoreStorageSession(['el-bill:bills', 'el-bill:profile'])

    expect(session?.expiresAt).toBe('2026-07-01T00:00:00.000Z')
    expect(JSON.parse(localStorage.getItem(storageSessionKey) ?? '{}')).toEqual(session)
    expect(JSON.parse(localStorage.getItem('el-bill:bills') ?? '{}').sessionId).toBe(
      session?.sessionId,
    )
  })

  it('removes a payload whose session ID does not match the active session', () => {
    const session = startNewStorageSession([], Date.now(), 'active-session')
    localStorage.setItem(
      'el-bill:bills',
      JSON.stringify({ ...session, sessionId: 'stale-session', data: { version: 1 } }),
    )

    expect(loadForSession('el-bill:bills', session)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('makes an uploaded payload and provenance reloadable in the new session immediately', () => {
    const session = startNewStorageSession([
      ['el-bill:bills', { version: 2 }],
      ['el-bill:data-provenance', { bills: 'uploaded', powerPlanner: 'none' }],
    ], Date.now(), 'upload-session')

    expect(restoreStorageSession(['el-bill:bills', 'el-bill:data-provenance'])).toEqual(session)
    expect(loadForSession<{ version: number }>('el-bill:bills', session)?.data).toEqual({ version: 2 })
    expect(loadForSession('el-bill:data-provenance', session)?.data).toEqual({
      bills: 'uploaded',
      powerPlanner: 'none',
    })
  })

  it('does not let a stale writer replace a newer session payload', () => {
    const staleSession = startNewStorageSession(
      [['el-bill:bills', { version: 1 }]],
      Date.now(),
      'stale-session',
    )
    const activeSession = startNewStorageSession(
      [['el-bill:bills', { version: 2 }]],
      Date.now() + 1,
      'active-session',
    )

    expect(saveForSession('el-bill:bills', { version: 3 }, staleSession)).toBeNull()
    expect(loadForSession('el-bill:bills', staleSession)).toBeNull()
    expect(loadForSession<{ version: number }>('el-bill:bills', activeSession)?.data).toEqual({ version: 2 })
  })

  it('purges an interrupted session without a matching commit marker', () => {
    const session = createStorageSession(Date.now(), 'interrupted-session')
    localStorage.setItem(storageSessionKey, JSON.stringify(session))
    localStorage.setItem('el-bill:bills', JSON.stringify({ ...session, data: { version: 1 } }))

    expect(restoreStorageSession(['el-bill:bills'])).toBeNull()
    expect(localStorage.getItem(storageSessionKey)).toBeNull()
    expect(localStorage.getItem(storageCommitKey)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('only purges the current session when its required snapshot is incomplete', () => {
    const session = createStorageSession(Date.now(), 'current-incomplete-session')
    localStorage.setItem(storageSessionKey, JSON.stringify(session))
    localStorage.setItem(storageCommitKey, JSON.stringify(session))
    localStorage.setItem('el-bill:bills', JSON.stringify({ ...session, data: { version: 1 } }))

    expect(
      purgeInvalidCurrentStorageSession(
        ['el-bill:bills', 'el-bill:profile'],
        ['el-bill:bills', 'el-bill:profile'],
      ),
    ).toBe(true)
    expect(localStorage.getItem(storageSessionKey)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('does not purge a valid current session while rechecking another tab', () => {
    const session = startNewStorageSession([
      ['el-bill:bills', { version: 2 }],
      ['el-bill:profile', { version: 2 }],
    ], Date.now(), 'current-committed-session')

    expect(
      purgeInvalidCurrentStorageSession(
        ['el-bill:bills', 'el-bill:profile'],
        ['el-bill:bills', 'el-bill:profile'],
      ),
    ).toBe(false)
    expect(JSON.parse(localStorage.getItem(storageSessionKey) ?? '{}')).toEqual(session)
  })

  it('restores a fully committed snapshot immediately after upload', () => {
    const session = startNewStorageSession([
      ['el-bill:bills', { version: 2 }],
      ['el-bill:profile', { version: 2 }],
    ], Date.now(), 'committed-session')

    expect(restoreStorageSession(['el-bill:bills', 'el-bill:profile'])).toEqual(session)
    expect(JSON.parse(localStorage.getItem(storageCommitKey) ?? '{}')).toEqual(session)
    expect(loadForSession<{ version: number }>('el-bill:bills', session)?.data).toEqual({ version: 2 })
    expect(loadForSession<{ version: number }>('el-bill:profile', session)?.data).toEqual({ version: 2 })
  })

  it('rejects writes to an expired background session even when the ID matches', () => {
    const session = startNewStorageSession(
      [['el-bill:bills', { version: 1 }]],
      Date.now(),
      'expired-session',
    )

    vi.advanceTimersByTime(24 * 60 * 60 * 1000)

    expect(saveForSession('el-bill:bills', { version: 2 }, session)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).not.toContain('"version":2')
  })

  it('does not migrate a malformed session ID as legacy data', () => {
    localStorage.setItem(
      storageSessionKey,
      JSON.stringify({
        createdAt: '2026-06-30T00:00:00.000Z',
        expiresAt: '2026-07-01T00:00:00.000Z',
        sessionId: '',
      }),
    )
    localStorage.setItem(
      'el-bill:bills',
      JSON.stringify({
        createdAt: '2026-06-30T00:00:00.000Z',
        expiresAt: '2026-07-01T00:00:00.000Z',
        data: { version: 1 },
      }),
    )

    expect(restoreStorageSession(['el-bill:bills'])).toBeNull()
    expect(localStorage.getItem(storageSessionKey)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('removes malformed payloads with an invalid expiry timestamp', () => {
    localStorage.setItem(
      'el-bill:malformed',
      JSON.stringify({
        createdAt: '2026-06-30T00:00:00.000Z',
        expiresAt: 'not-a-date',
        data: 'untrusted',
      }),
    )

    expect(loadWithExpiry('el-bill:malformed')).toBeNull()
    expect(localStorage.getItem('el-bill:malformed')).toBeNull()
  })
})
