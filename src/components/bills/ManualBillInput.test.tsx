/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import {
  billEntryDraftKeyFor,
  billEntryDraftPointerKey,
  readBillEntryDraft,
  writeBillEntryDraft,
} from '../../lib/billDraftStorage'
import type { BillImportContext } from '../../types'
import { ManualBillInput } from './ManualBillInput'

const importContext: BillImportContext = {
  appliedPowerKw: 497,
  currentPlan: defaultRatePlans[0],
}

const makeDraft = (patch: Record<string, string> = {}) => ({
  id: 'restored-row',
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

const renderInput = () => {
  const onCandidateChange = vi.fn()
  const onOpenGuide = vi.fn()
  render(
    <ManualBillInput
      importContext={importContext}
      onCandidateChange={onCandidateChange}
      onOpenGuide={onOpenGuide}
    />,
  )
  return { onCandidateChange, onOpenGuide }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ManualBillInput', () => {
  it('creates 12 rows and emits a normalized manual candidate from populated cells', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    expect(screen.getAllByLabelText(/사용량\(kWh\)/)).toHaveLength(12)

    await user.type(screen.getByLabelText('2026-07 사용량(kWh)'), '48,365 kWh')
    await user.type(screen.getByLabelText('2026-07 총 전기요금(원)'), '7,138,790원')

    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: 'manual' }),
    )
  })

  it('formats only the unfocused display while preserving raw text and candidate value', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    const usage = screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement
    const total = screen.getByLabelText('2026-07 총 전기요금(원)') as HTMLInputElement
    await user.type(usage, '48,365 kWh')
    await user.type(total, '7,138,790원')
    const candidateBeforeRefocus = onCandidateChange.mock.calls
      .map(([candidate]) => candidate)
      .filter(Boolean)
      .at(-1)

    expect(usage.value).toBe('48,365')
    await user.click(usage)
    expect(usage.value).toBe('48,365 kWh')
    await user.tab()
    expect(usage.value).toBe('48,365')
    expect(
      onCandidateChange.mock.calls
        .map(([candidate]) => candidate)
        .filter(Boolean)
        .at(-1),
    ).toEqual(candidateBeforeRefocus)
  })

  it('shows horizontal-scroll guidance and marks a completed valid row accurately', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    const usage = screen.getByLabelText('2026-07 사용량(kWh)')
    const row = usage.closest('tr')
    if (!row) throw new Error('manual row missing')

    expect(
      screen.getByText('표를 좌우로 밀어 상세 항목을 확인하세요.'),
    ).not.toBeNull()
    expect(within(row).getByText('입력 대기')).not.toBeNull()

    await user.type(usage, '48365')
    await user.type(
      screen.getByLabelText('2026-07 총 전기요금(원)'),
      '7138790',
    )

    expect(within(row).getByText('입력 완료')).not.toBeNull()
    expect(within(row).queryByText('입력 대기')).toBeNull()
  })

  it('shows detail columns and applies an entered power value to every row', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    await user.click(screen.getByRole('button', { name: '상세 항목 펼치기' }))
    await user.type(screen.getByLabelText('2026-07 요금적용전력(kW)'), '497 kW')
    await user.click(screen.getByRole('button', { name: '모든 월에 동일 적용' }))

    expect((screen.getByLabelText('2026-06 요금적용전력(kW)') as HTMLInputElement).value).toBe('497')
  })

  it('fills adjacent rows and columns from a multi-cell paste', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    await user.click(screen.getByLabelText('2026-07 사용량(kWh)'))
    fireEvent.paste(screen.getByLabelText('2026-07 사용량(kWh)'), {
      clipboardData: { getData: () => '10\t100\n20\t200' },
    })

    expect((screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('2026-07 총 전기요금(원)') as HTMLInputElement).value).toBe('100')
    expect((screen.getByLabelText('2026-06 사용량(kWh)') as HTMLInputElement).value).toBe('20')
    expect((screen.getByLabelText('2026-06 총 전기요금(원)') as HTMLInputElement).value).toBe('200')
  })

  it('rejects an oversized matrix paste before changing the current rows', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    const usage = screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement
    fireEvent.paste(usage, {
      clipboardData: { getData: () => `${'9'.repeat(200_000)}\t100` },
    })

    expect(usage.value).toBe('')
    expect(screen.getByText(/200,000자 이하/)).not.toBeNull()
  })

  it('clips multi-cell paste at the final visible column', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    fireEvent.paste(screen.getByLabelText('2026-07 총 전기요금(원)'), {
      clipboardData: { getData: () => '100\t20\tignored' },
    })

    expect((screen.getByLabelText('2026-07 총 전기요금(원)') as HTMLInputElement).value).toBe('100')
    expect((screen.getByLabelText('2026-07 최대수요전력(kW)') as HTMLInputElement).value).toBe('20')
  })

  it('shows required-cell issues for an edited but incomplete row', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    await user.click(screen.getByRole('button', { name: '입력행 추가' }))
    await user.type(screen.getByLabelText('연월'), '2026-07')

    expect(screen.getAllByText('0보다 큰 숫자를 입력해 주세요.')).toHaveLength(2)
  })

  it('keeps modifier-based arrow-key shortcuts inside the active cell', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    const usage = screen.getAllByLabelText('2026-07 사용량(kWh)').at(-1)!
    await user.click(usage)
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}')

    expect(document.activeElement).toBe(usage)
  })

  it('moves across visible grid cells with Tab, Shift+Tab, Enter, and arrow keys', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))

    const julyUsage = screen.getByLabelText('2026-07 사용량(kWh)')
    const julyTotal = screen.getByLabelText('2026-07 총 전기요금(원)')
    const juneUsage = screen.getByLabelText('2026-06 사용량(kWh)')
    const juneTotal = screen.getByLabelText('2026-06 총 전기요금(원)')
    await user.click(julyUsage)

    await user.keyboard('{Tab}')
    expect(document.activeElement).toBe(julyTotal)
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(julyUsage)
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(juneUsage)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(juneTotal)
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(juneUsage)
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(julyUsage)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(juneUsage)
  })

  it('does not intercept composing keyboard input', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    const usage = screen.getByLabelText('2026-07 사용량(kWh)')
    await user.click(usage)

    fireEvent.keyDown(usage, { key: 'ArrowRight', isComposing: true })
    expect(document.activeElement).toBe(usage)
  })

  it('shows duplicate-period issues and moves focus to the first invalid cell', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    await user.type(screen.getByLabelText('2026-07 사용량(kWh)'), '10')
    await user.type(screen.getByLabelText('2026-07 총 전기요금(원)'), '100')
    await user.click(screen.getByRole('button', { name: '입력행 추가' }))
    const periodInputs = screen.getAllByLabelText('연월')
    const usageInputs = screen.getAllByLabelText(/사용량\(kWh\)/)
    const totalInputs = screen.getAllByLabelText(/총 전기요금\(원\)/)
    await user.type(periodInputs.at(-1)!, '2026-07')
    await user.type(usageInputs.at(-1)!, '20')
    await user.type(totalInputs.at(-1)!, '200')

    expect(screen.getAllByText(/duplicated/)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '첫 오류로 이동' }))
    expect(document.activeElement).toBe(screen.getAllByLabelText('2026-07 연월')[0])
  })

  it('renders focusable global period issues when a month is missing', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    await user.type(screen.getByLabelText('2026-07 사용량(kWh)'), '10')
    await user.type(screen.getByLabelText('2026-07 총 전기요금(원)'), '100')
    await user.type(screen.getByLabelText('2026-05 사용량(kWh)'), '20')
    await user.type(screen.getByLabelText('2026-05 총 전기요금(원)'), '200')

    const globalIssue = screen.getByRole('status', { name: '기간 확인 필요' })
    expect(globalIssue.textContent).toMatch(/missing/)
    const firstIssueAction = screen.getByRole('button', { name: '첫 오류로 이동' })
    expect(firstIssueAction.getAttribute('aria-controls')).toBe('manual-global-issues')
    await user.click(firstIssueAction)
    expect(document.activeElement).toBe(globalIssue)
  })

  it('connects invalid cells to their visible issue text', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    await user.click(screen.getByRole('button', { name: '입력행 추가' }))
    await user.type(screen.getByLabelText('연월'), '2026-07')
    const usage = screen.getAllByLabelText('2026-07 사용량(kWh)').at(-1)!

    expect(usage.getAttribute('aria-invalid')).toBe('true')
    const issueId = usage.getAttribute('aria-describedby')
    expect(issueId).not.toBeNull()
    expect(document.getElementById(issueId ?? '')?.textContent).toBe('0보다 큰 숫자를 입력해 주세요.')
  })

  it('caps direct entry at 36 rows', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.click(screen.getByRole('button', { name: '최근 36개월 입력행 생성' }))
    expect(screen.getAllByLabelText(/사용량\(kWh\)/)).toHaveLength(36)
    expect((screen.getByRole('button', { name: '입력행 추가' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('restores an expiring draft on mount', async () => {
    await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '48,365 kWh' }),
    ])
    renderInput()

    const usage = screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement
    expect(usage.value).toBe('48,365')
    fireEvent.focus(usage)
    expect(usage.value).toBe('48,365 kWh')
    expect(screen.getByText(/이전 입력 초안을 복원했습니다/)).not.toBeNull()
  })

  it('does not restore an expired draft or mutate storage outside App maintenance', async () => {
    vi.useFakeTimers()
    const createdAt = Date.parse('2026-07-27T00:00:00.000Z')
    vi.setSystemTime(createdAt)
    const written = await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
    ])
    if (!written.ok) throw new Error('draft setup failed')
    const draftKey = billEntryDraftKeyFor(written.draft.sessionId)
    vi.setSystemTime(createdAt + 24 * 60 * 60 * 1000)

    renderInput()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByLabelText('2026-07 사용량(kWh)')).toBeNull()
    expect(localStorage.getItem(draftKey)).not.toBeNull()
    expect(localStorage.getItem(billEntryDraftPointerKey)).not.toBeNull()
  })

  it('writes only after the full 300ms debounce interval', async () => {
    vi.useFakeTimers()
    renderInput()

    fireEvent.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    expect(readBillEntryDraft()).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(readBillEntryDraft()).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(readBillEntryDraft()?.rows).toHaveLength(12)
  })

  it('retains rows and reports a failed debounced save', async () => {
    vi.useFakeTimers()
    const stored = await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
    ])
    if (!stored.ok) throw new Error('draft setup failed')
    const nativeSetItem = Storage.prototype.setItem
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('el-bill:bill-entry-draft:')) throw new Error('storage unavailable')
      return nativeSetItem.call(this, key, value)
    })
    renderInput()

    fireEvent.change(screen.getByLabelText('2026-07 사용량(kWh)'), { target: { value: '20' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByText(/초안을 저장하지 못했습니다/)).not.toBeNull()
    expect((screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement).value).toBe('20')
    expect(readBillEntryDraft()?.rows[0].usageKwh).toBe('10')
    setItemSpy.mockRestore()
  })

  it('retains rows and reports a failed reset removal', async () => {
    const user = userEvent.setup()
    await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
    ])
    const nativeRemoveItem = Storage.prototype.removeItem
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key.startsWith('el-bill:bill-entry-draft')) throw new Error('storage unavailable')
      return nativeRemoveItem.call(this, key)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderInput()

    await user.click(screen.getByRole('button', { name: '전체 초기화' }))

    expect(screen.getByText(/초안을 삭제하지 못했습니다/)).not.toBeNull()
    expect(screen.getByLabelText('2026-07 사용량(kWh)')).not.toBeNull()
    expect(readBillEntryDraft()).not.toBeNull()
    removeItemSpy.mockRestore()
  })

  it('cancels a pending write before a confirmed reset removes the draft', async () => {
    vi.useFakeTimers()
    await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderInput()

    fireEvent.change(screen.getByLabelText('2026-07 사용량(kWh)'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '전체 초기화' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(301)
    })

    expect(readBillEntryDraft()).toBeNull()
    expect(screen.queryByLabelText('2026-07 사용량(kWh)')).toBeNull()
  })

  it('keeps the newer stored draft when a revision-safe write becomes stale', async () => {
    vi.useFakeTimers()
    const initial = await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
    ])
    if (!initial.ok) throw new Error('draft setup failed')
    renderInput()
    await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '20', totalBillWon: '100' }),
    ], initial.draft.revision)

    fireEvent.change(screen.getByLabelText('2026-07 사용량(kWh)'), { target: { value: '30' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByText(/초안을 저장하지 못했습니다/)).not.toBeNull()
    expect((screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement).value).toBe('30')
    expect(readBillEntryDraft()?.rows[0].usageKwh).toBe('20')
  })

  it('removes the stored draft after the last row is deleted and stays empty after reload', async () => {
    const user = userEvent.setup()
    await writeBillEntryDraft([
      makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
    ])
    const view = render(
      <ManualBillInput
        importContext={importContext}
        onCandidateChange={() => undefined}
        onOpenGuide={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: '2026-07행 삭제' }))
    await waitFor(() => expect(readBillEntryDraft()).toBeNull())
    view.unmount()
    renderInput()

    expect(screen.queryByLabelText('2026-07 사용량(kWh)')).toBeNull()
  })
})
