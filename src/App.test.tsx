/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { defaultScenario, defaultSchoolProfile, sampleBills } from './data/sampleBills'
import { samplePowerPlannerDataSource } from './data/samplePowerPlanner'
import { defaultRatePlans } from './data/ratePlans'
import { startNewStorageSession, storageCommitKey, storageSessionKey } from './lib/storage'
import type { DataProvenance } from './types'

const stored = (data: unknown) =>
  JSON.stringify({
    createdAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-01-02T00:00:00.000Z',
    data,
  })

const expiredStored = (data: unknown) =>
  JSON.stringify({
    createdAt: '2020-01-01T00:00:00.000Z',
    expiresAt: '2020-01-02T00:00:00.000Z',
    data,
  })

const snapshotEntries = (
  provenance: DataProvenance = { bills: 'uploaded', powerPlanner: 'none' },
  powerPlanner: unknown = null,
) => [
  ['el-bill:bills', sampleBills],
  ['el-bill:profile', defaultSchoolProfile],
  ['el-bill:scenario', defaultScenario],
  ['el-bill:rate-plans', defaultRatePlans],
  ['el-bill:power-planner', powerPlanner],
  ['el-bill:data-provenance', provenance],
] as const

const startCommittedSnapshot = (
  provenance: DataProvenance = { bills: 'uploaded', powerPlanner: 'none' },
  powerPlanner: unknown = null,
) => startNewStorageSession(
  [...snapshotEntries(provenance, powerPlanner)],
  Date.parse('2026-07-26T00:00:00Z'),
)

const writeCommittedSnapshot = (
  session: { createdAt: string; expiresAt: string; sessionId: string },
  provenance: DataProvenance = { bills: 'uploaded', powerPlanner: 'none' },
  powerPlanner: unknown = null,
) => {
  localStorage.setItem(storageSessionKey, JSON.stringify(session))
  snapshotEntries(provenance, powerPlanner).forEach(([key, data]) => {
    localStorage.setItem(key, JSON.stringify({ ...session, data }))
  })
  localStorage.setItem(storageCommitKey, JSON.stringify(session))
}

