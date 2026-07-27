/* @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { sampleBills } from '../../data/sampleBills'
import type { MonthlyBill } from '../../types'
import { BillInputPreview } from './BillInputPreview'

const candidateBills: MonthlyBill[] = sampleBills.slice(0, 2)

describe('BillInputPreview', () => {
  it('shows the candidate source, period, observed optional fields, and unapplied state', () => {
    render(
      <BillInputPreview
        candidate={{
          origin: 'uploaded',
          bills: candidateBills,
          sourceLabel: 'billing.xlsx',
        }}
        currentBills={sampleBills}
        hasExactRatePlan
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('billing.xlsx')).toBeTruthy()
    expect(screen.getByText('2건')).toBeTruthy()
    expect(screen.getByText('2023년 8월 ~ 2023년 9월')).toBeTruthy()
    expect(screen.getByLabelText('입력 데이터 요약').textContent).toContain('최대수요전력')
    expect(screen.getByText('아직 적용 전')).toBeTruthy()
    expect(screen.getByRole('button', { name: '이 데이터로 분석 시작' })).toHaveProperty('disabled', false)
  })
})
