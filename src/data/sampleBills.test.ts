import { describe, expect, it } from 'vitest'
import { defaultSchoolProfile } from './sampleBills'

describe('public sample profile privacy', () => {
  it('does not retain customer-number suffixes or real district details', () => {
    expect(defaultSchoolProfile.customerNumber).toBe('**********')
    expect(defaultSchoolProfile.address).not.toContain('강서구')
    expect(defaultSchoolProfile.kepcoBranch).not.toContain('강서양천')
  })
})