describe('data provenance persistence', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('keeps a legacy uploaded mode without billing evidence locked to the sample', async () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))

    const firstRender = render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(localStorage.getItem('el-bill:data-mode')).toBeNull()
      expect(localStorage.getItem('el-bill:data-provenance')).toBeNull()
    })

    firstRender.unmount()
    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
  })

  it('shows a stable loading frame while a heavy dashboard view is loaded', async () => {
    render(<App />)

    expect(screen.getByText('화면을 불러오는 중입니다.')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '전기요금 자동진단 시작' })).toBeTruthy()
    })
  })

  it('shows the same loading frame while the spreadsheet upload view loads', async () => {
    render(<App />)

    await screen.findByRole('button', { name: '전기요금 자동진단 시작' })
    fireEvent.click(screen.getByRole('button', { name: /^고지서 입력$/ }))

    expect(screen.getByText('화면을 불러오는 중입니다.')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: '월별 한전고지서 입력' })).toBeTruthy()
  })

  it('keeps legacy uploaded mode with stored bills and PowerPlanner data locked to the sample', async () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))
    localStorage.setItem('el-bill:bills', stored(sampleBills))
    localStorage.setItem('el-bill:power-planner', stored(samplePowerPlannerDataSource))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(localStorage.getItem('el-bill:data-provenance')).toBeNull()
      expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: /^파워플래너$/ }))
    expect(
      await screen.findByText('파워플래너 자료가 없으면 기존 한전 고지서 월별 데이터만으로 진단합니다.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^피크관리$/ }))
    expect(
      await screen.findByText(/파워플래너 자료가 없으므로 기존 한전 고지서 월별 데이터와 예상 피크 입력값으로 진단합니다/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^문서생성$/ }))
    expect(await screen.findByText('사용자 고지서 업로드 후 생성 가능')).toBeTruthy()
  })

  it('restores PowerPlanner records for a new explicit provenance session', async () => {
    startCommittedSnapshot(
      { bills: 'sample', powerPlanner: 'uploaded' },
      samplePowerPlannerDataSource,
    )

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('파워플래너: 사용자 업로드')
    fireEvent.click(screen.getByRole('button', { name: /^파워플래너$/ }))
    expect(await screen.findByText('25건')).toBeTruthy()
    expect(localStorage.getItem('el-bill:power-planner')).not.toBeNull()
  })

  it.each([
    ['missing', null],
    ['expired', expiredStored(samplePowerPlannerDataSource)],
    ['invalid JSON', '{invalid'],
  ])('downgrades explicit PowerPlanner provenance when its payload is %s', (_, payload) => {
    startCommittedSnapshot(
      { bills: 'sample', powerPlanner: 'uploaded' },
      samplePowerPlannerDataSource,
    )
    if (payload) {
      localStorage.setItem('el-bill:power-planner', payload)
    } else {
      localStorage.removeItem('el-bill:power-planner')
    }

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('파워플래너: 미사용')
    expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
    expect(localStorage.getItem('el-bill:data-provenance')).toBeNull()
  })

  it('rejects malformed explicit PowerPlanner payloads before they reach the view', async () => {
    startCommittedSnapshot(
      { bills: 'sample', powerPlanner: 'uploaded' },
      samplePowerPlannerDataSource,
    )
    localStorage.setItem(
      'el-bill:power-planner',
      stored({
        id: 'invalid-source',
        provider: 'kepco-power-planner',
        sourceName: '잘못된 자료',
        sourceLabel: '잘못된 자료',
        importedAt: '2030-01-01T00:00:00.000Z',
        records: [{ id: 'invalid-record', dataType: 'hourlyUsage', hour: '13' }],
        memo: '',
      }),
    )

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('파워플래너: 미사용')
    expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^파워플래너$/ }))
    expect(
      await screen.findByText('파워플래너 자료가 없으면 기존 한전 고지서 월별 데이터만으로 진단합니다.'),
    ).toBeTruthy()
  })

  it('clears PowerPlanner data after an expired legacy mode without explicit provenance', async () => {
    localStorage.setItem('el-bill:data-mode', expiredStored('uploaded'))
    localStorage.setItem('el-bill:power-planner', stored(samplePowerPlannerDataSource))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('파워플래너: 미사용')
    expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^파워플래너$/ }))
    expect(
      await screen.findByText('파워플래너 자료가 없으면 기존 한전 고지서 월별 데이터만으로 진단합니다.'),
    ).toBeTruthy()
  })

  it('migrates a legacy sample session without granting upload eligibility', async () => {
    localStorage.setItem('el-bill:data-mode', stored('sample'))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(localStorage.getItem('el-bill:data-provenance')).toBeNull()
    })
  })

  it('replaces malformed stored provenance with the safe sample defaults', async () => {
    localStorage.setItem(
      'el-bill:data-provenance',
      stored({ bills: 'uploaded', powerPlanner: 'untrusted' }),
    )

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(localStorage.getItem('el-bill:data-provenance')).toBeNull()
    })
  })

  it.each([
    ['expired', JSON.stringify({ createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z', data: sampleBills })],
    ['malformed', stored({ not: 'monthly bills' })],
  ])('does not trust a %s billing payload during legacy upload migration', async (_, payload) => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))
    localStorage.setItem('el-bill:bills', payload)

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(localStorage.getItem('el-bill:data-provenance')).toBeNull()
    })
  })
})

