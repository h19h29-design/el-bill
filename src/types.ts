export type ViewKey =
  | 'dashboard'
  | 'easyDiagnosis'
  | 'diagnosis'
  | 'school'
  | 'bills'
  | 'powerPlanner'
  | 'rates'
  | 'peak'
  | 'docs'
  | 'settings'
  | 'guide'

export type Recommendation = '변경 추천' | '유지 추천' | '추가 검토 필요'

export type Season = 'springAutumn' | 'summer' | 'winter'

export type CalculationMode = 'billDelta' | 'tariffFull'

export interface CalculationSettings {
  mode: CalculationMode
  climateEnvironmentWonPerKwh: number
  fuelAdjustmentWonPerKwh: number
  vatPercent: number
  fundPercent: number
}

export type DataConfidence = '데이터 충분' | '보통' | '낮음'

export type BillDataOrigin = 'sample' | 'uploaded' | 'pasted' | 'manual'

export type PowerPlannerDataOrigin = 'none' | 'sample' | 'uploaded'

export interface DataProvenance {
  bills: BillDataOrigin
  powerPlanner: PowerPlannerDataOrigin
}

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
  observedFields: MonthlyBillObservedField[]
}

export type MonthlyBillObservedField =
  | 'year'
  | 'month'
  | 'usageKwh'
  | 'totalBillWon'
  | 'appliedPowerKw'
  | 'maxDemandKw'
  | 'baseChargeWon'
  | 'energyChargeWon'
  | 'powerFactorChargeWon'
  | 'climateChargeWon'
  | 'fuelAdjustmentWon'
  | 'vatWon'
  | 'fundWon'

const observedBillFields = new Set<MonthlyBillObservedField>([
  'year',
  'month',
  'usageKwh',
  'totalBillWon',
  'appliedPowerKw',
  'maxDemandKw',
  'baseChargeWon',
  'energyChargeWon',
  'powerFactorChargeWon',
  'climateChargeWon',
  'fuelAdjustmentWon',
  'vatWon',
  'fundWon',
])

export const getObservedBillFields = (
  bill: { observedFields?: unknown },
): MonthlyBillObservedField[] =>
  Array.isArray(bill.observedFields)
    ? bill.observedFields.filter(
        (field): field is MonthlyBillObservedField =>
          typeof field === 'string' && observedBillFields.has(field as MonthlyBillObservedField),
      )
    : []

export const hasObservedBillField = (
  bill: { observedFields?: unknown },
  field: MonthlyBillObservedField,
) => getObservedBillFields(bill).includes(field)

export interface BillImportContext {
  appliedPowerKw: number
  currentPlan: RatePlan
}

export type BillPeriodIssueCode =
  | 'invalid-period'
  | 'duplicate-period'
  | 'missing-period'

export interface BillPeriodIssue {
  code: BillPeriodIssueCode
  period?: string
  message: string
}

export interface BillPeriodValidation {
  normalizedBills: MonthlyBill[]
  distinctMonthCount: number
  recentConsecutiveBills: MonthlyBill[]
  hasRequiredConsecutiveMonths: boolean
  issues: BillPeriodIssue[]
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
  calculationBreakdown: CalculationBreakdownRow[]
  reviewItems: string[]
}

export interface PlanComparison {
  currentAnnualWon: number
  candidateAnnualWon: number
  savingWon: number
  savingRate: number
  annualDataAvailable: boolean
  currentThreeYearWon: number
  candidateThreeYearWon: number
  threeYearSavingWon: number
  threeYearDataAvailable: boolean
  fiveYearSavingWon: number
  peakScenarioCurrentAnnualWon: number
  peakScenarioCandidateAnnualWon: number
  peakScenarioSavingWon: number
  peakScenarioDataAvailable: boolean
  recommendation: Recommendation
  basis: string
}

export interface CalculationBreakdownRow {
  label: string
  currentWon: number
  candidateWon: number
  differenceWon: number
  note: string
}

export interface PlanCandidateComparison extends PlanComparison {
  candidatePlanId: string
  candidatePlanName: string
  contractType: string
  voltageType: string
  sameContractPriority: boolean
  calculationMode: CalculationMode
  calculationBreakdown: CalculationBreakdownRow[]
  reviewReason: string
}

export interface AutoDiagnosisResult {
  completed: boolean
  configurationRequired: boolean
  currentPlan: RatePlan | null
  recommendedPlan: RatePlan | null
  topCandidates: PlanCandidateComparison[]
  additionalCandidates: PlanCandidateComparison[]
  comparison: PlanCandidateComparison
  calculationMode: CalculationMode
  calculationSettings: CalculationSettings
  dataConfidence: DataConfidence
  dataRecognitionRate: number
  recognizedMonths: number
  lastUploadLabel: string
  availableDocumentCount: number
  canGenerateChangeDocuments: boolean
  documentBlockReason: string
  finalJudgement: Recommendation
  judgementBasis: string
  missingDataNotes: string[]
}

export interface UploadRecognitionSummary {
  sheetNames: string[]
  recognizedYears: number[]
  recognizedRecordCount: number
  requiredColumns: string[]
  optionalColumns: string[]
  missingRequiredColumns: string[]
  invalidRequiredValues: string[]
  mappingConfidence: number
  canAnalyze: boolean
  guidance: string
}
