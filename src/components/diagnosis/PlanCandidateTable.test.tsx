/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanCandidateComparison } from '../../types'
import { PlanCandidateTable } from './PlanCandidateTable'

afterEach(cleanup)

describe('plan candidate result availability', () => {
  it('labels unavailable annual, three-year, and peak values without zeroes', () => {
    const candidate: PlanCandidateComparison = {
      candidatePlanId: 'candidate',
      candidatePlanName: '후보 요금제',
      contractType: '교육용(갑)',
      voltageType: '고압A',
      sameContractPriority: true,
      currentAnnualWon: 0,
      candidateAnnualWon: 0,
      savingWon: 0,
      savingRate: 0,
      annualDataAvailable: false,
      currentThreeYearWon: 0,
      candidateThreeYearWon: 0,
      threeYearSavingWon: 0,
      threeYearDataAvailable: false,
      fiveYearSavingWon: 0,
      peakScenarioCurrentAnnualWon: 0,
      peakScenarioCandidateAnnualWon: 0,
      peakScenarioSavingWon: 0,
      peakScenarioDataAvailable: false,
      calculationMode: 'billDelta',
      calculationBreakdown: [],
      recommendation: '추가 검토 필요',
      basis: '자료 부족',
      reviewReason: '최근 12개월 자료가 필요합니다.',
    }

    render(<PlanCandidateTable candidates={[candidate]} />)

    const row = screen.getAllByText('후보 요금제')[1].closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row!).getAllByRole('cell')
    expect(cells[1].textContent).toBe('자료 부족')
    expect(cells[2].textContent).toBe('자료 부족')
    expect(cells[3].textContent).toBe('36개월 자료 부족')
    expect(cells[4].textContent).toBe('자료 부족')
    expect(within(row!).queryByText('0원')).toBeNull()
  })

  it('describes cost increases and savings without signed amounts', () => {
    const candidate: PlanCandidateComparison = {
      candidatePlanId: 'candidate',
      candidatePlanName: '선택요금Ⅰ',
      contractType: '교육용(갑)',
      voltageType: '고압A',
      sameContractPriority: true,
      currentAnnualWon: 29_255_630,
      candidateAnnualWon: 33_628_957,
      savingWon: -4_373_327,
      savingRate: -0.1495,
      annualDataAvailable: true,
      currentThreeYearWon: 0,
      candidateThreeYearWon: 0,
      threeYearSavingWon: 0,
      threeYearDataAvailable: false,
      fiveYearSavingWon: -21_866_635,
      peakScenarioCurrentAnnualWon: 64_974_359,
      peakScenarioCandidateAnnualWon: 59_961_841,
      peakScenarioSavingWon: 5_012_518,
      peakScenarioDataAvailable: true,
      calculationMode: 'billDelta',
      calculationBreakdown: [],
      recommendation: '유지 추천',
      basis: '비용 증가',
      reviewReason: '현재 계약 조건과 일치하는 후보입니다.',
    }

    render(<PlanCandidateTable candidates={[candidate]} />)

    const row = screen.getByText('선택요금Ⅰ').closest('tr')
    expect(row).not.toBeNull()
    expect(
      screen.getByRole('columnheader', { name: '변경 시 12개월 영향' }),
    ).toBeTruthy()
    expect(within(row!).getByText('4,373,327원 증가')).toBeTruthy()
    expect(within(row!).getByText('5,012,518원 절감')).toBeTruthy()
    expect(within(row!).getByText('현재 요금제 유지')).toBeTruthy()
    expect(
      within(row!).getByText(
        '선택요금Ⅰ로 바꾸면 최근 12개월 기준 비용이 4,373,327원 증가합니다.',
      ),
    ).toBeTruthy()
    expect(within(row!).queryByText('-4,373,327원')).toBeNull()
  })
})
