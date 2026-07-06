/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultScenario, sampleBills } from '../../data/sampleBills'
import type { PeakScenario } from '../../types'
import { RateSimulator } from './RateSimulator'

const currentPlan = defaultRatePlans.find((plan) => plan.id === 'edu-a-high-a-2')!
const candidatePlan = defaultRatePlans.find((plan) => plan.id === 'edu-a-high-a-1')!

describe('rate simulator usability harness', () => {
  it('preserves peak operation fields when saving scenario settings', async () => {
    const scenario: PeakScenario = {
      ...defaultScenario,
      mainBuildingEhpGroups: 8,
      annexEhpGroups: 3,
      auditoriumCooling: false,
      cafeteriaHighPowerTime: '10:30~12:30',
      specialRoomTime: '15:00~16:00',
      exemptSpaces: '보건실, 서버실',
    }
    const onScenarioChange = vi.fn()

    render(
      <RateSimulator
        bills={sampleBills}
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        scenario={scenario}
        onScenarioChange={onScenarioChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('예상 최대수요전력(kW)'), {
      target: { value: '650' },
    })
    fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 설정' }))

    await waitFor(() =>
      expect(onScenarioChange).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedPeakKw: 650,
          mainBuildingEhpGroups: 8,
          annexEhpGroups: 3,
          auditoriumCooling: false,
          cafeteriaHighPowerTime: '10:30~12:30',
          specialRoomTime: '15:00~16:00',
          exemptSpaces: '보건실, 서버실',
        }),
      ),
    )
  })
})