describe('shared live storage expiry', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.useRealTimers()
  })

  it('clears live user state when the shared session expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    const session = {
      createdAt: '2026-07-26T00:00:00.000Z',
      expiresAt: '2026-07-27T00:00:00.000Z',
      sessionId: 'expiry-session',
    }
    writeCommittedSnapshot(session)

    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 사용자 업로드')

    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    })

    expect(screen.getByText('시연 샘플', { exact: true })).toBeTruthy()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(screen.getByText('24시간이 지나 시연 데이터가 삭제되었습니다.')).toBeTruthy()
  })

  it('bounds a long migrated session timer to the browser timeout limit', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    writeCommittedSnapshot({
      createdAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-02T00:00:00.000Z',
      sessionId: 'long-session',
    })
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    render(<App />)

    expect(
      setTimeoutSpy.mock.calls.every(([, delay]) =>
        typeof delay === 'number' && delay <= 2_147_483_647,
      ),
    ).toBe(true)
  })

  it('reschedules after a capped timer interval before expiring the active session', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    const maxDelay = 2_147_483_647
    const session = {
      createdAt: '2026-07-26T00:00:00.000Z',
      expiresAt: new Date(Date.now() + maxDelay + 1_000).toISOString(),
      sessionId: 'capped-session',
    }
    writeCommittedSnapshot(session)

    render(<App />)
    act(() => {
      vi.advanceTimersByTime(maxDelay)
    })
    expect(localStorage.getItem('el-bill:bills')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('does not show an expiry countdown without an active storage session', () => {
    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '현재 저장된 사용자 데이터 없음',
    )
    expect(document.querySelector('.notice-detail')?.textContent).not.toContain('만료 예정')
  })

  it('purges an expired background session when focus returns', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    startNewStorageSession([
      ['el-bill:bills', sampleBills],
      ['el-bill:profile', defaultSchoolProfile],
      ['el-bill:scenario', defaultScenario],
      ['el-bill:rate-plans', defaultRatePlans],
      ['el-bill:power-planner', null],
      ['el-bill:data-provenance', { bills: 'uploaded', powerPlanner: 'none' }],
    ], Date.now(), 'focus-session')
    render(<App />)

    vi.setSystemTime(new Date('2026-07-27T00:00:00Z'))
    act(() => {
      fireEvent.focus(window)
    })

    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(screen.getByText('24시간이 지나 시연 데이터가 삭제되었습니다.')).toBeTruthy()
  })

  it('purges an expired background session when the document becomes visible', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    startNewStorageSession([
      ['el-bill:bills', sampleBills],
      ['el-bill:profile', defaultSchoolProfile],
      ['el-bill:scenario', defaultScenario],
      ['el-bill:rate-plans', defaultRatePlans],
      ['el-bill:power-planner', null],
      ['el-bill:data-provenance', { bills: 'uploaded', powerPlanner: 'none' }],
    ], Date.now(), 'visibility-session')
    render(<App />)

    vi.setSystemTime(new Date('2026-07-27T00:00:00Z'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(localStorage.getItem('el-bill:bills')).toBeNull()
  })

  it('cleans up a cross-tab session that remains uncommitted after the grace recheck', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    startCommittedSnapshot()
    render(<App />)

    const interruptedSession = {
      createdAt: '2026-07-26T00:00:00.000Z',
      expiresAt: '2026-07-27T00:00:00.000Z',
      sessionId: 'interrupted-tab-session',
    }
    localStorage.removeItem(storageCommitKey)
    localStorage.setItem(storageSessionKey, JSON.stringify(interruptedSession))
    localStorage.setItem(
      'el-bill:bills',
      JSON.stringify({ ...interruptedSession, data: sampleBills }),
    )

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: storageSessionKey,
        storageArea: localStorage,
      }))
      vi.advanceTimersByTime(100)
    })

    expect(localStorage.getItem(storageSessionKey)).toBeNull()
    expect(localStorage.getItem(storageCommitKey)).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '현재 저장된 사용자 데이터 없음',
    )
  })

  it('adopts a complete cross-tab session after the grace recheck', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
    startCommittedSnapshot()
    render(<App />)

    const adoptedSession = startCommittedSnapshot(
      { bills: 'sample', powerPlanner: 'uploaded' },
      samplePowerPlannerDataSource,
    )

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: storageCommitKey,
        storageArea: localStorage,
      }))
      vi.advanceTimersByTime(100)
    })

    expect(JSON.parse(localStorage.getItem(storageSessionKey) ?? '{}')).toMatchObject({
      sessionId: adoptedSession.sessionId,
    })
    expect(localStorage.getItem(storageCommitKey)).not.toBeNull()
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )
  })
})
