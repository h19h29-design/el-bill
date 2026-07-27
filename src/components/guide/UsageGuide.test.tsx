/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gptBillConversionPrompt } from '../../content/usageGuide'
import { UsageGuide } from './UsageGuide'

describe('UsageGuide', () => {
  const onOpenBills = vi.fn()
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    onOpenBills.mockReset()
    scrollIntoView.mockReset()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:standard-csv'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('copies the approved prompt and starts the standard CSV download with status feedback', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<UsageGuide onOpenBills={onOpenBills} />)

    expect(screen.getByRole('heading', { name: '사용 방법 안내' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'GPT 변환 프롬프트 복사' }))
    expect(writeText).toHaveBeenCalledWith(gptBillConversionPrompt)
    expect(screen.getByRole('status').textContent).toContain('프롬프트를 복사했습니다')

    await user.click(screen.getByRole('button', { name: '표준 CSV 양식 다운로드' }))
    expect(screen.getByRole('status').textContent).toContain('다운로드를 시작했습니다')
  })

  it('covers every input, analysis, security, and caution topic', () => {
    render(<UsageGuide onOpenBills={onOpenBills} />)

    expect(screen.getByRole('heading', { name: '파일을 그대로 올리기' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '표 복사·붙여넣기' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '최근 12개월 직접 입력' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'GPT로 CSV 변환' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '파워플래너에서 자료 내려받기' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '자동진단 결과 확인' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '피크관리 방안 확인' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '변경신청 문서 생성' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '데이터 보안과 24시간 삭제' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '요금제 변경 신중 검토' })).toBeTruthy()
    expect(screen.getAllByText(/개인 사용자는 공식 API 자동연동을 기본 제공받지 않으며/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/내부 진단용 추정/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1년에 한 번만 가능/).length).toBeGreaterThan(0)
  })

  it('focuses and scrolls to a requested guide section', async () => {
    render(<UsageGuide onOpenBills={onOpenBills} requestedSectionId="gpt-csv" />)

    const heading = screen.getByRole('heading', { name: 'GPT로 CSV 변환' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('provides desktop section links and a mobile section selector', async () => {
    const user = userEvent.setup()
    render(<UsageGuide onOpenBills={onOpenBills} />)

    await user.click(screen.getByRole('link', { name: 'GPT로 CSV 변환' }))
    expect(scrollIntoView).toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('안내 항목 선택'), 'security')
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
