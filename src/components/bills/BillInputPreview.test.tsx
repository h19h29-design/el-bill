/* @vitest-environment jsdom */

import { readFile } from 'node:fs/promises'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sampleBills } from '../../data/sampleBills'
import type { MonthlyBill } from '../../types'
import { BillInputPreview } from './BillInputPreview'

const candidateBills: MonthlyBill[] = sampleBills.slice(0, 2)

afterEach(cleanup)

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

  it.each([
    ['empty candidates', [] as MonthlyBill[], true],
    ['period-invalid candidates', [candidateBills[0], { ...candidateBills[0], id: 'duplicate-period' }], true],
    ['candidates without an exact rate-plan context', candidateBills, false],
  ])('blocks analysis for %s', (label, bills, hasExactRatePlan) => {
    render(
      <BillInputPreview
        candidate={{ origin: 'uploaded', bills, sourceLabel: label }}
        currentBills={sampleBills}
        hasExactRatePlan={hasExactRatePlan}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '이 데이터로 분석 시작' })).toHaveProperty('disabled', true)
  })

  it('allows a gapped bill set to be saved for an additional-review diagnosis', () => {
    render(
      <BillInputPreview
        candidate={{
          origin: 'uploaded',
          bills: [sampleBills[0], sampleBills[2]],
          sourceLabel: 'incomplete-bills.pdf',
        }}
        currentBills={sampleBills}
        hasExactRatePlan
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText(/청구월이 누락되었습니다/)).toBeTruthy()
    expect(screen.getByText(/요금제 추천과 문서 생성은 보류/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '이 데이터로 분석 시작' }),
    ).toHaveProperty('disabled', false)
  })

  it('uses auto-fit summary tracks so a 901px viewport cannot require five fixed columns', async () => {
    const styles = await readFile('src/styles.css', 'utf8')

    expect(styles).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));',
    )
  })
})
