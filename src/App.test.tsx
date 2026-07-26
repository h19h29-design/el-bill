/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import App from './App'
import { sampleBills } from './data/sampleBills'
import { samplePowerPlannerDataSource } from './data/samplePowerPlanner'

const stored = (data: unknown) =>
  JSON.stringify({
    createdAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-01-02T00:00:00.000Z',
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

  it('migrates a legacy uploaded mode only with valid unexpired consecutive bills', async () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))
    localStorage.setItem('el-bill:bills', stored(sampleBills))
    localStorage.setItem('el-bill:power-planner', stored(samplePowerPlannerDataSource))

    render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 사용자 업로드')
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('el-bill:data-provenance') ?? '{}').data).toEqual({
        bills: 'uploaded',
        powerPlanner: 'none',
      })
    })
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
