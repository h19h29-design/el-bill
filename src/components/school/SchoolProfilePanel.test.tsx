/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchoolProfilePanel } from '../../App'
import { defaultRatePlans } from '../../data/ratePlans'
import { defaultSchoolProfile } from '../../data/sampleBills'

afterEach(cleanup)

describe('school profile validation', () => {
  it('emits a field intent instead of a stale full profile', async () => {
    const onProfileChange = vi.fn(async () => true)
    render(
      <SchoolProfilePanel
        profile={defaultSchoolProfile}
        ratePlans={defaultRatePlans}
        onProfileChange={onProfileChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('화면 표시명'), {
      target: { value: '변경 학교' },
    })

    await waitFor(() =>
      expect(onProfileChange).toHaveBeenCalledWith({
        type: 'patch',
        patch: { displaySchoolName: '변경 학교' },
      }),
    )
  })

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

  it('selects NFKC-equivalent tariff values without a false warning', () => {
    const currentPlan = defaultRatePlans.find(
      (plan) => plan.id === 'edu-a-high-a-2',
    )!
    render(
      <SchoolProfilePanel
        profile={{
          ...defaultSchoolProfile,
          contractType: ` ${currentPlan.contractType.normalize('NFD')} `,
          voltageType: '고압Ａ',
          currentPlan: ` ${currentPlan.planName.normalize('NFD')} `,
        }}
        ratePlans={defaultRatePlans}
        onProfileChange={async () => true}
      />,
    )

    expect(
      (screen.getByLabelText('계약종별') as HTMLSelectElement).value,
    ).toBe(currentPlan.contractType)
    expect(
      (screen.getByLabelText('수전전압') as HTMLSelectElement).value,
    ).toBe(currentPlan.voltageType)
    expect(
      (screen.getByLabelText('현재 요금제') as HTMLSelectElement).value,
    ).toBe(currentPlan.id)
    expect(
      screen.queryByText(/현재 요금제 조합이 없거나 중복됩니다/),
    ).toBeNull()
  })
})
