/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadWithExpiry, purgeExpiredKeys, saveWithExpiry } from './storage'

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
})
