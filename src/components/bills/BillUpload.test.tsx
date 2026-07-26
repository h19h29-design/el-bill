/* @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { BillUpload } from './BillUpload'

describe('bill upload tariff configuration', () => {
  it('shows configuration guidance and blocks analysis without an exact plan', async () => {
    const { container } = render(
      <BillUpload
        bills={sampleBills}
        profile={{ ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' }}
        ratePlans={defaultRatePlans}
        onBillsChange={() => undefined}
      />,
    )

    expect(screen.getByText(/현재 프로필과 정확히 일치하는 요금제가 없습니다/)).toBeTruthy()
    expect(screen.getByText(/계약종별, 수전전압, 현재 요금제를 일치시켜야/)).toBeTruthy()

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
            'billing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    const startButton = await screen.findByRole('button', { name: '이 매핑으로 분석 시작' })
    expect(startButton).toHaveProperty('disabled', true)
  })

  it('does not apply manually mapped bills without an exact plan', async () => {
    const onBillsChange = vi.fn()
    const { container } = render(
      <BillUpload
        bills={sampleBills}
        profile={{ ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' }}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
      />,
    )

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
            'billing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: '수동 매핑 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '선택 시트 적용' }))

    expect(onBillsChange).not.toHaveBeenCalled()
    expect(
      screen.getByText(/현재 요금제가 설정과 정확히 일치하지 않아 분석을 시작할 수 없습니다/),
    ).toBeTruthy()
  })
})
