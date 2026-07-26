/* @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { BillUpload } from './BillUpload'

describe('bill upload tariff configuration', () => {
  it('shows configuration guidance instead of selecting a fallback rate plan', () => {
    render(
      <BillUpload
        bills={sampleBills}
        profile={{ ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' }}
        ratePlans={defaultRatePlans}
        onBillsChange={() => undefined}
      />,
    )

    expect(screen.getByText(/현재 프로필과 정확히 일치하는 요금제가 없습니다/)).toBeTruthy()
    expect(screen.getByText(/계약종별, 수전전압, 현재 요금제를 일치시켜야/)).toBeTruthy()
  })
})
