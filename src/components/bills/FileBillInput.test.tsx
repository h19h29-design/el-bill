/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile } from '../../data/sampleBills'
import { FileBillInput } from './FileBillInput'

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
})
