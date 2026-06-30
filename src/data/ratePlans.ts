import type { RatePlan } from '../types'

export const defaultRatePlans: RatePlan[] = [
  {
    id: 'edu-a-low',
    contractType: '교육용(갑)',
    voltageType: '저압',
    planName: '저압 기본',
    baseRateWonPerKw: 6160,
    seasonRates: {
      springAutumn: 94.4,
      summer: 135.7,
      winter: 123.4,
    },
    effectiveFrom: '2025-01-01',
    memo: '시연용 추정 단가. 실제 적용 전 한전 고시 단가 확인 필요',
  },
  {
    id: 'edu-a-high-a-1',
    contractType: '교육용(갑)',
    voltageType: '고압A',
    planName: '선택요금Ⅰ',
    baseRateWonPerKw: 5550,
    seasonRates: {
      springAutumn: 86.5,
      summer: 123.3,
      winter: 109.3,
    },
    lightLoadRate: 61.6,
    midLoadRate: 86.5,
    peakLoadRate: 123.3,
    effectiveFrom: '2025-01-01',
    memo: '첨부 변경계획서의 고압A 선택요금 I 비교표 기반',
  },
  {
    id: 'edu-a-high-a-2',
    contractType: '교육용(갑)',
    voltageType: '고압A',
    planName: '선택요금Ⅱ',
    baseRateWonPerKw: 6370,
    seasonRates: {
      springAutumn: 82.1,
      summer: 118.8,
      winter: 104.8,
    },
    lightLoadRate: 57.2,
    midLoadRate: 82.1,
    peakLoadRate: 118.8,
    effectiveFrom: '2025-01-01',
    memo: '첨부 변경계획서의 기존 고압A 선택요금 II 비교표 기반',
  },
  {
    id: 'edu-a-high-b-1',
    contractType: '교육용(갑)',
    voltageType: '고압B',
    planName: '선택요금Ⅰ',
    baseRateWonPerKw: 5190,
    seasonRates: {
      springAutumn: 83.4,
      summer: 119.9,
      winter: 106.5,
    },
    effectiveFrom: '2025-01-01',
    memo: '확장 가능한 요금표 예시. 실제 계약 전 검토 필요',
  },
  {
    id: 'edu-a-high-b-2',
    contractType: '교육용(갑)',
    voltageType: '고압B',
    planName: '선택요금Ⅱ',
    baseRateWonPerKw: 5940,
    seasonRates: {
      springAutumn: 79.8,
      summer: 116.4,
      winter: 103.1,
    },
    effectiveFrom: '2025-01-01',
    memo: '확장 가능한 요금표 예시. 실제 계약 전 검토 필요',
  },
  {
    id: 'edu-b-high-a-1',
    contractType: '교육용(을)',
    voltageType: '고압A',
    planName: '선택요금Ⅰ',
    baseRateWonPerKw: 5840,
    seasonRates: {
      springAutumn: 88.2,
      summer: 126.5,
      winter: 112.4,
    },
    effectiveFrom: '2025-01-01',
    memo: '설정 화면 수정용 기본값',
  },
]

export const currentPlanId = 'edu-a-high-a-2'
export const recommendedPlanId = 'edu-a-high-a-1'
