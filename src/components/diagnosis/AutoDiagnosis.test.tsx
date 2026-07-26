/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { formatWon } from '../../lib/calculations'
import { defaultCalculationSettings } from '../../lib/calculationSettings'
import { AutoDiagnosis } from './AutoDiagnosis'

afterEach(cleanup)

describe('automatic diagnosis period integrity', () => {
  it('shows separated baseline, actual 36-month, and peak scenario values', () => {
    const calculationSettings = {
      ...defaultCalculationSettings,
      mode: 'tariffFull' as const,
      climateEnvironmentWonPerKwh: 12,
    }
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings,
    })

    render(
      <AutoDiagnosis
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'sample', powerPlanner: 'none' }}
        onNavigate={() => undefined}
      />,
    )

    expect(screen.getAllByText('최근 연속 36개월 절감액')).toHaveLength(2)
    expect(
      screen.getByText(
        `현재 ${formatWon(diagnosis.comparison.currentThreeYearWon)} → 추천 ${formatWon(diagnosis.comparison.candidateThreeYearWon)}`,
      ),
    ).toBeTruthy()
    expect(screen.getAllByText('피크 시나리오 절감액')).toHaveLength(2)
    expect(
      screen.getByText(
        `현재 ${formatWon(diagnosis.comparison.peakScenarioCurrentAnnualWon)} → 추천 ${formatWon(diagnosis.comparison.peakScenarioCandidateAnnualWon)}`,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/기후환경 12원\/kWh/)).toBeTruthy()
  })

  it('does not present a zero three-year value when 36 months are unavailable', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills.slice(-12),
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    render(
      <AutoDiagnosis
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'sample', powerPlanner: 'none' }}
        onNavigate={() => undefined}
      />,
    )

    expect(screen.getAllByText('최근 연속 36개월 절감액')).toHaveLength(2)
    expect(screen.getByText('36개월 연속 자료 부족')).toBeTruthy()
    expect(screen.getAllByText('36개월 자료 부족').length).toBeGreaterThan(0)
  })

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
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    render(
      <AutoDiagnosis
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'uploaded', powerPlanner: 'none' }}
        onNavigate={() => undefined}
      />,
    )

    expect(screen.getByText('자동진단 결과를 확정할 수 없습니다')).toBeTruthy()
    expect(screen.getByText('요금제 추천 및 변경신청 문서 생성 보류')).toBeTruthy()
    expect(
      screen.getAllByText(new RegExp(`고지서 기간 문제: .*${issue}`)).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('추천 요금제')).toBeNull()
  })
})
