/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultCalculationSettings } from '../../lib/calculationSettings'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { Dashboard } from './Dashboard'

afterEach(cleanup)

describe('dashboard diagnosis consistency', () => {
  it('shows the automatic diagnosis savings value in the annual savings KPI', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })
    const adjustedDiagnosis = {
      ...diagnosis,
      comparison: {
        ...diagnosis.comparison,
        savingWon: 123_456_789,
      },
    }

    render(
      <Dashboard
        bills={sampleBills}
        currentPlan={diagnosis.currentPlan}
        candidatePlan={diagnosis.recommendedPlan}
        scenario={defaultScenario}
        diagnosis={adjustedDiagnosis}
        dataProvenance={{ bills: 'sample', powerPlanner: 'none' }}
        onStartDiagnosis={() => undefined}
      />,
    )

    expect(screen.getByText('123,456,789원')).toBeTruthy()
    expect(screen.getByText('고지서 기반 차액 추정')).toBeTruthy()
  })

  it('shows a period review hold instead of a recommended tariff when billing periods are invalid', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: [...sampleBills, { ...sampleBills.at(-1)!, id: 'duplicate-period' }],
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    render(
      <Dashboard
        bills={sampleBills}
        currentPlan={diagnosis.currentPlan}
        candidatePlan={diagnosis.recommendedPlan}
        scenario={defaultScenario}
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'uploaded', powerPlanner: 'none' }}
        onStartDiagnosis={() => undefined}
      />,
    )

    expect(screen.getByText('요금제 추천 보류')).toBeTruthy()
    expect(screen.getByText(/고지서 기간 문제/)).toBeTruthy()
    expect(screen.queryByText('추천 요금제')).toBeNull()
  })

  it('shows insufficient data instead of zero annual savings before 12 months', () => {
    const bills = sampleBills.slice(-11)
    const diagnosis = buildAutoDiagnosis({
      bills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    render(
      <Dashboard
        bills={bills}
        currentPlan={diagnosis.currentPlan}
        candidatePlan={diagnosis.recommendedPlan}
        scenario={defaultScenario}
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'sample', powerPlanner: 'none' }}
        onStartDiagnosis={() => undefined}
      />,
    )

    const annualCard = screen.getByText('예상 연간 절감액').closest('article')
    expect(annualCard).not.toBeNull()
    expect(annualCard?.textContent).toContain('자료 부족')
    expect(annualCard?.textContent).not.toContain('0원')
  })
})
