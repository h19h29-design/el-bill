import type { MonthlyBill, PeakScenario, SchoolProfile } from '../types'

const appliedPowerKw = 500
const baseRateWonPerKw = 6370
const climateRateWonPerKwh = 9
const fuelAdjustmentRateWonPerKwh = -5
const vatRate = 0.1
const fundRate = 0.037

const usageFor = (year: number, month: number, index: number) =>
  Math.round(
    28_000 +
      (month >= 6 && month <= 8 ? 13_000 : 0) +
      ([12, 1, 2].includes(month) ? 17_000 : 0) +
      (index % 5) * 1_350 +
      (year - 2023) * 420,
  )

const energyRateFor = (month: number) => {
  if (month >= 6 && month <= 8) return 118.8
  if ([12, 1, 2].includes(month)) return 104.8
  return 82.1
}

const makeBill = (year: number, month: number, index: number): MonthlyBill => {
  const usageKwh = usageFor(year, month, index)
  const baseChargeWon = appliedPowerKw * baseRateWonPerKw
  const energyChargeWon = Math.round(usageKwh * energyRateFor(month))
  const climateChargeWon = Math.round(usageKwh * climateRateWonPerKwh)
  const fuelAdjustmentWon = Math.round(usageKwh * fuelAdjustmentRateWonPerKwh)
  const beforeTaxWon =
    baseChargeWon +
    energyChargeWon +
    climateChargeWon +
    fuelAdjustmentWon
  const vatWon = Math.round(beforeTaxWon * vatRate)
  const fundWon = Math.round(beforeTaxWon * fundRate)
  const seasonalDemand = [6, 7, 8, 12, 1, 2].includes(month) ? 68 : 32
  const maxDemandKw = Math.min(
    appliedPowerKw,
    Math.round(330 + usageKwh / 180 + seasonalDemand + (index % 3) * 7),
  )

  return {
    id: `sample-${year}-${String(month).padStart(2, '0')}`,
    year,
    month,
    usageKwh,
    totalBillWon: beforeTaxWon + vatWon + fundWon,
    baseChargeWon,
    energyChargeWon,
    appliedPowerKw,
    maxDemandKw,
    powerFactorChargeWon: 0,
    climateChargeWon,
    fuelAdjustmentWon,
    vatWon,
    fundWon,
    note: '합성 시연 데이터',
  }
}

const buildSyntheticSampleBills = (): MonthlyBill[] =>
  Array.from({ length: 36 }, (_, index) => {
    const calendarMonth = 7 + index
    const year = 2023 + Math.floor(calendarMonth / 12)
    const month = (calendarMonth % 12) + 1
    return makeBill(year, month, index)
  })

export const sampleBills = buildSyntheticSampleBills()

export const defaultSchoolProfile: SchoolProfile = {
  schoolName: 'A고등학교',
  displaySchoolName: 'A고등학교',
  customerNumber: '**********',
  address: '서울특별시 ○○구 ○○로 **',
  kepcoBranch: '관할 한전 지사(확인 필요)',
  contractType: '교육용(갑)',
  voltageType: '고압A',
  currentPlan: '선택요금Ⅱ',
  contractPowerKw: 900,
  appliedPowerKw,
  managerName: '에너지 담당자',
  managerPhone: '02-****-****',
  dataCreatedAt: new Date().toISOString(),
  dataExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
}

export const defaultScenario: PeakScenario = {
  targetPeakKw: 500,
  expectedPeakKw: 485,
  usageIncreasePercent: 10,
  summerIncreasePercent: 10,
  winterIncreasePercent: 8,
  analysisYear: 2025,
  memo: 'EHP 증설 예정. 강당과 급식실 동시 피크 시간 분산 필요',
  mainBuildingEhpGroups: 5,
  annexEhpGroups: 2,
  auditoriumCooling: true,
  cafeteriaHighPowerTime: '11:00~13:00',
  specialRoomTime: '14:00~16:00',
  exemptSpaces: '보건실, 서버실, 특수학급',
}
