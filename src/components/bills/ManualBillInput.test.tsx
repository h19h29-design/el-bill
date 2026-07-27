/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { writeBillEntryDraft } from '../../lib/billDraftStorage'
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

  it('formats numeric cell display values after editing without changing the shared candidate path', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.clear(screen.getByLabelText('마지막 청구월'))
    await user.type(screen.getByLabelText('마지막 청구월'), '2026-07')
    await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
    const usage = screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement
    await user.type(usage, '48365')
    await user.tab()

    expect(usage.value).toBe('48,365')
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
    const usage = screen.getByLabelText('2026-07 사용량(kWh)')
    await user.click(usage)
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}')

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

    expect((screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement).value).toBe('48,365 kWh')
    expect(screen.getByText(/이전 입력 초안을 복원했습니다/)).not.toBeNull()
  })
})
