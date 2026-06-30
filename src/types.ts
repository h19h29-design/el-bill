export type ViewKey =
  | 'dashboard'
  | 'school'
  | 'bills'
  | 'rates'
  | 'peak'
  | 'docs'
  | 'settings'

export type Recommendation = '변경 추천' | '유지 추천' | '추가 검토 필요'

export type Season = 'springAutumn' | 'summer' | 'winter'

export interface SchoolProfile {
  schoolName: string
  displaySchoolName: string
  customerNumber: string
  address: string
  kepcoBranch: string
  contractType: string
  voltageType: string
  currentPlan: string
  contractPowerKw: number
  appliedPowerKw: number
  managerName: string
  managerPhone: string
  dataCreatedAt: string
  dataExpiresAt: string
}

export interface MonthlyBill {
  id: string
  year: number
  month: number
  usageKwh: number
  totalBillWon: number
  baseChargeWon: number
  energyChargeWon: number
  appliedPowerKw: number
  maxDemandKw: number
  powerFactorChargeWon: number
  climateChargeWon: number
  fuelAdjustmentWon: number
  vatWon: number
  fundWon: number
  note: string
}

export interface RatePlan {
  id: string
  contractType: string
  voltageType: string
  planName: string
  baseRateWonPerKw: number
  seasonRates: Record<Season, number>
  lightLoadRate?: number
  midLoadRate?: number
  peakLoadRate?: number
  effectiveFrom: string
  memo: string
}

export interface PeakScenario {
  targetPeakKw: number
  expectedPeakKw: number
  usageIncreasePercent: number
  summerIncreasePercent: number
  winterIncreasePercent: number
  analysisYear: number
  memo: string
}

export interface DocumentBundle {
  planText: string
  kepcoLetterText: string
  applicationPreviewData: Record<string, string>
  checklist: Array<{ label: string; ready: boolean }>
}

export interface PlanComparison {
  currentAnnualWon: number
  candidateAnnualWon: number
  savingWon: number
  savingRate: number
  threeYearSavingWon: number
  fiveYearSavingWon: number
  recommendation: Recommendation
  basis: string
}
