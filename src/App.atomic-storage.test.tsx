/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultRatePlans } from './data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from './data/sampleBills'
import { samplePowerPlannerDataSource } from './data/samplePowerPlanner'
import {
  removeStorageSnapshot,
  startNewStorageSnapshot,
  storageSnapshotKey,
  type StorageSnapshotData,
} from './lib/storage'

const now = Date.parse('2026-07-26T00:00:00.000Z')

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

const monthlyCsv = [
  '연도,월,사용량,총 전기요금',
  ...Array.from({ length: 12 }, (_, index) =>
    `2025,${index + 1},${30000 + index * 100},${5000000 + index * 1000}`,
  ),
].join('\n')

describe('App atomic storage integration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(now)
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('restores one coherent root snapshot on the first render', () => {
    const result = startNewStorageSnapshot(
      makeData({
        powerPlanner: samplePowerPlannerDataSource,
        provenance: { bills: 'uploaded', powerPlanner: 'uploaded' },
      }),
      now,
      'reload-session',
    )
    expect(result.ok).toBe(true)

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 사용자 업로드',
    )
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )
    expect(localStorage.length).toBe(1)
  })

  it('keeps prior state and shows Korean guidance when an upload cannot be stored', async () => {
    const result = startNewStorageSnapshot(makeData(), now, 'sample-session')
    expect(result.ok).toBe(true)
    render(<App />)
    const previousRoot = localStorage.getItem(storageSnapshotKey)
    const nativeSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === storageSnapshotKey) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })

    fireEvent.click(screen.getByRole('button', { name: /^고지서 입력$/ }))
    const input = await waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('input[accept=".csv"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    fireEvent.change(input, {
      target: { files: [new File([monthlyCsv], 'billing.csv', { type: 'text/csv' })] },
    })
    fireEvent.click(await screen.findByRole('button', { name: '이 매핑으로 분석 시작' }))

    expect((await screen.findAllByText(/브라우저 저장소/)).length).toBeGreaterThan(0)
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
    expect(localStorage.getItem(storageSnapshotKey)).toBe(previousRoot)
  })

  it('atomically adopts a valid newer root snapshot from another tab', () => {
    expect(startNewStorageSnapshot(makeData(), now, 'first-tab').ok).toBe(true)
    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 미사용',
    )

    const next = startNewStorageSnapshot(
      makeData({
        powerPlanner: samplePowerPlannerDataSource,
        provenance: { bills: 'sample', powerPlanner: 'uploaded' },
      }),
      now + 1,
      'second-tab',
    )
    expect(next.ok).toBe(true)
    const root = localStorage.getItem(storageSnapshotKey)

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: storageSnapshotKey,
        newValue: root,
        storageArea: localStorage,
      }))
    })

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )
  })

  it('resets to samples when another tab removes the active root snapshot', () => {
    expect(
      startNewStorageSnapshot(
        makeData({ provenance: { bills: 'uploaded', powerPlanner: 'none' } }),
        now,
        'removed-session',
      ).ok,
    ).toBe(true)
    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 사용자 업로드',
    )

    expect(removeStorageSnapshot('removed-session')).toBe(true)
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: storageSnapshotKey,
        newValue: null,
        storageArea: localStorage,
      }))
    })

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '현재 저장된 사용자 데이터 없음',
    )
  })
})
