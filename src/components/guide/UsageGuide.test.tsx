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

  it('replaces the adjacent live status for repeated copy and download actions', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<UsageGuide onOpenBills={onOpenBills} />)

    const actionGroup = screen.getByRole('group', { name: 'GPT 변환 도구' })
    const status = screen.getByRole('status')
    expect(status.previousElementSibling).toBe(actionGroup)

    await user.click(screen.getByRole('button', { name: 'GPT 변환 프롬프트 복사' }))
    expect(writeText).toHaveBeenCalledWith(gptBillConversionPrompt)
    expect(screen.getByRole('status').textContent).toContain('프롬프트를 복사했습니다')
    const firstCopyInvocation = status.firstElementChild?.getAttribute('data-invocation-id')

    await user.click(screen.getByRole('button', { name: 'GPT 변환 프롬프트 복사' }))
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(status.firstElementChild?.getAttribute('data-invocation-id')).not.toBe(firstCopyInvocation)

    await user.click(screen.getByRole('button', { name: '표준 CSV 양식 다운로드' }))
    expect(screen.getByRole('status').textContent).toContain('다운로드를 시작했습니다')
    const firstDownloadInvocation = status.firstElementChild?.getAttribute('data-invocation-id')

    await user.click(screen.getByRole('button', { name: '표준 CSV 양식 다운로드' }))
    expect(status.firstElementChild?.getAttribute('data-invocation-id')).not.toBe(firstDownloadInvocation)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenLastCalledWith('blob:standard-csv')
  })

  it('reports clipboard failure without announcing a successful copy', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('permission denied', 'NotAllowedError'),
    )
    render(<UsageGuide onOpenBills={onOpenBills} />)

    await user.click(screen.getByRole('button', {
      name: 'GPT 변환 프롬프트 복사',
    }))

    expect(screen.getByRole('status').textContent).toContain(
      '프롬프트를 복사하지 못했습니다',
    )
    expect(screen.getByRole('status').textContent).not.toContain(
      '프롬프트를 복사했습니다',
    )
  })

  it('revokes the CSV object URL when the synthetic download click throws', async () => {
    const user = userEvent.setup()
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
      throw new Error('synthetic click failed')
    })
    render(<UsageGuide onOpenBills={onOpenBills} />)

    await user.click(screen.getByRole('button', {
      name: '표준 CSV 양식 다운로드',
    }))

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:standard-csv')
    expect(screen.getByRole('status').textContent).toContain(
      'CSV 양식을 만들지 못했습니다',
    )
    expect(screen.getByRole('status').textContent).not.toContain(
      '다운로드를 시작했습니다',
    )
  })

  it('uses one guide page heading and section headings beneath it', () => {
    render(<UsageGuide onOpenBills={onOpenBills} />)

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByRole('heading', { name: '사용 방법 안내', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'GPT로 CSV 변환', level: 3 })).toBeTruthy()
  })

  it('covers every input, analysis, security, and caution topic', () => {
    render(<UsageGuide onOpenBills={onOpenBills} />)

    expect(screen.getByRole('heading', { name: '파일을 그대로 올리기', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '표 복사·붙여넣기', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '최근 12개월 직접 입력', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'GPT로 CSV 변환', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '파워플래너에서 자료 내려받기', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '자동진단 결과 확인', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '피크관리 방안 확인', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '변경신청 문서 생성', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '데이터 보안과 24시간 삭제', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '요금제 변경 신중 검토', level: 3 })).toBeTruthy()
    expect(screen.getAllByText(/개인 사용자는 공식 API 자동연동을 기본 제공받지 않으며/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/내부 진단용 추정/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1년에 한 번만 가능/).length).toBeGreaterThan(0)
  })

  it('focuses and scrolls to a requested guide section', async () => {
    render(<UsageGuide onOpenBills={onOpenBills} requestedSectionId="gpt-csv" />)

    const heading = screen.getByRole('heading', { name: 'GPT로 CSV 변환', level: 3 })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(scrollIntoView).toHaveBeenCalled()
    expect((screen.getByLabelText('안내 항목 선택') as HTMLSelectElement).value).toBe('gpt-csv')
  })

  it('synchronizes desktop, external, and mobile section navigation with repeatable moves', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<UsageGuide onOpenBills={onOpenBills} requestedSectionId="file-upload" />)
    const select = screen.getByLabelText('안내 항목 선택') as HTMLSelectElement

    await user.click(screen.getByRole('link', { name: 'GPT로 CSV 변환' }))
    expect(select.value).toBe('gpt-csv')

    rerender(<UsageGuide onOpenBills={onOpenBills} requestedSectionId="peak" />)
    await waitFor(() => expect(select.value).toBe('peak'))

    await user.selectOptions(select, 'security')
    expect(select.value).toBe('security')
    const scrollCountBeforeMove = scrollIntoView.mock.calls.length

    await user.click(screen.getByRole('button', { name: '이동' }))
    expect(scrollIntoView.mock.calls.length).toBe(scrollCountBeforeMove + 1)
    await user.click(screen.getByRole('button', { name: '이동' }))
    expect(scrollIntoView.mock.calls.length).toBe(scrollCountBeforeMove + 2)
  })
})
