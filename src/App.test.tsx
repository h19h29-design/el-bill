/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultRatePlans } from './data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from './data/sampleBills'
import { samplePowerPlannerDataSource } from './data/samplePowerPlanner'
import {
  startNewStorageSnapshot,
  storageActivePointerKey,
  storageSnapshotKeyFor,
  type StorageSnapshotData,
} from './lib/storage'

const stored = (data: unknown, expiresAt = '2030-01-02T00:00:00.000Z') =>
  JSON.stringify({
    createdAt: '2030-01-01T00:00:00.000Z',
    expiresAt,
    data,
  })

const makeData = (
  overrides: Partial<StorageSnapshotData> = {},
): StorageSnapshotData => ({
  bills: sampleBills,
  profile: defaultSchoolProfile,
  scenario: defaultScenario,
  ratePlans: defaultRatePlans,
  powerPlanner: null,
  provenance: { bills: 'sample', powerPlanner: 'none' },
  ...overrides,
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('data provenance persistence', () => {
  it('removes an ambiguous legacy upload mode without granting upload eligibility', () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
    expect(localStorage.getItem('el-bill:data-mode')).toBeNull()
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
  })

  it('migrates legacy payloads conservatively when explicit provenance is absent', () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))
    localStorage.setItem('el-bill:bills', stored(sampleBills))
    localStorage.setItem(
      'el-bill:power-planner',
      stored(samplePowerPlannerDataSource),
    )

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 미사용',
    )
    expect(localStorage.getItem(storageActivePointerKey)).not.toBeNull()
    expect(localStorage.getItem('el-bill:data-mode')).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
  })

  it('restores explicit PowerPlanner provenance from the atomic root', () => {
    expect(
      startNewStorageSnapshot(
        makeData({
          powerPlanner: samplePowerPlannerDataSource,
          provenance: { bills: 'sample', powerPlanner: 'uploaded' },
        }),
      ).ok,
    ).toBe(true)

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )
    expect(localStorage.length).toBe(2)
  })
})

describe('shared live storage expiry', () => {
  it('clears live user state at the exact 24-hour expiry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'))
    expect(
      startNewStorageSnapshot(
        makeData({ provenance: { bills: 'uploaded', powerPlanner: 'none' } }),
        Date.now(),
        'expiry-session',
      ).ok,
    ).toBe(true)

    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 사용자 업로드',
    )

    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    })

    expect(localStorage.getItem(storageSnapshotKeyFor('expiry-session'))).toBeNull()
    expect(screen.getByText('24시간이 지나 시연 데이터가 삭제되었습니다.')).toBeTruthy()
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
  })

  it('purges a malformed 25-day session instead of scheduling it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'))
    const sessionId = 'overlong-session'
    localStorage.setItem(
      storageSnapshotKeyFor(sessionId),
      JSON.stringify({
        schemaVersion: 1,
        session: {
          createdAt: new Date(Date.now()).toISOString(),
          expiresAt: new Date(
            Date.now() + 25 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          sessionId,
        },
        data: makeData({
          provenance: { bills: 'uploaded', powerPlanner: 'none' },
        }),
      }),
    )
    localStorage.setItem(
      storageActivePointerKey,
      JSON.stringify({ schemaVersion: 1, sessionId }),
    )

    render(<App />)

    expect(localStorage.getItem(storageSnapshotKeyFor(sessionId))).toBeNull()
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '현재 저장된 사용자 데이터 없음',
    )
  })

  it('does not show an expiry countdown without a root snapshot', () => {
    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '현재 저장된 사용자 데이터 없음',
    )
    expect(document.querySelector('.notice-detail')?.textContent).not.toContain(
      '만료 예정',
    )
  })

  it('purges an expired background root when focus returns', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'))
    expect(
      startNewStorageSnapshot(makeData(), Date.now(), 'focus-session').ok,
    ).toBe(true)
    render(<App />)

    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'))
    act(() => {
      fireEvent.focus(window)
    })

    expect(localStorage.getItem(storageSnapshotKeyFor('focus-session'))).toBeNull()
    expect(screen.getByText('24시간이 지나 시연 데이터가 삭제되었습니다.')).toBeTruthy()
  })

  it('purges an expired background root when the document becomes visible', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'))
    expect(
      startNewStorageSnapshot(makeData(), Date.now(), 'visibility-session').ok,
    ).toBe(true)
    render(<App />)

    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(
      localStorage.getItem(storageSnapshotKeyFor('visibility-session')),
    ).toBeNull()
  })
})
