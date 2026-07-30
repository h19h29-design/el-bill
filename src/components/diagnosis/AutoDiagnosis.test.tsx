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

    expect(screen.getByText('변경 시 최근 36개월 영향')).toBeTruthy()
    expect(
      screen.getByText(
        `현재 ${formatWon(diagnosis.comparison.currentThreeYearWon)} → 비교 ${formatWon(diagnosis.comparison.candidateThreeYearWon)}`,
      ),
    ).toBeTruthy()
    expect(screen.getByText('피크 가정 시 12개월 영향')).toBeTruthy()
    expect(
      screen.getByText(
        `현재 ${formatWon(diagnosis.comparison.peakScenarioCurrentAnnualWon)} → 비교 ${formatWon(diagnosis.comparison.peakScenarioCandidateAnnualWon)}`,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/기후환경 12원\/kWh/)).toBeTruthy()
  })

  it('shows the pasted bill provenance label', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    render(
      <AutoDiagnosis
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'pasted', powerPlanner: 'none' }}
        onNavigate={() => undefined}
      />,
    )

    expect(document.querySelector('.flow-label')?.textContent).toContain(
      '표 붙여넣기 고지서 분석',
    )
  })

  it('states a maintain decision as an action and explains the conflicting peak assumption', () => {
    const baseDiagnosis = buildAutoDiagnosis({
      bills: sampleBills.slice(-12),
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })
    const comparison = {
      ...baseDiagnosis.comparison,
      currentAnnualWon: 29_255_630,
      candidateAnnualWon: 33_628_957,
      savingWon: -4_373_327,
      savingRate: -0.1495,
      threeYearDataAvailable: false,
      peakScenarioDataAvailable: true,
      peakScenarioCurrentAnnualWon: 64_974_359,
      peakScenarioCandidateAnnualWon: 59_961_841,
      peakScenarioSavingWon: 5_012_518,
      recommendation: '유지 추천' as const,
      basis: '변경 시 최근 12개월 기준 비용 증가가 추정됩니다.',
      calculationBreakdown: [
        {
          label: '기본요금 차액',
          currentWon: 14_141_400,
          candidateWon: 12_321_000,
          differenceWon: 1_820_400,
          note: '요금적용전력을 기준으로 비교합니다.',
        },
        {
          label: '전력량요금 차액',
          currentWon: 14_453_710,
          candidateWon: 15_097_907,
          differenceWon: -644_197,
          note: '월별 사용량을 반영합니다.',
        },
        {
          label: '부가요금/보정',
          currentWon: 660_520,
          candidateWon: 6_210_050,
          differenceWon: -5_549_530,
          note: '기존 고지서 비율로 보정합니다.',
        },
        {
          label: '최근 12개월 합계',
          currentWon: 29_255_630,
          candidateWon: 33_628_957,
          differenceWon: -4_373_327,
          note: '학교 내부 진단용 추정 합계입니다.',
        },
      ],
    }
    const diagnosis = {
      ...baseDiagnosis,
      comparison,
      finalJudgement: '유지 추천' as const,
      judgementBasis: comparison.basis,
      canGenerateChangeDocuments: false,
      availableDocumentCount: 0,
    }

    render(
      <AutoDiagnosis
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'uploaded', powerPlanner: 'none' }}
        onNavigate={() => undefined}
      />,
    )

    expect(
      screen.getByRole('heading', { name: '현재 선택요금Ⅱ를 유지하세요' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: '전기요금 자동진단 결과' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '자료 다시 불러오기' }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /선택요금Ⅰ로 변경하면.*연간 비용이.*4,373,327원.*늘어날/,
      ),
    ).toBeTruthy()
    expect(screen.getByText('비교 대상 요금제')).toBeTruthy()
    expect(screen.getByText('연 4,373,327원 증가')).toBeTruthy()
    expect(
      screen.getByText(/피크 시나리오에서는.*5,012,518원.*가정/),
    ).toBeTruthy()
    expect(screen.queryByText('-4,373,327원')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '변경신청 패키지 생성' }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: '고지서 자료 보완' }),
    ).toBeTruthy()
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

    expect(screen.getByText('변경 시 최근 36개월 영향')).toBeTruthy()
    expect(screen.getByText('36개월 연속 자료 부족')).toBeTruthy()
    expect(screen.getAllByText('36개월 자료 부족').length).toBeGreaterThan(0)
  })

  it('does not present annual or peak zeroes as completed results', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills.slice(-11),
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: { ...defaultScenario, expectedPeakKw: 0 },
      calculationSettings: defaultCalculationSettings,
    })

    render(
      <AutoDiagnosis
        diagnosis={diagnosis}
        dataProvenance={{ bills: 'sample', powerPlanner: 'none' }}
        onNavigate={() => undefined}
      />,
    )

    expect(screen.getByRole('heading', { name: '추가 검토 필요' })).toBeTruthy()
    expect(screen.getByText('요금제 추천 및 변경신청 문서 생성 보류')).toBeTruthy()
    expect(screen.getAllByText(/12개월/).length).toBeGreaterThan(0)
    expect(screen.queryByText('추천 요금제')).toBeNull()
    expect(screen.queryByText(defaultRatePlans[0].planName)).toBeNull()
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

    expect(screen.getByRole('heading', { name: '추가 검토 필요' })).toBeTruthy()
    expect(screen.getByText('요금제 추천 및 변경신청 문서 생성 보류')).toBeTruthy()
    expect(
      screen.getAllByText(new RegExp(`고지서 기간 문제: .*${issue}`)).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('추천 요금제')).toBeNull()
  })
})
