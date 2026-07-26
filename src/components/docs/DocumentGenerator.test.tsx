/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultCalculationSettings } from '../../lib/calculationSettings'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { getDocumentFileNames, sanitizeDownloadStem } from '../../lib/downloadNames'
import { buildPeakOperationPlan } from '../../lib/peakOperations'
import { DocumentGenerator } from './DocumentGenerator'

afterEach(cleanup)

describe('document generation eligibility', () => {
  it('sanitizes the configured display name for ZIP downloads', () => {
    expect(sanitizeDownloadStem(' 테스트/고등학교: 2026 ')).toBe('테스트 고등학교 2026')
    expect(sanitizeDownloadStem(' /\\:*?"<>| ')).toBe('학교')
    expect(sanitizeDownloadStem('../CON')).toBe('학교')
  })

  it('custom display name reaches preview and ZIP filename', () => {
    expect(getDocumentFileNames('테스트/고등학교: 2026').zip).toBe(
      '테스트 고등학교 2026_전기요금_변경_문서묶음.zip',
    )
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: { ...defaultSchoolProfile, displaySchoolName: '테스트고등학교' },
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    const { container } = render(
      <DocumentGenerator
        profile={{ ...defaultSchoolProfile, displaySchoolName: '테스트고등학교' }}
        latestBill={sampleBills.at(-1)}
        comparison={diagnosis.comparison}
        scenario={defaultScenario}
        diagnosis={diagnosis}
        peakOperationPlan={buildPeakOperationPlan(defaultScenario)}
      />,
    )

    expect(within(container).getAllByText('테스트고등학교')).toHaveLength(3)
  })

  it('keeps reserved filename characters in visible document identity only', () => {
    const displaySchoolName = '테스트/고등학교: 2026'
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: { ...defaultSchoolProfile, displaySchoolName },
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })
    const { container } = render(
      <DocumentGenerator
        profile={{ ...defaultSchoolProfile, displaySchoolName }}
        latestBill={sampleBills.at(-1)}
        comparison={diagnosis.comparison}
        scenario={defaultScenario}
        diagnosis={diagnosis}
        peakOperationPlan={buildPeakOperationPlan(defaultScenario)}
      />,
    )

    expect(within(container).getAllByText(displaySchoolName)).toHaveLength(3)
    expect(getDocumentFileNames(displaySchoolName).planPdf).toBe(
      '테스트 고등학교 2026_전기요금제_변경계획안.pdf',
    )
  })

  it('disables change-application exports when diagnosis does not recommend a change', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })
    const blockedDiagnosis = {
      ...diagnosis,
      finalJudgement: '유지 추천' as const,
      canGenerateChangeDocuments: false,
      documentBlockReason:
        '최종 판단이 변경 추천인 경우에만 변경신청 문서를 생성할 수 있습니다.',
      availableDocumentCount: 2,
    }

    render(
      <DocumentGenerator
        profile={defaultSchoolProfile}
        latestBill={sampleBills.at(-1)}
        comparison={blockedDiagnosis.comparison}
        scenario={defaultScenario}
        diagnosis={blockedDiagnosis}
        peakOperationPlan={buildPeakOperationPlan(defaultScenario)}
      />,
    )

    expect(screen.getByText(blockedDiagnosis.documentBlockReason)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '전체 다운로드 (ZIP)' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getAllByRole('button', { name: '다운로드' })
        .every((button) => button.hasAttribute('disabled')),
    ).toBe(true)
    expect(
      screen.getByText(/한전 공식 신청서가 아닌 작성 참고용 미리보기입니다/),
    ).toBeTruthy()
  })

  it('does not construct a plausible change-document preview when periods require review', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: [...sampleBills, { ...sampleBills.at(-1)!, id: 'duplicate-period' }],
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
      billsAreUserUploaded: true,
    })

    render(
      <DocumentGenerator
        profile={defaultSchoolProfile}
        latestBill={sampleBills.at(-1)}
        comparison={diagnosis.comparison}
        scenario={defaultScenario}
        diagnosis={diagnosis}
        peakOperationPlan={buildPeakOperationPlan(defaultScenario)}
      />,
    )

    expect(screen.getByText(/고지서 기간 문제/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'PDF 미리보기' })).toBeNull()
    expect(screen.queryByText('추천 요금제')).toBeNull()
  })

  it('does not construct previews or document actions without an exact active plan', () => {
    const configurationDiagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: { ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' },
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    const { container } = render(
      <DocumentGenerator
        profile={{ ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' }}
        latestBill={sampleBills.at(-1)}
        comparison={configurationDiagnosis.comparison}
        scenario={defaultScenario}
        diagnosis={configurationDiagnosis}
        peakOperationPlan={buildPeakOperationPlan(defaultScenario)}
      />,
    )

    const view = within(container)
    expect(view.getByText(configurationDiagnosis.documentBlockReason)).toBeTruthy()
    expect(view.queryByRole('button', { name: 'PDF 미리보기' })).toBeNull()
    expect(view.queryByRole('button', { name: '전체 다운로드 (ZIP)' })).toBeNull()
    expect(view.queryByText('예산절감을 위한 전기요금제 변경 계획(안)')).toBeNull()
    expect(view.queryByText('추천 요금제')).toBeNull()
  })

  it('does not construct a document preview with fewer than 12 consecutive months', () => {
    const bills = sampleBills.slice(-11)
    const diagnosis = buildAutoDiagnosis({
      bills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
      calculationSettings: defaultCalculationSettings,
    })

    render(
      <DocumentGenerator
        profile={defaultSchoolProfile}
        latestBill={bills.at(-1)}
        comparison={diagnosis.comparison}
        scenario={defaultScenario}
        diagnosis={diagnosis}
        peakOperationPlan={buildPeakOperationPlan(defaultScenario)}
      />,
    )

    expect(screen.getByText('변경신청 문서 생성 보류')).toBeTruthy()
    expect(screen.getByText(/최근 12개월/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'PDF 미리보기' })).toBeNull()
    expect(screen.queryByText('추천 요금제')).toBeNull()
  })
})
