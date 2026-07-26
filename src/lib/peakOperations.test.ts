import { describe, expect, it } from 'vitest'
import { defaultScenario } from '../data/sampleBills'
import { getPeakRiskLevel } from './peak'
import {
  buildPeakOperationPlan,
  normalizeEhpGroupCount,
} from './peakOperations'

describe('peak operation sequencing', () => {
  it('invalid peak target is rejected as 위험', () => {
    expect(getPeakRiskLevel(0, 400)).toBe('위험')
    expect(getPeakRiskLevel(-1, 400)).toBe('위험')
    expect(getPeakRiskLevel(500, 0)).toBe('위험')
    expect(getPeakRiskLevel(500, -1)).toBe('위험')
    expect(getPeakRiskLevel(Number.NaN, 400)).toBe('위험')
    expect(getPeakRiskLevel(500, Number.NaN)).toBe('위험')
  })

  it('enumerates every configured EHP group at five-minute intervals', () => {
    const plan = buildPeakOperationPlan({
      ...defaultScenario,
      mainBuildingEhpGroups: 3,
      annexEhpGroups: 2,
    })

    expect(plan.sequentialOrder).toEqual([
      '제외 공간 상시 유지: 보건실, 서버실, 특수학급',
      '13:00 본관 EHP 1그룹 기동',
      '13:05 본관 EHP 2그룹 기동',
      '13:10 본관 EHP 3그룹 기동',
      '13:15 별관 EHP 1그룹 기동',
      '13:20 별관 EHP 2그룹 기동',
      '특별실 및 강당은 예냉 후 유지운전',
    ])
  })

  it.each([
    [0, 5],
    [-1, 5],
    [1.5, 5],
    [Number.NaN, 5],
    [101, 100],
    [1_000_000, 100],
  ])('normalizes unsafe EHP group count %s to %s', (value, expected) => {
    expect(normalizeEhpGroupCount(value, 5)).toBe(expected)
  })

  it('never allocates more than the configured EHP safety cap', () => {
    const plan = buildPeakOperationPlan({
      ...defaultScenario,
      mainBuildingEhpGroups: 1_000_000,
      annexEhpGroups: 1_000_000,
    })

    expect(plan.sequentialOrder).toHaveLength(202)
    expect(plan.todayPlan).toContain('본관 EHP 100개 그룹')
    expect(plan.todayPlan).toContain('별관 100개 그룹')
  })

  it('returns tariff and school operating windows for overlap review', () => {
    const plan = buildPeakOperationPlan({
      ...defaultScenario,
      cafeteriaHighPowerTime: '11:00~13:00',
      specialRoomTime: '14:00~16:00',
    })

    expect(plan.operatingWindows).toEqual(
      expect.arrayContaining([
        {
          label: '하계 최대부하',
          time: '11:00~12:00 · 13:00~17:00',
          tone: 'danger',
        },
        {
          label: '급식실 고전력 기기',
          time: '11:00~13:00',
          tone: 'warning',
        },
        {
          label: '특별실 집중 사용',
          time: '14:00~16:00',
          tone: 'warning',
        },
      ]),
    )
  })
})
