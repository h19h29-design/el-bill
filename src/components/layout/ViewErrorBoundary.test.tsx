/* @vitest-environment jsdom */

import { lazy, Suspense, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ViewErrorBoundary } from './ViewErrorBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ViewErrorBoundary', () => {
  it('shows a stable recovery panel when a lazy import rejects', async () => {
    const RejectedImport = lazy(() => Promise.reject(new Error('chunk unavailable')))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ViewErrorBoundary>
        <Suspense fallback={<p>불러오는 중</p>}>
          <RejectedImport />
        </Suspense>
      </ViewErrorBoundary>,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('화면을 불러오지 못했습니다.')
    expect(screen.getByRole('button', { name: '페이지 새로고침' })).toBeTruthy()
  })

  it('resets the boundary before invoking the recovery action', async () => {
    const onReload = vi.fn()
    const ThrowOnce = ({ shouldThrow }: { shouldThrow: boolean }) => {
      if (shouldThrow) throw new Error('first render fails')
      return <p>복구된 화면</p>
    }
    const Harness = () => {
      const [shouldThrow, setShouldThrow] = useState(true)
      return (
        <ViewErrorBoundary onReload={() => {
          setShouldThrow(false)
          onReload()
        }}>
          <ThrowOnce shouldThrow={shouldThrow} />
        </ViewErrorBoundary>
      )
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(<Harness />)

    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '페이지 새로고침' }))

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('복구된 화면')).toBeTruthy()
  })
})
