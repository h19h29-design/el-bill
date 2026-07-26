/* @vitest-environment jsdom */

import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultRatePlans } from './data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from './data/sampleBills'
import { samplePowerPlannerDataSource } from './data/samplePowerPlanner'
import { defaultCalculationSettings } from './lib/calculationSettings'
import {
  readStorageSnapshot,
  removeStorageSnapshot,
  startNewStorageSnapshot,
  storageActivePointerKey,
  storageSnapshotKeyFor,
  updateStorageSnapshot,
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
  calculationSettings: defaultCalculationSettings,
  powerPlanner: null,
  provenance: { bills: 'sample', powerPlanner: 'none' },
  ...overrides,
})

const legacyPayload = (data: unknown) =>
  JSON.stringify({
    createdAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    data,
  })

const monthlyCsv = [
  '연도,월,사용량,총 전기요금',
  ...Array.from({ length: 12 }, (_, index) =>
    `2025,${index + 1},${30000 + index * 100},${5000000 + index * 1000}`,
  ),
].join('\n')

const failWritesFor = (sessionId: string) => {
  const sessionKey = storageSnapshotKeyFor(sessionId)
  const nativeSetItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === sessionKey) {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
    nativeSetItem.call(this, key, value)
  })
}

describe('App session-scoped storage integration', () => {
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

  it('performs pure reads during render and migrates once under StrictMode effects', async () => {
    localStorage.setItem('el-bill:bills', legacyPayload(sampleBills))
    localStorage.setItem('el-bill:profile', legacyPayload(defaultSchoolProfile))
    const beforeRender = new Map([
      ['el-bill:bills', localStorage.getItem('el-bill:bills')],
      ['el-bill:profile', localStorage.getItem('el-bill:profile')],
    ])

    renderToString(<App />)

    expect(localStorage.getItem('el-bill:bills')).toBe(beforeRender.get('el-bill:bills'))
    expect(localStorage.getItem('el-bill:profile')).toBe(beforeRender.get('el-bill:profile'))
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()

    const nativeSetItem = Storage.prototype.setItem
    const pointerWrites: string[] = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === storageActivePointerKey) pointerWrites.push(value)
      nativeSetItem.call(this, key, value)
    })
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await waitFor(() =>
      expect(localStorage.getItem(storageActivePointerKey)).not.toBeNull(),
    )
    expect(pointerWrites).toHaveLength(1)
    expect(localStorage.getItem('el-bill:bills')).toBeNull()
    expect(localStorage.getItem('el-bill:profile')).toBeNull()
  })

  it('restores one complete active snapshot immediately after reload', async () => {
    expect(
      (await startNewStorageSnapshot(
        makeData({
          powerPlanner: samplePowerPlannerDataSource,
          provenance: { bills: 'uploaded', powerPlanner: 'uploaded' },
        }),
        now,
        'reload-session',
      )).ok,
    ).toBe(true)

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 사용자 업로드',
    )
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )
  })

  it('keeps prior UI and storage when a new upload cannot be written', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'sample-session')).ok,
    ).toBe(true)
    render(<App />)
    const previousPointer = localStorage.getItem(storageActivePointerKey)
    const failedUploadId = '00000000-0000-4000-8000-000000000001'
    failWritesFor(failedUploadId)
    const originalRandomUuid = globalThis.crypto.randomUUID
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(failedUploadId)

    fireEvent.click(screen.getByRole('button', { name: /^고지서 입력$/ }))
    const input = await waitFor(() => {
      const element = document.querySelector<HTMLInputElement>(
        'input[accept=".csv"]',
      )
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    fireEvent.change(input, {
      target: {
        files: [new File([monthlyCsv], 'billing.csv', { type: 'text/csv' })],
      },
    })
    fireEvent.click(
      await screen.findByRole('button', {
        name: '이 매핑으로 분석 시작',
      }),
    )

    expect((await screen.findAllByText(/브라우저 저장소/)).length).toBeGreaterThan(0)
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBe(previousPointer)
    expect(globalThis.crypto.randomUUID).not.toBe(originalRandomUuid)
  })

  it('preserves newer cross-tab settings and PowerPlanner data during a stale bill upload', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'stale-upload-tab')).ok,
    ).toBe(true)
    render(<App />)
    const latestSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
      climateEnvironmentWonPerKwh: 21,
    }
    expect(
      (
        await updateStorageSnapshot('stale-upload-tab', {
          calculationSettings: latestSettings,
          powerPlanner: samplePowerPlannerDataSource,
          provenance: { bills: 'sample', powerPlanner: 'uploaded' },
        })
      ).ok,
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /^고지서 입력$/ }))
    const input = await waitFor(() => {
      const element = document.querySelector<HTMLInputElement>(
        'input[accept=".csv"]',
      )
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    fireEvent.change(input, {
      target: {
        files: [new File([monthlyCsv], 'billing.csv', { type: 'text/csv' })],
      },
    })
    fireEvent.click(
      await screen.findByRole('button', {
        name: '이 매핑으로 분석 시작',
      }),
    )

    await waitFor(() =>
      expect(readStorageSnapshot(now)?.session.sessionId).not.toBe(
        'stale-upload-tab',
      ),
    )
    expect(readStorageSnapshot(now)?.data).toEqual(
      expect.objectContaining({
        calculationSettings: latestSettings,
        powerPlanner: samplePowerPlannerDataSource,
        provenance: {
          bills: 'uploaded',
          powerPlanner: 'uploaded',
        },
      }),
    )
  })

  it('adopts a new pointer winner and ignores events for inactive snapshot keys', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'first-tab')).ok,
    ).toBe(true)
    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 미사용',
    )

    expect(
      (await startNewStorageSnapshot(
        makeData({
          powerPlanner: samplePowerPlannerDataSource,
          provenance: { bills: 'sample', powerPlanner: 'uploaded' },
        }),
        now + 1,
        'second-tab',
      )).ok,
    ).toBe(true)
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: storageActivePointerKey,
          newValue: localStorage.getItem(storageActivePointerKey),
          storageArea: localStorage,
        }),
      )
    })
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: storageSnapshotKeyFor('first-tab'),
          newValue: null,
          storageArea: localStorage,
        }),
      )
    })
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 사용자 업로드',
    )
  })

  it('adopts active-session edits and resets when its snapshot is removed', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'active-tab')).ok,
    ).toBe(true)
    render(<App />)
    const updatedData = makeData({
      provenance: { bills: 'uploaded', powerPlanner: 'none' },
    })
    expect(
      (
        await updateStorageSnapshot(
          'active-tab',
          { provenance: updatedData.provenance },
          now + 1,
        )
      ).ok,
    ).toBe(true)

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: storageSnapshotKeyFor('active-tab'),
          newValue: localStorage.getItem(storageSnapshotKeyFor('active-tab')),
          storageArea: localStorage,
        }),
      )
    })
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 사용자 업로드',
    )

    expect(await removeStorageSnapshot('active-tab')).toEqual({
      ok: true,
      outcome: 'active-deactivated',
      snapshotRemoved: true,
    })
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: storageActivePointerKey,
          newValue: null,
          storageArea: localStorage,
        }),
      )
    })
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
  })

  it('resets when another tab removes the active pointer', async () => {
    expect(
      (await startNewStorageSnapshot(
        makeData({ provenance: { bills: 'uploaded', powerPlanner: 'none' } }),
        now,
        'pointer-removal',
      )).ok,
    ).toBe(true)
    render(<App />)
    localStorage.removeItem(storageActivePointerKey)

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: storageActivePointerKey,
          newValue: null,
          storageArea: localStorage,
        }),
      )
    })

    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '고지서: 시연 샘플',
    )
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '현재 저장된 사용자 데이터 없음',
    )
  })

  it('retries inactive orphan cleanup indefinitely with delays capped at 15 minutes', async () => {
    expect(
      (
        await startNewStorageSnapshot(
          makeData({
            provenance: { bills: 'uploaded', powerPlanner: 'none' },
          }),
          now,
          'reset-orphan',
        )
      ).ok,
    ).toBe(true)
    render(<App />)
    await act(async () => {
      for (let index = 0; index < 6; index += 1) {
        await Promise.resolve()
      }
    })
    const snapshotKey = storageSnapshotKeyFor('reset-orphan')
    const nativeRemoveItem = Storage.prototype.removeItem
    let rejectSnapshotRemoval = true
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === snapshotKey && rejectSnapshotRemoval) {
        throw new DOMException('remove failed', 'QuotaExceededError')
      }
      nativeRemoveItem.call(this, key)
    })

    fireEvent.click(
      screen.getByRole('button', { name: '시연 샘플로 초기화' }),
    )

    await waitFor(() =>
      expect(document.querySelector('.notice-detail')?.textContent).toContain(
        '고지서: 시연 샘플',
      ),
    )
    expect(localStorage.getItem(storageActivePointerKey)).toBeNull()
    expect(localStorage.getItem(snapshotKey)).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999)
    })
    expect(localStorage.getItem(snapshotKey)).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(localStorage.getItem(snapshotKey)).not.toBeNull()

    for (const delay of [5, 15, 15]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay * 60_000 - 1)
      })
      expect(localStorage.getItem(snapshotKey)).not.toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(localStorage.getItem(snapshotKey)).not.toBeNull()
    }

    rejectSnapshotRemoval = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000)
    })
    expect(localStorage.getItem(snapshotKey)).toBeNull()
  })

  it('retains the prior profile control value when persistence fails', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'profile-session')).ok,
    ).toBe(true)
    render(<App />)
    failWritesFor('profile-session')
    fireEvent.click(screen.getByRole('button', { name: '학교정보' }))
    const input = await screen.findByLabelText('화면 표시명')

    fireEvent.change(input, { target: { value: '변경된 학교' } })

    expect((input as HTMLInputElement).value).toBe(
      defaultSchoolProfile.displaySchoolName,
    )
    expect(
      await screen.findByText(/브라우저 저장소에 자료를 저장하지 못했습니다/),
    ).toBeTruthy()
  })

  it('retains the prior scenario control value when persistence fails', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'scenario-session')).ok,
    ).toBe(true)
    render(<App />)
    failWritesFor('scenario-session')
    fireEvent.click(screen.getByRole('button', { name: '피크관리' }))
    const input = await screen.findByLabelText('목표 피크(kW)')

    fireEvent.change(input, { target: { value: '777' } })

    expect((input as HTMLInputElement).value).toBe(
      String(defaultScenario.targetPeakKw),
    )
    expect(
      await screen.findByText(/브라우저 저장소에 자료를 저장하지 못했습니다/),
    ).toBeTruthy()
  })

  it('retains the prior rate-plan control value when persistence fails', async () => {
    expect(
      (await startNewStorageSnapshot(makeData(), now, 'rate-session')).ok,
    ).toBe(true)
    render(<App />)
    failWritesFor('rate-session')
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    const input = (await screen.findAllByLabelText('요금제명'))[0]

    fireEvent.change(input, { target: { value: '저장 실패 요금제' } })

    expect((input as HTMLInputElement).value).toBe(defaultRatePlans[0].planName)
    expect(
      await screen.findByText(/브라우저 저장소에 자료를 저장하지 못했습니다/),
    ).toBeTruthy()
  })

  it('retains the prior PowerPlanner state when persistence fails', async () => {
    expect(
      (
        await startNewStorageSnapshot(
          makeData(),
          now,
          'power-planner-session',
        )
      ).ok,
    ).toBe(true)
    render(<App />)
    failWritesFor('power-planner-session')
    fireEvent.click(screen.getByRole('button', { name: '파워플래너' }))
    fireEvent.click(await screen.findByRole('button', { name: '시연 샘플 적용' }))

    expect(
      await screen.findByText(/브라우저 저장소에 자료를 저장하지 못했습니다/),
    ).toBeTruthy()
    expect(document.querySelector('.notice-detail')?.textContent).toContain(
      '파워플래너: 미사용',
    )
    expect(readStorageSnapshot(now)?.data.powerPlanner).toBeNull()
  })
})
