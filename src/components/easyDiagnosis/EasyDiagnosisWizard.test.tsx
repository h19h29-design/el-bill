/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from '../../data/sampleBills'
import { defaultCalculationSettings } from '../../lib/calculationSettings'
import { buildAutoDiagnosis } from '../../lib/diagnosis'
import { buildEasyDiagnosisDecision } from '../../lib/easyDiagnosis'
import { EasyDiagnosisWizard } from './EasyDiagnosisWizard'

afterEach(cleanup)

const uploadedProvenance = {
  bills: 'uploaded' as const,
  powerPlanner: 'none' as const,
}

const diagnosis = buildAutoDiagnosis({
  bills: sampleBills.slice(-12),
  profile: defaultSchoolProfile,
  ratePlans: defaultRatePlans,
  scenario: defaultScenario,
  calculationSettings: defaultCalculationSettings,
  billsAreUserUploaded: true,
})

const toPasteTable = (count: number) =>
  [
    '연도\t월\t사용량(kWh)\t총 전기요금(원)\t요금적용전력(kW)',
    ...sampleBills.slice(-count).map((bill) =>
      [
        bill.year,
        bill.month,
        bill.usageKwh,
        bill.totalBillWon,
        bill.appliedPowerKw,
      ].join('\t'),
    ),
  ].join('\n')

const renderWizard = (onApply = vi.fn(async () => true)) => {
  render(
    <EasyDiagnosisWizard
      profile={defaultSchoolProfile}
      ratePlans={defaultRatePlans}
      diagnosis={diagnosis}
      dataProvenance={uploadedProvenance}
      onApply={onApply}
      onNavigate={() => undefined}
    />,
  )
  return onApply
}

const openPastedReview = (monthCount: number) => {
  fireEvent.click(screen.getByRole('button', { name: /표 붙여넣기/ }))
  fireEvent.change(screen.getByLabelText('12개월 표 붙여넣기'), {
    target: { value: toPasteTable(monthCount) },
  })
  fireEvent.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))
  fireEvent.click(screen.getByRole('button', { name: '자료 확인으로 이동' }))
}

describe('EasyDiagnosisWizard', () => {
  it('starts with four beginner-friendly input choices and a five-step progress rail', () => {
    renderWizard()

    expect(
      screen.getByRole('heading', { name: '어떤 자료를 가지고 계신가요?' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /고지서 PDF/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /요금 정리표/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /표 붙여넣기/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /직접 입력/ })).toBeTruthy()
    expect(screen.getByLabelText('쉬운 진단 단계').children).toHaveLength(5)
    expect(screen.getByText('연속된 12개월 자료가 있어야 진단할 수 있습니다.')).toBeTruthy()
  })

  it('blocks diagnosis when the pasted data has fewer than 12 consecutive months', () => {
    renderWizard()
    openPastedReview(11)

    expect(screen.getByText('11/12개월')).toBeTruthy()
    expect(screen.getByText(/연속 12개월 자료가 필요합니다/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '계약정보 확인으로 이동' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('walks through 12-month review and profile confirmation to a clear decision', async () => {
    const onApply = renderWizard()
    openPastedReview(12)

    expect(screen.getByText('12/12개월')).toBeTruthy()
    expect(screen.getByText('12개월 자료를 확인했습니다')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: '계약정보 확인으로 이동' }),
    )
    expect(
      screen.getByRole('heading', { name: '계약정보를 확인해 주세요' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '자동 분석 시작' }))

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole('heading', {
        name: buildEasyDiagnosisDecision(diagnosis, uploadedProvenance).command,
      }),
    ).toBeTruthy()
    expect(screen.getByText(/1년에 한 번만 가능/)).toBeTruthy()
    expect(screen.queryByText('요금제 자동 비교 TOP 3')).toBeNull()

    fireEvent.click(screen.getByText('상세 결과 보기'))
    expect(screen.getByText('요금제 자동 비교 TOP 3')).toBeTruthy()
  })

  it('provides exactly twelve simple rows for direct entry', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /직접 입력/ }))

    expect(screen.getAllByLabelText(/연월$/)).toHaveLength(12)
    expect(screen.getAllByLabelText(/사용량$/)).toHaveLength(12)
    expect(screen.getAllByLabelText(/총 전기요금$/)).toHaveLength(12)
  })

  it('accepts twelve complete direct-entry rows without a spreadsheet', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /직접 입력/ }))

    screen.getAllByLabelText(/사용량$/).forEach((input, index) => {
      fireEvent.change(input, { target: { value: String(40_000 + index * 500) } })
    })
    screen.getAllByLabelText(/총 전기요금$/).forEach((input, index) => {
      fireEvent.change(input, { target: { value: String(6_000_000 + index * 100_000) } })
    })
    fireEvent.click(screen.getByRole('button', { name: '직접 입력한 내용 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '자료 확인으로 이동' }))

    expect(screen.getByText('12/12개월')).toBeTruthy()
    expect(screen.getByText('12개월 자료를 확인했습니다')).toBeTruthy()
  })
})
