/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import type { BillImportContext } from '../../types'
import { PastedBillInput } from './PastedBillInput'

afterEach(cleanup)

const importContext: BillImportContext = {
  appliedPowerKw: 497,
  currentPlan: defaultRatePlans[0],
}

const renderInput = () => {
  const onCandidateChange = vi.fn()
  const onOpenGuide = vi.fn()
  render(
    <PastedBillInput
      importContext={importContext}
      onCandidateChange={onCandidateChange}
      onOpenGuide={onOpenGuide}
    />,
  )
  return { onCandidateChange, onOpenGuide }
}

describe('PastedBillInput', () => {
  it('recognizes a copied spreadsheet table and emits a pasted candidate', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste(
      '연도\t월\t사용량(kWh)\t총 전기요금(원)\n2026\t7\t48365\t7138790',
    )
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))

    expect(screen.getByText('1개월을 인식했습니다.')).not.toBeNull()
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: 'pasted' }),
    )
  })

  it('retains pasted text when parsing is rejected by the input limit', async () => {
    const user = userEvent.setup()
    renderInput()
    const text = 'x'.repeat(200_001)
    const textarea = screen.getByLabelText('붙여넣을 표')

    fireEvent.change(textarea, { target: { value: text } })
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))

    expect((textarea as HTMLTextAreaElement).value).toBe(text)
    expect(screen.getByText(/200,000자 이하/)).not.toBeNull()
  })

  it('invalidates a checked candidate when the pasted text changes', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()
    const textarea = screen.getByLabelText('붙여넣을 표')

    await user.click(textarea)
    await user.paste('연도\t월\t사용량(kWh)\t총 전기요금(원)\n2026\t7\t48365\t7138790')
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))
    await user.type(textarea, '\ninvalid')

    expect(onCandidateChange).toHaveBeenLastCalledWith(null)
  })

  it('opens column mapping controls when required headers are missing', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste('A\tB\tC\tD\n2026\t7\t48365\t7138790')
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))

    expect(screen.getByRole('heading', { name: '컬럼 매핑' })).not.toBeNull()
    expect(screen.getByLabelText('연도')).not.toBeNull()
    expect(screen.getByLabelText('총 전기요금')).not.toBeNull()
  })

  it('does not infer a total bill from a distinct generic total-usage column', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste(
      '연도\t월\t사용량(kWh)\t총사용량\n2026\t7\t48365\t7138790',
    )
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))

    expect(screen.getByRole('heading', { name: '컬럼 매핑' })).not.toBeNull()
    expect((screen.getByLabelText('총 전기요금') as HTMLSelectElement).value).toBe('')
    expect(onCandidateChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText('1개월을 인식했습니다.')).toBeNull()
  })

  it.each([
    ['연도\t월\t사용량(kWh)\t총 전기요금(원)', '기본 표기'],
    ['년도\t월분\t전력사용량(kWh)\t청구금액(원)', '인식된 동의어'],
  ])('accepts %s as %s automatic required mappings', async (headers) => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste(`${headers}\n2026\t7\t48365\t7138790`)
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))

    expect(screen.getByText('1개월을 인식했습니다.')).not.toBeNull()
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: 'pasted' }),
    )
  })

  it('accepts an explicit distinct user mapping for an uncertain required header', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste('연도\t월\t사용량(kWh)\t합계\n2026\t7\t48365\t7138790')
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))
    await user.selectOptions(screen.getByLabelText('총 전기요금'), '합계')

    expect(screen.getByText('1개월을 인식했습니다.')).not.toBeNull()
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: 'pasted' }),
    )
  })

  it('blocks ambiguous required-header inference until distinct columns are chosen', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste(
      '연도\t월\t총사용량\t총 전기요금(원)\n2026\t7\t48365\t7138790',
    )
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))

    expect(screen.getByRole('heading', { name: '컬럼 매핑' })).not.toBeNull()
    expect(onCandidateChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText('1개월을 인식했습니다.')).toBeNull()
  })

  it('emits a candidate after explicit distinct mappings resolve an ambiguous header', async () => {
    const user = userEvent.setup()
    const { onCandidateChange } = renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste(
      '연도\t월\t총사용량\t총 전기요금(원)\n2026\t7\t48365\t7138790',
    )
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))
    await user.selectOptions(screen.getByLabelText('사용량'), '총사용량')
    await user.selectOptions(screen.getByLabelText('총 전기요금'), '총 전기요금(원)')

    expect(screen.getByText('1개월을 인식했습니다.')).not.toBeNull()
    expect(screen.queryByText('필수 항목은 서로 다른 컬럼으로 지정해 주세요.')).toBeNull()
    expect(onCandidateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: 'pasted' }),
    )
  })

  it('shows a bounded accessible sample of recognized row values', async () => {
    const user = userEvent.setup()
    renderInput()

    await user.click(screen.getByLabelText('붙여넣을 표'))
    await user.paste(
      '연도\t월\t사용량(kWh)\t총 전기요금(원)\n2026\t7\t48365\t7138790\n2026\t6\t42000\t6500000',
    )
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))

    const preview = screen.getByRole('table', { name: '붙여넣기 행 미리보기' })
    expect(preview.textContent).toContain('48365')
    expect(preview.textContent).toContain('7138790')
    expect(screen.getByRole('columnheader', { name: '총 전기요금(원)' })).not.toBeNull()
  })
})
