/* @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { defaultRatePlans } from '../../data/ratePlans'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { Dashboard } from './Dashboard'

describe('dashboard diagnosis consistency', () => {
  it('shows the automatic diagnosis savings value in the annual savings KPI', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
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
})
