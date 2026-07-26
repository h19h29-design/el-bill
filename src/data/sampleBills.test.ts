import { describe, expect, it } from 'vitest'
import { validateBillPeriods } from '../lib/billPeriods'
import { defaultSchoolProfile, sampleBills } from './sampleBills'

describe('public sample profile privacy', () => {
  it('does not retain customer-number suffixes or real district details', () => {
    expect(defaultSchoolProfile.customerNumber).toBe('**********')
    expect(defaultSchoolProfile.address).not.toContain('강서구')
    expect(defaultSchoolProfile.kepcoBranch).not.toContain('강서양천')
  })

  it('uses 36 consecutive synthetic calendar months', () => {
    const validation = validateBillPeriods(sampleBills, 36)

    expect(validation.distinctMonthCount).toBe(36)
    expect(validation.recentConsecutiveBills).toHaveLength(36)
  })

  it('contains no source-specific note or direct identifier', () => {
    const protectedIdentifiers = [
      ['등', '촌'].join(''),
      ['86', '16'].join(''),
      ['91', '36'].join(''),
    ]

    expect(JSON.stringify(sampleBills)).not.toMatch(
      new RegExp(protectedIdentifiers.join('|')),
    )
    expect(defaultSchoolProfile.customerNumber).toBe('**********')
  })
})
