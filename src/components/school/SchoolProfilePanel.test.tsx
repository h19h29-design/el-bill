/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchoolProfilePanel } from '../../App'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile } from '../../data/sampleBills'

afterEach(cleanup)

describe('school profile validation', () => {
  it.each([
    ['계약전력(kW)', '-1'],
    ['요금적용전력(kW)', '0'],
    ['요금적용전력(kW)', '901'],
  ])('rejects invalid %s with accessible guidance', async (label, value) => {
    const onProfileChange = vi.fn(async () => true)
    render(
      <SchoolProfilePanel
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onProfileChange={onProfileChange}
      />,
    )

    const input = screen.getByLabelText(label)
    fireEvent.change(input, { target: { value } })

    expect(onProfileChange).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(input.getAttribute('aria-invalid')).toBe('true'),
    )
    expect(screen.getByRole('status').textContent).toContain('전력')
  })

  it('keeps the controlled value and reports a failed persistent save', async () => {
    const onProfileChange = vi.fn(async () => false)
    render(
      <SchoolProfilePanel
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onProfileChange={onProfileChange}
      />,
    )

    const input = screen.getByLabelText('계약전력(kW)')
    fireEvent.change(input, { target: { value: '950' } })

    await waitFor(() => expect(onProfileChange).toHaveBeenCalled())
    expect((input as HTMLInputElement).value).toBe('900')
    expect(screen.getByRole('status').textContent).toContain('저장')
  })
})
