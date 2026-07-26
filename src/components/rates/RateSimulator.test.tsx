/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      calculationSettings: defaultCalculationSettings,
})

afterEach(cleanup)

describe('rate simulator usability harness', () => {
  it('emits a scenario patch without copying stale peak operation fields', async () => {
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
      expect(onScenarioChange).toHaveBeenCalledWith({
        type: 'patch',
        patch: {
          expectedPeakKw: 650,
        },
      }),
    )
  })

  it.each([
    ['예상 최대수요전력(kW)', '0'],
    ['사용량 증가율(%)', '101'],
    ['분석 기준 연도', '2036'],
    ['분석 기준 연도', '2025.5'],
  ])('shows accessible validation and does not persist invalid %s', async (label, value) => {
    const onScenarioChange = vi.fn(async () => true)
    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={diagnosis.comparison}
        calculationSettings={defaultCalculationSettings}
        scenario={defaultScenario}
        onScenarioChange={onScenarioChange}
      />,
    )

    const input = screen.getByLabelText(label)
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '시뮬레이션 설정' }))

    expect(onScenarioChange).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(input.getAttribute('aria-invalid')).toBe('true'),
    )
    expect(screen.getByRole('status').textContent).toContain('입력')
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
      annualDataAvailable: true,
      currentThreeYearWon: 30,
      candidateThreeYearWon: 15,
      threeYearSavingWon: 15,
      threeYearDataAvailable: true,
      fiveYearSavingWon: 25,
      peakScenarioCurrentAnnualWon: 10,
      peakScenarioCandidateAnnualWon: 5,
      peakScenarioSavingWon: 5,
      peakScenarioDataAvailable: true,
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

  it('switches between annual, actual three-year, and peak-scenario totals', () => {
    const comparison: PlanCandidateComparison = {
      ...diagnosis.comparison,
      currentAnnualWon: 12_000_000,
      candidateAnnualWon: 10_000_000,
      savingWon: 2_000_000,
      currentThreeYearWon: 40_000_000,
      candidateThreeYearWon: 31_000_000,
      threeYearSavingWon: 9_000_000,
      peakScenarioCurrentAnnualWon: 15_000_000,
      peakScenarioCandidateAnnualWon: 12_000_000,
      peakScenarioSavingWon: 3_000_000,
      annualDataAvailable: true,
      threeYearDataAvailable: true,
      peakScenarioDataAvailable: true,
    }

    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={comparison}
        calculationSettings={defaultCalculationSettings}
        scenario={defaultScenario}
        onScenarioChange={async () => true}
      />,
    )

    expect(screen.getByText('12,000,000원')).toBeTruthy()
    expect(screen.getAllByText('2,000,000원')).toHaveLength(2)

    fireEvent.click(screen.getByRole('tab', { name: '최근 3년' }))
    expect(screen.getByText('40,000,000원')).toBeTruthy()
    expect(screen.getByText('9,000,000원')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '피크 예상 시나리오' }))
    expect(screen.getByText('15,000,000원')).toBeTruthy()
    expect(screen.getAllByText('3,000,000원')).toHaveLength(2)
  })

  it('explains when actual consecutive 36-month data is unavailable', () => {
    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={{
          ...diagnosis.comparison,
          currentThreeYearWon: 0,
          candidateThreeYearWon: 0,
          threeYearSavingWon: 0,
          threeYearDataAvailable: false,
        }}
        calculationSettings={defaultCalculationSettings}
        scenario={defaultScenario}
        onScenarioChange={async () => true}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: '최근 3년' }))
    expect(
      screen.getByText('최근 36개월의 연속된 고지서 자료가 부족합니다.'),
    ).toBeTruthy()
  })

  it('uses accessible tab semantics and associates the selected panel', () => {
    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={diagnosis.comparison}
        calculationSettings={defaultCalculationSettings}
        scenario={defaultScenario}
        onScenarioChange={async () => true}
      />,
    )

    const tablist = screen.getByRole('tablist', { name: '요금 비교 범위' })
    const annualTab = screen.getByRole('tab', { name: '최근 12개월' })
    const threeYearTab = screen.getByRole('tab', { name: '최근 3년' })

    expect(tablist.contains(annualTab)).toBe(true)
    expect(annualTab.getAttribute('aria-selected')).toBe('true')
    expect(threeYearTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      annualTab.id,
    )

    fireEvent.click(threeYearTab)

    expect(annualTab.getAttribute('aria-selected')).toBe('false')
    expect(threeYearTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      threeYearTab.id,
    )
  })

  it('explains when a valid peak scenario result is unavailable', () => {
    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={{
          ...diagnosis.comparison,
          peakScenarioCurrentAnnualWon: 0,
          peakScenarioCandidateAnnualWon: 0,
          peakScenarioSavingWon: 0,
          peakScenarioDataAvailable: false,
        }}
        calculationSettings={defaultCalculationSettings}
        scenario={{ ...defaultScenario, expectedPeakKw: 0 }}
        onScenarioChange={async () => true}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: '피크 예상 시나리오' }))
    expect(
      screen.getByText(
        '최근 12개월의 연속된 고지서와 유효한 피크 시나리오가 필요합니다.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('0원')).toBeNull()
  })

  it('blocks the simulator when annual diagnosis data is unavailable', () => {
    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={{
          ...diagnosis.comparison,
          annualDataAvailable: false,
          recommendation: '추가 검토 필요',
          basis: '최근 12개월의 연속된 고지서 자료가 부족합니다.',
        }}
        calculationSettings={defaultCalculationSettings}
        scenario={defaultScenario}
        onScenarioChange={async () => true}
      />,
    )

    expect(screen.getByText('요금제 비교 보류')).toBeTruthy()
    expect(screen.getByText(/최근 12개월/)).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText(candidatePlan.planName)).toBeNull()
  })

  it('supports roving focus and wrapped keyboard navigation across tabs', async () => {
    const user = userEvent.setup()
    render(
      <RateSimulator
        currentPlan={currentPlan}
        candidatePlan={candidatePlan}
        candidates={[]}
        comparison={diagnosis.comparison}
        calculationSettings={defaultCalculationSettings}
        scenario={defaultScenario}
        onScenarioChange={async () => true}
      />,
    )

    const annualTab = screen.getByRole('tab', { name: '최근 12개월' })
    const threeYearTab = screen.getByRole('tab', { name: '최근 3년' })
    const peakTab = screen.getByRole('tab', { name: '피크 예상 시나리오' })

    expect(annualTab.tabIndex).toBe(0)
    expect(threeYearTab.tabIndex).toBe(-1)
    expect(peakTab.tabIndex).toBe(-1)

    annualTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(threeYearTab)
    expect(threeYearTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      threeYearTab.id,
    )

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(peakTab)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(annualTab)
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(peakTab)

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(annualTab)
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(peakTab)
    expect(annualTab.tabIndex).toBe(-1)
    expect(peakTab.tabIndex).toBe(0)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      peakTab.id,
    )
  })
})
