/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
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
