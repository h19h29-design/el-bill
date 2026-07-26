import { describe, expect, it } from 'vitest'
import { defaultScenario } from '../data/sampleBills'
import { buildPeakOperationPlan } from './peakOperations'

describe('peak operation sequencing', () => {
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
