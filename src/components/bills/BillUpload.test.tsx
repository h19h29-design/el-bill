/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import { readBillEntryDraft, writeBillEntryDraft } from '../../lib/billDraftStorage'
import { BillUpload } from './BillUpload'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const makeDraft = (patch: Record<string, string> = {}) => ({
  id: 'saved-manual-row',
  yearMonth: '2026-07',
  usageKwh: '48,365 kWh',
  totalBillWon: '7,138,790원',
  maxDemandKw: '',
  appliedPowerKw: '',
  baseChargeWon: '',
  energyChargeWon: '',
  powerFactorChargeWon: '',
  climateChargeWon: '',
  fuelAdjustmentWon: '',
  vatWon: '',
  fundWon: '',
  note: '',
  ...patch,
})

const draftStorageKeys = () =>
  Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  ).filter((key) => key?.startsWith('el-bill:bill-entry-draft'))

const toArrayBuffer = (buffer: ArrayBuffer | Uint8Array) =>
  buffer instanceof ArrayBuffer
    ? buffer
    : buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer

const createSyntheticWorkbook = async () => {
  const workbook = new ExcelJS.Workbook()
  for (const [year, rows] of [
    [2025, [[11, 31_200, 5_180_000], [12, 47_600, 7_890_000]]],
    [2026, [[1, 49_200, 8_160_000], [2, 45_400, 7_530_000]]],
  ] as const) {
    const sheet = workbook.addWorksheet(`${year} 시연`)
    sheet.addRows([
      ['월분', '사용량(kWh)', `${year}학년도`],
      ...rows,
    ])
  }
  return new File(
    [toArrayBuffer(await workbook.xlsx.writeBuffer())],
    'monthly-bills.xlsx',
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  )
}

