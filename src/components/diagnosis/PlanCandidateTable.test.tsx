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
    expect(within(row!).getAllByText(/자료 부족/)).toHaveLength(4)
    expect(within(row!).queryByText('0원')).toBeNull()
  })
})
