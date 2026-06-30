export type ViewKey =
  | 'dashboard'
  | 'diagnosis'
  | 'school'
  | 'bills'
  | 'powerPlanner'
  | 'rates'
  | 'peak'
  | 'docs'
  | 'settings'

export type Recommendation = '변경 추천' | '유지 추천' | '추가 검토 필요'

export type Season = 'springAutumn' | 'summer' | 'winter'

export type CalculationMode = 'billDelta' | 'tariffFull'

export type DataConfidence = '데이터 충분' | '보통' | '낮음'

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

export type DataSourceProvider =
  | 'kepco-bill'
  | 'kepco-power-planner'
  | 'manual'

export type PowerPlannerDataType =
  | 'monthlyUsage'
  | 'dailyUsage'
  | 'hourlyUsage'
  | 'maxDemand'
  | 'estimatedBill'
  | 'patternAnalysis'

export interface DataSource<TRecord> {
  id: string
  provider: DataSourceProvider
  sourceName: string
  sourceLabel: string
  importedAt: string
  records: TRecord[]
  memo: string
}

export interface PowerPlannerRecord {
  id: string
  dataType: PowerPlannerDataType
  date?: string
  year?: number
  month?: number
  day?: number
  hour?: number
  usageKwh?: number
  maxDemandKw?: number
  estimatedBillWon?: number
  contractPowerKw?: number
  appliedPowerKw?: number
  usageDays?: number
  laggingPowerFactorPercent?: number
  leadingPowerFactorPercent?: number
  loadType?: string
  patternLabel?: string
  patternSummary?: string
  sourceRowIndex: number
}

export type PowerPlannerDataSource = DataSource<PowerPlannerRecord>

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
  mainBuildingEhpGroups?: number
  annexEhpGroups?: number
  auditoriumCooling?: boolean
  cafeteriaHighPowerTime?: string
  specialRoomTime?: string
  exemptSpaces?: string
}

export interface DocumentBundle {
  planText: string
  kepcoLetterText: string
  applicationPreviewData: Record<string, string>
  checklist: Array<{ label: string; ready: boolean }>
  calculationSummaryText: string
  reviewItems: string[]
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

export interface PlanCandidateComparison extends PlanComparison {
  candidatePlanId: string
  candidatePlanName: string
  contractType: string
  voltageType: string
  sameContractPriority: boolean
  peakScenarioSavingWon: number
  calculationMode: CalculationMode
  reviewReason: string
}

export interface AutoDiagnosisResult {
  completed: boolean
  currentPlan: RatePlan
  recommendedPlan: RatePlan
  topCandidates: PlanCandidateComparison[]
  additionalCandidates: PlanCandidateComparison[]
  comparison: PlanCandidateComparison
  calculationMode: CalculationMode
  dataConfidence: DataConfidence
  dataRecognitionRate: number
  recognizedMonths: number
  lastUploadLabel: string
  availableDocumentCount: number
  finalJudgement: Recommendation
  judgementBasis: string
  missingDataNotes: string[]
}

export interface UploadRecognitionSummary {
  sheetNames: string[]
  recognizedYears: number[]
  requiredColumns: string[]
  optionalColumns: string[]
  missingRequiredColumns: string[]
  mappingConfidence: number
  canAnalyze: boolean
  guidance: string
}