describe('bill upload tariff configuration', () => {
  it('mounts personal-entry panels, opens their guide anchors, and removes an applied manual draft', async () => {
    const user = userEvent.setup()
    const onOpenGuide = vi.fn()
    const onBillsChange = vi.fn(async () => true)
    const onAnalysisOpen = vi.fn()
    await writeBillEntryDraft([makeDraft()])

    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onAnalysisOpen={onAnalysisOpen}
        onOpenGuide={onOpenGuide}
      />,
    )

    await user.click(screen.getByRole('button', { name: '도움말' }))
    expect(onOpenGuide).toHaveBeenLastCalledWith('file-upload')

    await user.click(screen.getByRole('tab', { name: '표 붙여넣기' }))
    await user.click(screen.getByRole('button', { name: '입력 안내' }))
    expect(onOpenGuide).toHaveBeenLastCalledWith('paste-input')
    expect(screen.getByLabelText('붙여넣을 표')).not.toBeNull()

    await user.click(screen.getByRole('tab', { name: '직접 입력' }))
    await user.click(screen.getByRole('button', { name: '입력 안내' }))
    expect(onOpenGuide).toHaveBeenLastCalledWith('manual-input')
    await user.click(screen.getByRole('button', { name: '이 데이터로 분석 시작' }))

    await waitFor(() => expect(onBillsChange).toHaveBeenCalledWith(
      expect.any(Array),
      'manual',
    ))
    await waitFor(() => expect(readBillEntryDraft()).toBeNull())
    expect(onAnalysisOpen).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending manual draft write before an apply removes the draft', async () => {
    const user = userEvent.setup()
    const onBillsChange = vi.fn(async () => true)
    await writeBillEntryDraft([makeDraft()])

    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onOpenGuide={() => undefined}
      />,
    )

    await user.click(screen.getByRole('tab', { name: '직접 입력' }))
    const apply = await screen.findByRole('button', { name: '이 데이터로 분석 시작' })
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('2026-07 사용량(kWh)'), { target: { value: '50,000' } })
    fireEvent.click(apply)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onBillsChange).toHaveBeenCalledWith(expect.any(Array), 'manual')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301)
    })

    expect(readBillEntryDraft()).toBeNull()
  })

  it('surfaces a failed manual draft removal after the analysis save succeeds', async () => {
    const user = userEvent.setup()
    const onBillsChange = vi.fn(async () => true)
    const onAnalysisOpen = vi.fn()
    await writeBillEntryDraft([makeDraft()])
    const nativeRemoveItem = Storage.prototype.removeItem
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key.startsWith('el-bill:bill-entry-draft')) throw new Error('storage unavailable')
      return nativeRemoveItem.call(this, key)
    })

    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onAnalysisOpen={onAnalysisOpen}
        onOpenGuide={() => undefined}
      />,
    )

    await user.click(screen.getByRole('tab', { name: '직접 입력' }))
    await user.click(screen.getByRole('button', { name: '이 데이터로 분석 시작' }))

    await waitFor(() => expect(onBillsChange).toHaveBeenCalledWith(expect.any(Array), 'manual'))
    expect(
      screen.getByText(
        /분석 데이터는 저장했지만 입력 초안을 삭제하지 못했습니다.*추가 변경은 화면에만 유지됩니다.*다시 시도하거나.*새로고침/,
      ),
    ).toBeTruthy()
    expect(screen.getByLabelText('2026-07 사용량(kWh)')).toBeTruthy()
    expect(readBillEntryDraft()).not.toBeNull()
    expect(onAnalysisOpen).not.toHaveBeenCalled()
    removeItemSpy.mockRestore()

    await user.click(
      screen.getByRole('button', { name: '이 데이터로 분석 시작' }),
    )
    await waitFor(() => expect(onAnalysisOpen).toHaveBeenCalledTimes(1))
    expect(readBillEntryDraft()).toBeNull()
  })

  it('requires reload after a cross-tab draft conflict blocks apply cleanup', async () => {
    let finishSave: (saved: boolean) => void = () => undefined
    const onBillsChange = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve
        }),
    )
    const onAnalysisOpen = vi.fn()
    const initial = await writeBillEntryDraft([makeDraft()])
    if (!initial.ok) throw new Error('draft setup failed')
    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onAnalysisOpen={onAnalysisOpen}
        onOpenGuide={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: '직접 입력' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: '이 데이터로 분석 시작',
      }),
    )
    await waitFor(() => expect(onBillsChange).toHaveBeenCalledTimes(1))
    const newer = await writeBillEntryDraft([
      makeDraft({ usageKwh: '50,000 kWh' }),
    ], initial.draft.revision)
    if (!newer.ok) throw new Error('newer draft setup failed')
    await act(async () => {
      finishSave(true)
    })

    const previewPanel = screen
      .getByRole('heading', { name: '새 입력 데이터' })
      .closest('section')
    if (!previewPanel) throw new Error('preview panel missing')
    await waitFor(() =>
      expect(previewPanel.querySelector('.status-line')?.textContent).toMatch(
        /다른 탭에서 입력 초안이 변경되었습니다.*새로고침하거나 다시 열어/,
      ),
    )
    expect(previewPanel.textContent).not.toMatch(/다시 시도해 주세요/)
    expect(onAnalysisOpen).not.toHaveBeenCalled()
    expect(readBillEntryDraft()?.rows[0].usageKwh).toBe('50,000 kWh')
  })

  it('retains manual candidate, rows, and draft when the analysis save fails', async () => {
    const user = userEvent.setup()
    const onBillsChange = vi.fn(async () => false)
    await writeBillEntryDraft([makeDraft()])

    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onOpenGuide={() => undefined}
      />,
    )

    await user.click(screen.getByRole('tab', { name: '직접 입력' }))
    await user.click(screen.getByRole('button', { name: '이 데이터로 분석 시작' }))

    await waitFor(() => expect(onBillsChange).toHaveBeenCalledWith(expect.any(Array), 'manual'))
    expect(screen.getByRole('tab', { name: '직접 입력' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '새 입력 데이터' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '이 데이터로 분석 시작' })).toBeTruthy()
    expect(screen.getByLabelText('2026-07 사용량(kWh)')).toBeTruthy()
    expect(readBillEntryDraft()?.rows[0].usageKwh).toBe('48,365 kWh')
    expect(screen.getByText(/브라우저 저장소에 자료를 저장하지 못했습니다/)).toBeTruthy()
  })

  it('preserves edits made while apply persistence is in flight and blocks navigation', async () => {
    let finishSave: (saved: boolean) => void = () => undefined
    const onBillsChange = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve
        }),
    )
    const onAnalysisOpen = vi.fn()
    await writeBillEntryDraft([makeDraft()])
    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onAnalysisOpen={onAnalysisOpen}
        onOpenGuide={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: '직접 입력' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: '이 데이터로 분석 시작',
      }),
    )
    await waitFor(() => expect(onBillsChange).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('2026-07 사용량(kWh)'), {
      target: { value: '51,000' },
    })
    await act(async () => {
      finishSave(true)
    })

    expect(
      await screen.findByText(/적용 중 입력 내용이 변경되어 이동하지 않았습니다/),
    ).toBeTruthy()
    expect(onAnalysisOpen).not.toHaveBeenCalled()
    expect(
      (screen.getByLabelText('2026-07 사용량(kWh)') as HTMLInputElement)
        .value,
    ).toBe('51,000')
    await waitFor(() =>
      expect(readBillEntryDraft()?.rows[0].usageKwh).toBe('51,000'),
    )
  })

  it('uses accessible tabs to switch bill input modes', async () => {
    const user = userEvent.setup()

    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={async () => true}
        onOpenGuide={() => undefined}
      />,
    )

    expect(screen.getByRole('tab', { name: '파일 업로드' }).getAttribute('aria-selected')).toBe('true')

    await user.click(screen.getByRole('tab', { name: '표 붙여넣기' }))
    expect(screen.getByRole('tabpanel').getAttribute('aria-label')).toBe('표 붙여넣기')

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '직접 입력' }))

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '파일 업로드' }))

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '직접 입력' }))

    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '표 붙여넣기' }))

    expect(document.getElementById('bill-input-panel-file')?.hidden).toBe(true)
    expect(screen.getByRole('tabpanel', { name: '표 붙여넣기' }).hidden).toBe(false)
    expect(document.getElementById('bill-input-panel-manual')?.hidden).toBe(true)
  })

  it('hides a file candidate with its inactive panel and preserves it on return', async () => {
    const user = userEvent.setup()
    const view = render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={async () => true}
        onOpenGuide={() => undefined}
      />,
    )

    fireEvent.change(view.container.querySelector('input[accept=".csv"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
            'billing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    await user.click(view.getByRole('tab', { name: '파일 업로드' }))
    expect(await view.findByRole('button', { name: '이 데이터로 분석 시작' })).toBeTruthy()

    await user.click(view.getByRole('tab', { name: '표 붙여넣기' }))
    expect(view.queryByRole('heading', { name: '새 입력 데이터' })).toBeNull()
    expect(view.queryByRole('button', { name: '이 데이터로 분석 시작' })).toBeNull()

    await user.click(view.getByRole('tab', { name: '직접 입력' }))
    expect(view.queryByRole('heading', { name: '새 입력 데이터' })).toBeNull()
    expect(view.queryByRole('button', { name: '이 데이터로 분석 시작' })).toBeNull()

    await user.click(view.getByRole('tab', { name: '파일 업로드' }))
    expect(await view.findByRole('heading', { name: '새 입력 데이터' })).toBeTruthy()
    expect(await view.findByRole('button', { name: '이 데이터로 분석 시작' })).toBeTruthy()
  })

  it('saves uploaded file candidates with the uploaded origin', async () => {
    const onBillsChange = vi.fn(async () => true)
    await writeBillEntryDraft([makeDraft()])
    const onAnalysisOpen = vi.fn(() => {
      expect(draftStorageKeys()).toEqual([])
    })
    const { container } = render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onAnalysisOpen={onAnalysisOpen}
        onOpenGuide={() => undefined}
      />,
    )

    fireEvent.change(container.querySelector('input[accept=".csv"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
            'billing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: '이 데이터로 분석 시작' }))
    await waitFor(() =>
      expect(onBillsChange).toHaveBeenCalledWith(expect.any(Array), 'uploaded'),
    )
    expect(onAnalysisOpen).toHaveBeenCalledTimes(1)
    expect(draftStorageKeys()).toEqual([])
  })

  it('CAS-removes a manual draft before navigating after pasted data applies', async () => {
    const user = userEvent.setup()
    const onBillsChange = vi.fn(async () => true)
    await writeBillEntryDraft([makeDraft()])
    const onAnalysisOpen = vi.fn(() => {
      expect(draftStorageKeys()).toEqual([])
    })
    render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onAnalysisOpen={onAnalysisOpen}
        onOpenGuide={() => undefined}
      />,
    )

    await user.click(screen.getByRole('tab', { name: '표 붙여넣기' }))
    fireEvent.change(screen.getByLabelText('붙여넣을 표'), {
      target: {
        value:
          '연도\t월\t사용량(kWh)\t총 전기요금(원)\n2026\t7\t42000\t6420000',
      },
    })
    await user.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))
    await user.click(
      await screen.findByRole('button', {
        name: '이 데이터로 분석 시작',
      }),
    )

    await waitFor(() =>
      expect(onBillsChange).toHaveBeenCalledWith(expect.any(Array), 'pasted'),
    )
    expect(onAnalysisOpen).toHaveBeenCalledTimes(1)
    expect(draftStorageKeys()).toEqual([])
  })

  it('saves a synthetic multi-sheet XLSX candidate with the uploaded origin', async () => {
    const onBillsChange = vi.fn(async () => true)
    const { container } = render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onOpenGuide={() => undefined}
      />,
    )

    fireEvent.change(container.querySelector('input[accept=".xlsx,.xls"]')!, {
      target: { files: [await createSyntheticWorkbook()] },
    })

    fireEvent.click(await screen.findByRole('button', { name: '이 데이터로 분석 시작' }))
    await waitFor(() =>
      expect(onBillsChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ year: 2025, month: 11 }),
          expect.objectContaining({ year: 2026, month: 2 }),
        ]),
        'uploaded',
      ),
    )
  })

  it('shows configuration guidance and blocks analysis without an exact plan', async () => {
    const { container } = render(
      <BillUpload
        bills={sampleBills}
        profile={{ ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' }}
        ratePlans={defaultRatePlans}
        onBillsChange={async () => true}
        onOpenGuide={() => undefined}
      />,
    )

    expect(screen.getByText(/현재 프로필과 정확히 일치하는 요금제가 없습니다/)).toBeTruthy()
    expect(screen.getByText(/계약종별, 수전전압, 현재 요금제를 일치시켜야/)).toBeTruthy()

    fireEvent.change(container.querySelector('input[accept=".csv"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
            'billing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    const startButton = await screen.findByRole('button', { name: '이 데이터로 분석 시작' })
    expect(startButton).toHaveProperty('disabled', true)
  })

  it('does not apply manually mapped bills without an exact plan', async () => {
    const onBillsChange = vi.fn(async () => true)
    const { container } = render(
      <BillUpload
        bills={sampleBills}
        profile={{ ...defaultSchoolProfile, currentPlan: '설정에 없는 요금제' }}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onOpenGuide={() => undefined}
      />,
    )

    fireEvent.change(container.querySelector('input[accept=".csv"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
            'billing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: '수동 매핑 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '선택 시트 적용' }))

    expect(onBillsChange).not.toHaveBeenCalled()
    expect(
      screen.getByText(/현재 요금제가 설정과 정확히 일치하지 않아 분석을 시작할 수 없습니다/),
    ).toBeTruthy()
  })

  it('explains invalid required values instead of applying a negative-usage row', async () => {
    const onBillsChange = vi.fn(async () => true)
    const { container } = render(
      <BillUpload
        bills={sampleBills}
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onBillsChange={onBillsChange}
        onOpenGuide={() => undefined}
      />,
    )

    fireEvent.change(container.querySelector('input[accept=".csv"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,-42000,6420000'],
            'invalid-billing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: '수동 매핑 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '선택 시트 적용' }))

    expect(onBillsChange).not.toHaveBeenCalled()
    expect(screen.getByText(/사용량은 0보다 큰 값/)).toBeTruthy()
  })
})
