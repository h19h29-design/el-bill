/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { sampleBills } from './data/sampleBills'
import { samplePowerPlannerDataSource } from './data/samplePowerPlanner'

const stored = (data: unknown) =>
  JSON.stringify({
    createdAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-01-02T00:00:00.000Z',
    data,
  })

const expiredStored = (data: unknown) =>
  JSON.stringify({
    createdAt: '2020-01-01T00:00:00.000Z',
    expiresAt: '2020-01-02T00:00:00.000Z',
    data,
  })

describe('data provenance persistence', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('keeps a legacy uploaded mode without billing evidence locked to the sample', async () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))

    const firstRender = render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(localStorage.getItem('el-bill:data-mode')).toBeNull()
      expect(JSON.parse(localStorage.getItem('el-bill:data-provenance') ?? '{}').data).toEqual({
        bills: 'sample',
        powerPlanner: 'none',
      })
    })

    firstRender.unmount()
    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
  })

  it('keeps legacy uploaded mode with stored bills and PowerPlanner data locked to the sample', async () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))
    localStorage.setItem('el-bill:bills', stored(sampleBills))
    localStorage.setItem('el-bill:power-planner', stored(samplePowerPlannerDataSource))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('el-bill:data-provenance') ?? '{}').data).toEqual({
        bills: 'sample',
        powerPlanner: 'none',
      })
      expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: /^파워플래너$/ }))
    expect(
      screen.getByText('파워플래너 자료가 없으면 기존 한전 고지서 월별 데이터만으로 진단합니다.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^피크관리$/ }))
    expect(
      screen.getByText(/파워플래너 자료가 없으므로 기존 한전 고지서 월별 데이터와 예상 피크 입력값으로 진단합니다/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^문서생성$/ }))
    expect(screen.getByText('사용자 고지서 업로드 후 생성 가능')).toBeTruthy()
  })

  it('restores PowerPlanner records for a new explicit provenance session', () => {
    localStorage.setItem(
      'el-bill:data-provenance',
      stored({ bills: 'sample', powerPlanner: 'uploaded' }),
    )
    localStorage.setItem('el-bill:power-planner', stored(samplePowerPlannerDataSource))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('파워플래너: 사용자 업로드')
    fireEvent.click(screen.getByRole('button', { name: /^파워플래너$/ }))
    expect(screen.getByText('25건')).toBeTruthy()
    expect(localStorage.getItem('el-bill:power-planner')).not.toBeNull()
  })

  it('clears PowerPlanner data after an expired legacy mode without explicit provenance', () => {
    localStorage.setItem('el-bill:data-mode', expiredStored('uploaded'))
    localStorage.setItem('el-bill:power-planner', stored(samplePowerPlannerDataSource))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('파워플래너: 미사용')
    expect(localStorage.getItem('el-bill:power-planner')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^파워플래너$/ }))
    expect(
      screen.getByText('파워플래너 자료가 없으면 기존 한전 고지서 월별 데이터만으로 진단합니다.'),
    ).toBeTruthy()
  })

  it('migrates a legacy sample session without granting upload eligibility', async () => {
    localStorage.setItem('el-bill:data-mode', stored('sample'))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('el-bill:data-provenance') ?? '{}').data).toEqual({
        bills: 'sample',
        powerPlanner: 'none',
      })
    })
  })

  it('replaces malformed stored provenance with the safe sample defaults', async () => {
    localStorage.setItem(
      'el-bill:data-provenance',
      stored({ bills: 'uploaded', powerPlanner: 'untrusted' }),
    )

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('el-bill:data-provenance') ?? '{}').data).toEqual({
        bills: 'sample',
        powerPlanner: 'none',
      })
    })
  })

  it.each([
    ['expired', JSON.stringify({ createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z', data: sampleBills })],
    ['malformed', stored({ not: 'monthly bills' })],
  ])('does not trust a %s billing payload during legacy upload migration', async (_, payload) => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))
    localStorage.setItem('el-bill:bills', payload)

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 시연 샘플')
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('el-bill:data-provenance') ?? '{}').data).toEqual({
        bills: 'sample',
        powerPlanner: 'none',
      })
    })
  })
})
