/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultScenario } from '../../data/sampleBills'
import { buildPeakOperationPlan } from '../../lib/peakOperations'
import { PeakManager } from './PeakManager'

afterEach(cleanup)

describe('peak manager EHP input safety', () => {
  it.each([
    ['본관 EHP 그룹 수', '0'],
    ['별관 EHP 그룹 수', '-1'],
    ['본관 EHP 그룹 수', '1.5'],
    ['별관 EHP 그룹 수', '101'],
  ])('rejects invalid %s value %s with guidance', (label, value) => {
    const onScenarioChange = vi.fn(async () => true)
    render(
      <PeakManager
        scenario={defaultScenario}
        onScenarioChange={onScenarioChange}
        peakOperationPlan={buildPeakOperationPlan(defaultScenario)}
      />,
    )

    const input = screen.getByLabelText(label)
    expect(input.getAttribute('min')).toBe('1')
    expect(input.getAttribute('max')).toBe('100')
    fireEvent.change(input, { target: { value } })

    expect(onScenarioChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('1~100')
  })
})
