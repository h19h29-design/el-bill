import type { MonthlyBill, PeakScenario, SchoolProfile } from '../types'

const appliedPowerKw = 497

const makeBill = (
  year: number,
  month: number,
  usageKwh: number,
  totalBillWon: number,
): MonthlyBill => {
  const baseChargeWon = appliedPowerKw * 6370
  const energyChargeWon = Math.round(usageKwh * 82.1)
  const climateChargeWon = Math.round(usageKwh * 9)
  const fuelAdjustmentWon = Math.round(usageKwh * -5)
  const vatWon = Math.round(totalBillWon * 0.09)
  const fundWon = Math.round(totalBillWon * 0.037)
  const seasonalAdder = [6, 7, 8, 12, 1, 2].includes(month) ? 58 : 20
  const maxDemandKw = Math.max(385, Math.round(usageKwh / 120 + seasonalAdder))

  return {
    id: `${year}-${String(month).padStart(2, '0')}`,
    year,
    month,
    usageKwh,
    totalBillWon,
    baseChargeWon,
    energyChargeWon,
    appliedPowerKw,
    maxDemandKw,
    powerFactorChargeWon: 0,
    climateChargeWon,
    fuelAdjustmentWon,
    vatWon,
    fundWon,
    note: '첨부 엑셀 기반 익명 샘플',
  }
}

export const sampleBills: MonthlyBill[] = [
  makeBill(2020, 3, 25862, 4291670),
  makeBill(2020, 4, 17028, 3372900),
  makeBill(2020, 5, 18317, 3454100),
  makeBill(2020, 6, 18641, 3839350),
  makeBill(2020, 7, 26431, 5072720),
  makeBill(2020, 8, 26431, 5047060),
  makeBill(2020, 9, 26654, 3823870),
  makeBill(2020, 10, 21449, 2564540),
  makeBill(2020, 11, 36727, 4774520),
  makeBill(2020, 12, 40399, 5005790),
  makeBill(2020, 1, 64915, 6256370),
  makeBill(2020, 2, 58327, 5702750),
  makeBill(2021, 3, 48751, 5521820),
  makeBill(2021, 4, 34222, 3806160),
  makeBill(2021, 5, 24408, 2917420),
  makeBill(2021, 6, 24430, 3428820),
  makeBill(2021, 7, 27871, 4351560),
  makeBill(2021, 8, 14213, 2346070),
  makeBill(2021, 9, 31241, 4255740),
  makeBill(2021, 10, 23062, 2856770),
  makeBill(2021, 11, 44525, 5547180),
  makeBill(2021, 12, 57082, 6438240),
  makeBill(2021, 1, 68738, 6943420),
  makeBill(2021, 2, 62561, 6481680),
  makeBill(2022, 3, 54655, 6752250),
  makeBill(2022, 4, 50018, 5631400),
  makeBill(2022, 5, 20146, 2419980),
  makeBill(2022, 6, 24660, 3378380),
  makeBill(2022, 7, 33098, 5237090),
  makeBill(2022, 8, 20354, 3615750),
  makeBill(2022, 9, 33602, 4953540),
  makeBill(2022, 10, 25711, 3710390),
  makeBill(2022, 11, 33660, 4814960),
  makeBill(2022, 12, 54914, 7439850),
  makeBill(2022, 1, 78070, 9080280),
  makeBill(2022, 2, 63936, 8340570),
  makeBill(2023, 3, 33142, 5651940),
  makeBill(2023, 4, 34178, 5224890),
  makeBill(2023, 5, 22277, 3271870),
  makeBill(2023, 6, 28058, 4829480),
  makeBill(2023, 7, 34927, 6253410),
  makeBill(2023, 8, 30556, 6318670),
  makeBill(2023, 9, 44201, 7902660),
  makeBill(2023, 10, 21413, 3735330),
  makeBill(2023, 11, 34243, 6309560),
  makeBill(2023, 12, 46778, 7458460),
  makeBill(2023, 1, 56218, 8695590),
  makeBill(2023, 2, 35129, 5432380),
  makeBill(2024, 3, 41256, 7011950),
  makeBill(2024, 4, 36281, 5785250),
  makeBill(2024, 5, 26597, 4112350),
  makeBill(2024, 6, 32911, 5748830),
  makeBill(2024, 7, 35402, 6531030),
  makeBill(2024, 8, 29146, 5741040),
  makeBill(2024, 9, 60559, 10798130),
  makeBill(2024, 10, 27850, 5158600),
  makeBill(2024, 11, 36612, 7657540),
  makeBill(2024, 12, 66672, 10114850),
  makeBill(2024, 1, 76745, 11203270),
  makeBill(2024, 2, 41443, 6952290),
  makeBill(2025, 3, 57139, 9529880),
  makeBill(2025, 4, 48254, 7781700),
  {
    ...makeBill(2025, 5, 29232, 4890370),
    maxDemandKw: 510,
    note: '계획서 2025년 5월 기준값',
  },
]

export const defaultSchoolProfile: SchoolProfile = {
  schoolName: 'A고등학교',
  displaySchoolName: 'A고등학교',
  customerNumber: '01-****-4322',
  address: '서울특별시 강서구 ****',
  kepcoBranch: '강서양천지사',
  contractType: '교육용(갑)',
  voltageType: '고압A',
  currentPlan: '선택요금Ⅱ',
  contractPowerKw: 900,
  appliedPowerKw,
  managerName: '에너지 담당자',
  managerPhone: '02-****-9609',
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
