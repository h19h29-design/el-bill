/* @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RatePlan } from '../../types'
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

describe('rate-plan settings validation', () => {
  it('rejects an edit that duplicates an existing contract-voltage-plan tuple', () => {
    const onPlansChange = vi.fn(async () => true)
    render(
      <RatePlanSettings
        plans={[plan('first', '선택요금Ⅰ'), plan('second', '선택요금Ⅱ')]}
        onPlansChange={onPlansChange}
      />,
    )

    fireEvent.change(screen.getAllByLabelText('요금제명')[1], {
      target: { value: '선택요금Ⅰ' },
    })

    expect(onPlansChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('중복')
  })
})
