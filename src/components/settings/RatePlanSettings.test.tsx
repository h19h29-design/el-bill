/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RatePlan } from '../../types'
import { defaultCalculationSettings } from '../../lib/calculationSettings'
import {
  applyRatePlanIntent,
  type RatePlanIntent,
} from '../../lib/persistedIntents'
import { RatePlanSettings } from './RatePlanSettings'

const plan = (id: string, planName: string): RatePlan => ({
  id,
  contractType: '교육용(갑)',
  voltageType: '고압A',
  planName,
  baseRateWonPerKw: 6_000,
  seasonRates: { springAutumn: 80, summer: 100, winter: 90 },
  effectiveFrom: '2026-01-01',
  memo: '테스트',
})

afterEach(cleanup)

describe('rate-plan settings validation', () => {
  it('emits field intents instead of stale full collections for rapid edits', () => {
    const onPlansChange = vi.fn(async (_intent: RatePlanIntent) => true)
    render(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ')]}
        onPlansChange={onPlansChange}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={vi.fn(async () => true)}
      />,
    )

    fireEvent.change(screen.getByLabelText('기본요금'), {
      target: { value: '6100' },
    })
    fireEvent.change(screen.getByLabelText('여름'), {
      target: { value: '105' },
    })

    expect(onPlansChange).toHaveBeenNthCalledWith(1, {
      type: 'patch',
      planId: 'first',
      patch: { baseRateWonPerKw: 6100 },
    })
    expect(onPlansChange).toHaveBeenNthCalledWith(2, {
      type: 'patch',
      planId: 'first',
      patch: { seasonRates: { summer: 105 } },
    })
  })

  it('shows accessible guidance for an invalid incoming collection', () => {
    render(
      <RatePlanSettings
        plans={[
          plan('duplicate', '선택요금Ⅰ'),
          plan('duplicate', '선택요금Ⅱ'),
        ]}
        onPlansChange={vi.fn(async () => true)}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={vi.fn(async () => true)}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('식별값')
  })

  it('creates collision-proof identifiers when adding plans', async () => {
    const onPlansChange = vi.fn(async (_intent: RatePlanIntent) => true)
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000000',
    )
    const existing = plan(
      'custom-00000000-0000-4000-8000-000000000000',
      '선택요금Ⅰ',
    )
    render(
      <RatePlanSettings
        plans={[existing]}
        onPlansChange={onPlansChange}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={vi.fn(async () => true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '요금제 추가' }))

    await waitFor(() => expect(onPlansChange).toHaveBeenCalledTimes(1))
    const intent = onPlansChange.mock.calls[0][0]
    expect(intent).toEqual({ type: 'add' })
    const nextPlans = applyRatePlanIntent([existing], intent)
    expect(new Set(nextPlans.map((item) => item.id)).size).toBe(
      nextPlans.length,
    )
  })

  it('rejects an edit that duplicates an existing contract-voltage-plan tuple', () => {
    const onPlansChange = vi.fn(async () => true)
    render(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ'), plan('second', '선택요금Ⅱ')]}
        onPlansChange={onPlansChange}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={vi.fn(async () => true)}
      />,
    )

    fireEvent.change(screen.getAllByLabelText('요금제명')[1], {
      target: { value: '선택요금Ⅰ' },
    })

    expect(onPlansChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('중복')
  })

  it.each([
    ['기본요금', '0'],
    ['기본요금', '-1'],
    ['봄·가을', '0'],
    ['여름', '-100'],
  ])('rejects an invalid %s rate of %s with accessible guidance', (label, value) => {
    const onPlansChange = vi.fn(async () => true)
    render(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ')]}
        onPlansChange={onPlansChange}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={vi.fn(async () => true)}
      />,
    )

    const input = screen.getByLabelText(label)
    fireEvent.change(input, { target: { value } })

    expect(onPlansChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('0')
  })

  it('selects tariff-full mode, validates factors, and resets defaults', async () => {
    const onCalculationSettingsChange = vi.fn(async () => true)
    const { rerender } = render(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ')]}
        onPlansChange={vi.fn(async () => true)}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={onCalculationSettingsChange}
      />,
    )

    fireEvent.click(
      screen.getByRole('radio', { name: '요금표 기반 전체 추정' }),
    )
    await waitFor(() =>
      expect(onCalculationSettingsChange).toHaveBeenCalledWith({
        type: 'patch',
        patch: { mode: 'tariffFull' },
      }),
    )

    const tariffSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
    }
    rerender(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ')]}
        onPlansChange={vi.fn(async () => true)}
        calculationSettings={tariffSettings}
        onCalculationSettingsChange={onCalculationSettingsChange}
      />,
    )

    const climateInput = screen.getByLabelText(
      '기후환경요금 단가(원/kWh)',
    )
    fireEvent.change(climateInput, {
      target: { value: '101' },
    })
    expect(screen.getByRole('status').textContent).toContain('0~100원/kWh')
    expect(climateInput.getAttribute('aria-invalid')).toBe('true')
    const describedBy = climateInput.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(
      describedBy
        ?.split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' '),
    ).toContain('0~100원/kWh')

    fireEvent.change(screen.getByLabelText('연료비조정 단가(원/kWh)'), {
      target: { value: '-4' },
    })
    await waitFor(() =>
      expect(onCalculationSettingsChange).toHaveBeenCalledWith({
        type: 'patch',
        patch: { fuelAdjustmentWonPerKwh: -4 },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '계산 설정 초기화' }))
    await waitFor(() =>
      expect(onCalculationSettingsChange).toHaveBeenCalledWith({
        type: 'reset',
      }),
    )
  })

  it('keeps the prior controlled value when persistence rejects an edit', async () => {
    const onCalculationSettingsChange = vi.fn(async () => false)
    render(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ')]}
        onPlansChange={vi.fn(async () => true)}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={onCalculationSettingsChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('부가세율(%)'), {
      target: { value: '12' },
    })

    await waitFor(() =>
      expect(onCalculationSettingsChange).toHaveBeenCalled(),
    )
    expect(
      (screen.getByLabelText('부가세율(%)') as HTMLInputElement).value,
    ).toBe('10')
  })

  it('includes units and associated help for every correction factor', () => {
    render(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ')]}
        onPlansChange={vi.fn(async () => true)}
        calculationSettings={defaultCalculationSettings}
        onCalculationSettingsChange={vi.fn(async () => true)}
      />,
    )

    for (const label of [
      '기후환경요금 단가(원/kWh)',
      '연료비조정 단가(원/kWh)',
      '부가세율(%)',
      '전력산업기반기금 비율(%)',
    ]) {
      const input = screen.getByLabelText(label)
      expect(input.getAttribute('aria-invalid')).toBe('false')
      const describedBy = input.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy!)).toBeTruthy()
    }
  })
})
