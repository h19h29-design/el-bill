/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import App from './App'

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

  it('migrates a legacy uploaded session into independent provenance', async () => {
    localStorage.setItem('el-bill:data-mode', stored('uploaded'))

    const firstRender = render(<App />)

    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 사용자 업로드')
    await waitFor(() => {
      expect(localStorage.getItem('el-bill:data-mode')).toBeNull()
      expect(JSON.parse(localStorage.getItem('el-bill:data-provenance') ?? '{}').data).toEqual({
        bills: 'uploaded',
        powerPlanner: 'none',
      })
    })

    firstRender.unmount()
    render(<App />)
    expect(document.querySelector('.notice-detail')?.textContent).toContain('고지서: 사용자 업로드')
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
})
