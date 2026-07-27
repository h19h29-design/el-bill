/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile } from '../../data/sampleBills'
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
      '다운로드 폴더에서 분석할 수 있는 XLSX, CSV, 또는 파워플래너 HTML XLS 파일을 찾지 못했습니다.',
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
