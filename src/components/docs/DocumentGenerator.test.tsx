/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { defaultRatePlans } from '../../data/ratePlans'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { sanitizeDownloadStem } from '../../lib/downloadNames'
import { buildPeakOperationPlan } from '../../lib/peakOperations'
import { DocumentGenerator } from './DocumentGenerator'

afterEach(cleanup)

describe('document generation eligibility', () => {
  it('sanitizes the configured display name for ZIP downloads', () => {
    expect(sanitizeDownloadStem(' 테스트/고등학교: 2026 ')).toBe('테스트 고등학교 2026')
    expect(sanitizeDownloadStem(' /\\:*?"<>| ')).toBe('학교')
  })

  it('uses the configured display name in the document masthead', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: { ...defaultSchoolProfile, displaySchoolName: '테스트고등학교' },
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
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

    expect(within(container).getAllByText('테스트고등학교').length).toBeGreaterThan(0)
  })

  it('disables change-application exports when diagnosis does not recommend a change', () => {
    const diagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: defaultSchoolProfile,
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
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

  it('does not construct previews or document actions without an exact active plan', () => {
    const configurationDiagnosis = buildAutoDiagnosis({
      bills: sampleBills,
      profile: { ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' },
      ratePlans: defaultRatePlans,
      scenario: defaultScenario,
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
})
