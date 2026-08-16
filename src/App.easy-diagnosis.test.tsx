/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { sampleBills } from './data/sampleBills'
import { readStorageSnapshot } from './lib/storage'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const pasteTable = [
  '연도\t월\t사용량(kWh)\t총 전기요금(원)\t요금적용전력(kW)',
  ...sampleBills.slice(-12).map((bill) =>
    [bill.year, bill.month, bill.usageKwh, bill.totalBillWon, bill.appliedPowerKw].join('\t'),
  ),
].join('\n')

describe('App beginner diagnosis flow', () => {
  it('opens from the dashboard and atomically applies twelve pasted months', async () => {
    render(<App />)

    fireEvent.click(
      await screen.findByRole('button', { name: '쉬운 진단 시작' }, { timeout: 3_000 }),
    )
    expect(
      await screen.findByRole('heading', { name: '어떤 자료를 가지고 계신가요?' }, { timeout: 3_000 }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /표 붙여넣기/ }))
    fireEvent.change(screen.getByLabelText('12개월 표 붙여넣기'), {
      target: { value: pasteTable },
    })
    fireEvent.click(screen.getByRole('button', { name: '붙여넣은 표 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '자료 확인으로 이동' }))
    fireEvent.click(screen.getByRole('button', { name: '계약정보 확인으로 이동' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '자동 분석 시작' }))
    })

    expect(
      await screen.findByRole('heading', { name: /변경하지 마세요|변경하세요|유지하세요/ }, { timeout: 3_000 }),
    ).toBeTruthy()
    await waitFor(() => expect(readStorageSnapshot()).not.toBeNull())
    const snapshot = readStorageSnapshot()
    expect(snapshot?.data.bills).toHaveLength(12)
    expect(snapshot?.data.provenance.bills).toBe('pasted')
    expect(Date.parse(snapshot?.session.expiresAt ?? '')).toBeGreaterThan(Date.now())
  })

  it('keeps the expert automatic diagnosis menu alongside the beginner flow', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: '쉬운 진단' }, { timeout: 3_000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: '자동진단' })).toBeTruthy()
  })
})
