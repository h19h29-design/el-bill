/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { AutoDiagnosis } from './AutoDiagnosis'

afterEach(cleanup)

describe('automatic diagnosis period integrity', () => {
  it.each([
    {
      label: 'duplicate period',
      bills: [
        ...sampleBills,
        { ...sampleBills.at(-1)!, id: 'duplicate-latest-period' },
      ],
      issue: '중복되었습니다',
    },
    {
      label: 'gapped period',
      bills: sampleBills.filter((bill) => !(bill.year === 2024 && bill.month === 1)),
      issue: '누락되었습니다',
    },
  ])('shows additional review for a $label despite a valid recent twelve-month run', ({ bills, issue }) => {
    const diagnosis = buildAutoDiagnosis({
      bills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      billsAreUserUploaded: true,
    })

    render(
      <AutoDiagnosis
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'uploaded', powerPlanner: 'none' }}
        onNavigate={() => undefined}
      />,
    )

    expect(screen.getAllByText('추가 검토 필요').length).toBeGreaterThan(0)
    expect(screen.getByText('추가 자료 필요')).toBeTruthy()
    expect(
      screen.getAllByText(new RegExp(`고지서 기간 문제: .*${issue}`)).length,
    ).toBeGreaterThan(0)
  })
})
