/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultScenario, sampleBills } from '../../data/sampleBills'
import type { PeakScenario, PlanCandidateComparison } from '../../types'
import { RateSimulator } from './RateSimulator'

const currentPlan = defaultRatePlans.find((plan) => plan.id === 'edu-a-high-a-2')!
const candidatePlan = defaultRatePlans.find((plan) => plan.id === 'edu-a-high-a-1')!

afterEach(cleanup)

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

  it('does not show a recommended-plan simulation when the active candidate is review-only', () => {
    const reviewOnlyCandidate: PlanCandidateComparison = {
      candidatePlanId: candidatePlan.id,
      candidatePlanName: candidatePlan.planName,
      contractType: candidatePlan.contractType,
      voltageType: candidatePlan.voltageType,
      sameContractPriority: true,
      currentAnnualWon: 10,
      candidateAnnualWon: 5,
      savingWon: 5,
      savingRate: 0.5,
      threeYearSavingWon: 15,
      fiveYearSavingWon: 25,
      peakScenarioSavingWon: 5,
      calculationMode: 'billDelta',
      calculationBreakdown: [],
      recommendation: '추가 검토 필요',
      basis: '고지서 기간 문제: 2026-7 고지서 기간이 중복되었습니다.',
      reviewReason: '고지서 기간 문제: 2026-7 고지서 기간이 중복되었습니다.',
    }

    render(
      <RateSimulator
        bills={sampleBills}
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[reviewOnlyCandidate]}
        scenario={defaultScenario}
        onScenarioChange={() => undefined}
      />,
    )

    expect(screen.getByText(reviewOnlyCandidate.basis)).toBeTruthy()
    expect(screen.queryByText(`추천안 (${candidatePlan.planName})`)).toBeNull()
  })
})
