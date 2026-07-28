/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile, sampleBills } from '../../data/sampleBills'
import * as billPdf from '../../lib/billPdf'
import { FileBillInput } from './FileBillInput'

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

const directoryWith = (file: File) => ({
  values: async function* () {
    yield {
      kind: 'file' as const,
      name: file.name,
      getFile: async () => file,
    }
  },
})

const directoryWithEntries = (entries: Array<{
  kind: 'file' | 'directory'
  name: string
  getFile?: () => Promise<File>
}>) => ({
  values: async function* () {
    yield* entries
  },
})

afterEach(() => {
  cleanup()
  delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker
  vi.restoreAllMocks()
})

describe('FileBillInput', () => {
  it('keeps the existing file selection controls available', () => {
    render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: '엑셀 파일 선택 또는 드롭' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CSV 불러오기' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '한전 고지서 PDF 업로드' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: '무료 AI로 고지서 변환' }),
    ).toBeTruthy()
  })

  it('combines several selected bill PDFs into one uploaded candidate', async () => {
    const onCandidateChange = vi.fn()
    const june = new File(['%PDF-1.7'], '2026-06.pdf', {
      type: 'application/pdf',
    })
    const july = new File(['%PDF-1.7'], '2026-07.pdf', {
      type: 'application/pdf',
    })
    const parsedBills = sampleBills.slice(0, 2)
    const parsePdfFiles = vi
      .spyOn(billPdf, 'parseBillPdfFiles')
      .mockResolvedValue({
        sheets: [
          {
            name: '2026-06.pdf',
            headers: ['연도', '월', '사용량', '총 전기요금'],
            rows: [{
              연도: parsedBills[0].year,
              월: parsedBills[0].month,
              사용량: parsedBills[0].usageKwh,
              '총 전기요금': parsedBills[0].totalBillWon,
            }],
          },
          {
            name: '2026-07.pdf',
            headers: ['연도', '월', '사용량', '총 전기요금'],
            rows: [{
              연도: parsedBills[1].year,
              월: parsedBills[1].month,
              사용량: parsedBills[1].usageKwh,
              '총 전기요금': parsedBills[1].totalBillWon,
            }],
          },
        ],
        autoRows: parsedBills,
        diagnostics: ['PDF 2개를 읽었습니다.'],
      })
    const { container } = render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={onCandidateChange}
      />,
    )

    fireEvent.change(container.querySelector('input[accept=".pdf"]')!, {
      target: { files: [june, july] },
    })

    await waitFor(() => {
      expect(parsePdfFiles).toHaveBeenCalledWith(
        [june, july],
        expect.objectContaining({
          appliedPowerKw: defaultSchoolProfile.appliedPowerKw,
        }),
      )
      expect(onCandidateChange).toHaveBeenCalledWith({
        origin: 'uploaded',
        bills: parsedBills,
        sourceLabel: '한전 고지서 PDF 2개',
      })
    })
    expect(screen.getByText(/PDF 2개에서 2개월/)).toBeTruthy()
  })

  it('shows browser guidance when directory picking is unavailable', () => {
    const view = render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={() => undefined}
      />,
    )

    expect(view.getByText('Chrome 또는 Edge에서는 다운로드 폴더에서 최신 파일을 찾을 수 있습니다.')).toBeTruthy()
    expect(view.queryByRole('button', { name: '다운로드 폴더에서 최신 파일 찾기' })).toBeNull()
  })

  it('imports the file selected from a directory through the normal file path', async () => {
    const onCandidateChange = vi.fn()
    const newest = new File(
      ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
      'latest.csv',
      { lastModified: 1_740_000_000_000 },
    )
    ;(globalThis as {
      showDirectoryPicker?: () => Promise<unknown>
    }).showDirectoryPicker = vi.fn().mockResolvedValue(directoryWith(newest))

    render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={onCandidateChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '다운로드 폴더에서 최신 파일 찾기' }))

    await waitFor(() => {
      expect(onCandidateChange).toHaveBeenCalledWith(expect.objectContaining({
        origin: 'uploaded',
        sourceLabel: 'latest.csv',
      }))
    })
  })

  it('leaves the upload screen unchanged when directory selection is cancelled', async () => {
    ;(globalThis as {
      showDirectoryPicker?: () => Promise<never>
    }).showDirectoryPicker = vi.fn().mockRejectedValue(
      new DOMException('The user aborted a request.', 'AbortError'),
    )

    const { container, getByRole } = render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={() => undefined}
      />,
    )

    fireEvent.click(getByRole('button', { name: '다운로드 폴더에서 최신 파일 찾기' }))

    await waitFor(() => {
      expect(container.querySelector('.status-line')).toBeNull()
    })
  })

  it.each([
    [
      'permission denial',
      () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      '다운로드 폴더의 파일을 읽지 못했습니다. 브라우저의 폴더 접근 권한을 확인한 뒤 일반 파일 선택으로 다시 시도해 주세요.',
    ],
    [
      'no supported file',
      () => Promise.resolve(directoryWithEntries([
        {
          kind: 'file',
          name: 'notes.txt',
          getFile: async () => new File(['notes'], 'notes.txt'),
        },
      ])),
      '다운로드 폴더에서 분석할 수 있는 PDF, XLSX, CSV, 또는 파워플래너 HTML XLS 파일을 찾지 못했습니다.',
    ],
    [
      'directory read error',
      () => Promise.resolve(directoryWithEntries([
        {
          kind: 'file',
          name: 'bill.csv',
          getFile: async () => {
            throw new DOMException('Permission denied', 'NotAllowedError')
          },
        },
      ])),
      '다운로드 폴더의 파일을 읽지 못했습니다. 브라우저의 폴더 접근 권한을 확인한 뒤 일반 파일 선택으로 다시 시도해 주세요.',
    ],
  ])('preserves an existing candidate after directory %s', async (_label, pickerResult, expectedMessage) => {
    const onCandidateChange = vi.fn()
    ;(globalThis as {
      showDirectoryPicker?: () => Promise<unknown>
    }).showDirectoryPicker = vi.fn().mockImplementation(pickerResult)

    const { container, getByRole, getByText } = render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={onCandidateChange}
      />,
    )

    fireEvent.change(container.querySelector('input[accept=".csv"]')!, {
      target: {
        files: [
          new File(
            ['연도,월,사용량,총 전기요금\n2026,7,42000,6420000'],
            'existing.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    })

    await waitFor(() => {
      expect(onCandidateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        origin: 'uploaded',
        sourceLabel: 'existing.csv',
      }))
    })

    fireEvent.click(getByRole('button', { name: '다운로드 폴더에서 최신 파일 찾기' }))

    await waitFor(() => {
      expect(getByText(expectedMessage)).toBeTruthy()
    })
    expect(onCandidateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      origin: 'uploaded',
      sourceLabel: 'existing.csv',
    }))
  })

  it('emits uploaded candidates from CSV files', async () => {
    const onCandidateChange = vi.fn()
    const { container } = render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={onCandidateChange}
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

    await waitFor(() => {
      expect(onCandidateChange).toHaveBeenCalledWith(expect.objectContaining({
        origin: 'uploaded',
        sourceLabel: 'billing.csv',
      }))
    })
    expect(
      screen.queryByRole('button', { name: '이 매핑으로 분석 시작' }),
    ).toBeNull()
  })

  it('keeps multi-sheet XLSX recognition and automatic rows aligned', async () => {
    const onCandidateChange = vi.fn()
    const { container } = render(
      <FileBillInput
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onCandidateChange={onCandidateChange}
      />,
    )

    fireEvent.change(container.querySelector('input[accept=".xlsx,.xls"]')!, {
      target: { files: [await createSyntheticWorkbook()] },
    })

    await waitFor(() => {
      expect(onCandidateChange).toHaveBeenCalledWith(expect.objectContaining({
        origin: 'uploaded',
        sourceLabel: 'monthly-bills.xlsx',
        bills: expect.arrayContaining([
          expect.objectContaining({ year: 2025, month: 11 }),
          expect.objectContaining({ year: 2026, month: 2 }),
        ]),
      }))
    })
    expect(await screen.findByText('2025 시연, 2026 시연')).toBeTruthy()
    expect(screen.getByText('2025, 2026')).toBeTruthy()
    expect(screen.getByText('4건')).toBeTruthy()
  })
})
