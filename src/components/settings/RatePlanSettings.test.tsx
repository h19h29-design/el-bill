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
        ...defaultCalculationSettings,
        mode: 'tariffFull',
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

    fireEvent.change(screen.getByLabelText('기후환경요금 단가'), {
      target: { value: '101' },
    })
    expect(screen.getByRole('status').textContent).toContain('0~100원/kWh')

    fireEvent.change(screen.getByLabelText('연료비조정 단가'), {
      target: { value: '-4' },
    })
    await waitFor(() =>
      expect(onCalculationSettingsChange).toHaveBeenCalledWith({
        ...tariffSettings,
        fuelAdjustmentWonPerKwh: -4,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '계산 설정 초기화' }))
    await waitFor(() =>
      expect(onCalculationSettingsChange).toHaveBeenCalledWith(
        defaultCalculationSettings,
      ),
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

    fireEvent.change(screen.getByLabelText('부가세율'), {
      target: { value: '12' },
    })

    await waitFor(() =>
      expect(onCalculationSettingsChange).toHaveBeenCalled(),
    )
    expect(
      (screen.getByLabelText('부가세율') as HTMLInputElement).value,
    ).toBe('10')
  })
})
