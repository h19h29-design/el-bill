/* @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultRatePlans } from './data/ratePlans'
import { defaultCalculationSettings } from './lib/calculationSettings'
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
  updateStorageSnapshot,
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
  calculationSettings: defaultCalculationSettings,
  powerPlanner: null,
  provenance: { bills: 'sample', powerPlanner: 'none' },
  ...overrides,
})

const flushStorageTasks = async () => {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve()
    }
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('data provenance persistence', () => {
  it('restores calculation mode and factors from the active snapshot', async () => {
    const calculationSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
      vatPercent: 12,
    }
    expect(
      (
        await startNewStorageSnapshot(
          makeData({ calculationSettings }),
          Date.now(),
          'calculation-restore',
        )
      ).ok,
    ).toBe(true)

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))

    expect(
      (
        screen.getByRole('radio', {
          name: '요금표 기반 전체 추정',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)
    expect(
      (screen.getByLabelText('부가세율(%)') as HTMLInputElement).value,
    ).toBe('12')
  })

  it('adopts calculation settings changed by another tab', async () => {
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          Date.now(),
          'calculation-cross-tab',
        )
      ).ok,
    ).toBe(true)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(
      (
        screen.getByRole('radio', {
          name: '고지서 기반 차액 추정',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)

    const result = await updateStorageSnapshot('calculation-cross-tab', {
      calculationSettings: {
        ...defaultCalculationSettings,
        mode: 'tariffFull',
      },
    })
    expect(result.ok).toBe(true)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: storageSnapshotKeyFor('calculation-cross-tab'),
        storageArea: localStorage,
      }),
    )

    await waitFor(() =>
      expect(
        (
          screen.getByRole('radio', {
            name: '요금표 기반 전체 추정',
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    )
  })

  it('keeps prior calculation settings when atomic persistence fails', async () => {
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          Date.now(),
          'calculation-quota',
        )
      ).ok,
    ).toBe(true)
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === storageSnapshotKeyFor('calculation-quota')) {
        throw new DOMException('quota', 'QuotaExceededError')
      }
      return nativeSetItem.call(this, key, value)
    })

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    fireEvent.click(
      screen.getByRole('radio', { name: '요금표 기반 전체 추정' }),
    )

    await waitFor(() =>
      expect(
        (
          screen.getByRole('radio', {
            name: '고지서 기반 차액 추정',
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    )
    expect(
      screen.getByText(
        '브라우저 저장소에 자료를 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요.',
      ),
    ).toBeTruthy()
  })

  it('warns users to keep one tab open when Web Locks are unavailable', () => {
    render(<App />)

    expect(
      screen.getByText(
        '이 브라우저에서는 여러 탭 동시 편집을 안전하게 조정할 수 없습니다. 다른 탭을 닫고 한 탭에서만 사용하세요.',
      ),
    ).toBeTruthy()
  })

  it('removes an ambiguous legacy upload mode without granting upload eligibility', async () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
    await waitFor(() =>
      expect(localStorage.getItem('el-bill:data-mode')).toBeNull(),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
  })

  it('migrates legacy payloads conservatively when explicit provenance is absent', async () => {
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
    await waitFor(() =>
      expect(localStorage.getItem(storageActivePointerKey)).not.toBeNull(),
    )
    expect(localStorage.getItem('el-bill:data-mode')).toBeNull()
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
  })

  it('restores explicit PowerPlanner provenance from the atomic root', async () => {
    expect(
      (await startNewStorageSnapshot(
        makeData({
          powerPlanner: samplePowerPlannerDataSource,
          provenance: { bills: 'sample', powerPlanner: 'uploaded' },
        }),
      )).ok,
    ).toBe(true)

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )
    expect(localStorage.length).toBe(2)
  })
})

describe('shared live storage expiry', () => {
  it('clears live user state at the exact 24-hour expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'))
    expect(
      (await startNewStorageSnapshot(
        makeData({ provenance: { bills: 'uploaded', powerPlanner: 'none' } }),
        Date.now(),
        'expiry-session',
      )).ok,
    ).toBe(true)

    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 파일 업로드',
    )

    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    })
    await flushStorageTasks()

    expect(
      localStorage.getItem(storageSnapshotKeyFor('expiry-session')),
    ).toBeNull()
    expect(screen.getByText('24시간이 지나 시연 데이터가 삭제되었습니다.')).toBeTruthy()
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
  })

  it('removes inactive and active scoped snapshots by their own 24-hour boundaries', async () => {
    vi.useFakeTimers()
    const startedAt = Date.parse('2026-07-26T00:00:00.000Z')
    vi.setSystemTime(startedAt)
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          startedAt,
          'scheduled-inactive',
        )
      ).ok,
    ).toBe(true)
    const inactiveKey = storageSnapshotKeyFor('scheduled-inactive')
    const nativeRemoveItem = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === inactiveKey && Date.now() < startedAt + 24 * 60 * 60 * 1000) {
        throw new DOMException('remove failed', 'QuotaExceededError')
      }
      nativeRemoveItem.call(this, key)
    })
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          startedAt + 1_000,
          'scheduled-active',
        )
      ).ok,
    ).toBe(true)

    render(<App />)
    await flushStorageTasks()
    expect(localStorage.getItem(inactiveKey)).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    })
    expect(localStorage.getItem(inactiveKey)).toBeNull()
    expect(
      localStorage.getItem(storageSnapshotKeyFor('scheduled-active')),
    ).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flushStorageTasks()
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
    expect(
      Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      ).filter((key) => key?.startsWith('el-bill:storage-snapshot:')),
    ).toEqual([])
  })

  it('purges a malformed 25-day session instead of scheduling it', async () => {
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
    await flushStorageTasks()

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

  it('purges an expired background root when focus returns', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'))
    expect(
      (await startNewStorageSnapshot(
        makeData(),
        Date.now(),
        'focus-session',
      )).ok,
    ).toBe(true)
    render(<App />)

    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'))
    act(() => {
      fireEvent.focus(window)
    })
    await flushStorageTasks()

    expect(
      localStorage.getItem(storageSnapshotKeyFor('focus-session')),
    ).toBeNull()
    expect(screen.getByText('24시간이 지나 시연 데이터가 삭제되었습니다.')).toBeTruthy()
  })

  it('purges an expired background root when the document becomes visible', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'))
    expect(
      (await startNewStorageSnapshot(
        makeData(),
        Date.now(),
        'visibility-session',
      )).ok,
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
    await flushStorageTasks()

    expect(
      localStorage.getItem(storageSnapshotKeyFor('visibility-session')),
    ).toBeNull()
  })
})
