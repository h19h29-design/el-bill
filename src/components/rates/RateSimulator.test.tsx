/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultScenario, sampleBills } from '../../data/sampleBills'
import type { PeakScenario, PlanCandidateComparison } from '../../types'
import { defaultCalculationSettings } from '../../lib/calculationSettings'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { defaultSchoolProfile } from '../../data/sampleBills'
import { RateSimulator } from './RateSimulator'

const currentPlan = defaultRatePlans.find((plan) => plan.id === 'edu-a-high-a-2')!
const candidatePlan = defaultRatePlans.find((plan) => plan.id === 'edu-a-high-a-1')!
const diagnosis = buildAutoDiagnosis({
  bills: sampleBills,
  profile: defaultSchoolProfile,
  ratePlans: defaultRatePlans,
  scenario: defaultScenario,
})

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
    const onScenarioChange = vi.fn(async () => true)

    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={diagnosis.comparison}
        calculationSettings={defaultCalculationSettings}
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
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[reviewOnlyCandidate]}
        comparison={reviewOnlyCandidate}
        calculationSettings={defaultCalculationSettings}
        scenario={defaultScenario}
        onScenarioChange={async () => true}
      />,
    )

    expect(screen.getByText(reviewOnlyCandidate.basis)).toBeTruthy()
    expect(screen.queryByText(`추천안 (${candidatePlan.planName})`)).toBeNull()
  })

  it('shows the calculation mode used by the diagnosis comparison', () => {
    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={{
          ...diagnosis.comparison,
          calculationMode: 'tariffFull',
        }}
        calculationSettings={{
          ...defaultCalculationSettings,
          mode: 'tariffFull',
        }}
        scenario={defaultScenario}
        onScenarioChange={async () => true}
      />,
    )

    expect(screen.getByText('계산 모드: 요금표 기반 전체 추정')).toBeTruthy()
  })
})
