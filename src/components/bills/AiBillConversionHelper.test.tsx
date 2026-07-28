/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  externalAiPrivacyWarning,
  gptBillConversionPrompt,
} from '../../content/usageGuide'
import { AiBillConversionHelper } from './AiBillConversionHelper'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AI bill conversion helper', () => {
  it('copies the exact conversion prompt from the bill input screen', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<AiBillConversionHelper onOpenPaste={() => undefined} />)

    await user.click(
      screen.getByRole('button', {
        name: '무료 AI 변환 프롬프트 복사',
      }),
    )

    expect(writeText).toHaveBeenCalledWith(gptBillConversionPrompt)
    expect(
      screen.getByText('무료 AI용 변환 프롬프트를 복사했습니다.'),
    ).toBeTruthy()
  })

  it('downloads the standard CSV and opens the paste workflow', async () => {
    const user = userEvent.setup()
    const onOpenPaste = vi.fn()
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:csv-template')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<AiBillConversionHelper onOpenPaste={onOpenPaste} />)

    await user.click(
      screen.getByRole('button', { name: '표준 CSV 양식 다운로드' }),
    )
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv-template')

    await user.click(
      screen.getByRole('button', { name: 'AI 변환 결과 붙여넣기' }),
    )
    expect(onOpenPaste).toHaveBeenCalledOnce()
  })

  it('shows concrete free-AI steps and the external privacy boundary', () => {
    render(<AiBillConversionHelper onOpenPaste={() => undefined} />)

    expect(
      screen.getByRole('heading', { name: '무료 AI로 고지서 변환' }),
    ).toBeTruthy()
    expect(screen.getByText(/ChatGPT 또는 Gemini 무료 화면/)).toBeTruthy()
    expect(screen.getByText(externalAiPrivacyWarning)).toBeTruthy()
  })
})
