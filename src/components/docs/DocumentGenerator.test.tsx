/* @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { defaultRatePlans } from '../../data/ratePlans'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { buildPeakOperationPlan } from '../../lib/peakOperations'
import { DocumentGenerator } from './DocumentGenerator'

describe('document generation eligibility', () => {
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
})
