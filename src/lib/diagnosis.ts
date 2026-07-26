import type { WorkbookParseResult } from './excel'
import type {
  AutoDiagnosisResult,
  CalculationSettings,
  CalculationMode,
  CalculationBreakdownRow,
  DataConfidence,
  MonthlyBill,
  PeakScenario,
  PlanCandidateComparison,
  PowerPlannerDataSource,
  RatePlan,
  Recommendation,
  SchoolProfile,
  UploadRecognitionSummary,
} from '../types'
import { hasObservedBillField } from '../types'
import {
  estimateBillForPlan,
  getSeason,
} from './calculations'
import { validateBillPeriods } from './billPeriods'
import { rateChangeCaution } from './documentTemplates'
import {
  findUniqueRatePlanById,
  isValidMonthlyBill,
  isValidRatePlan,
  normalizeRatePlanIdentityPart,
  validateSchoolProfile,
  validateRatePlanCollection,
} from './domainValidation'

const optionalBillColumns = [
  '요금적용전력',
  '최대수요전력',
  '기본요금',
  '전력량요금',
  '역률요금',
  '기후환경요금',
  '연료비조정액',
  '부가세',
  '전력산업기반기금',
]

const normalizedOptionalBillColumns = [
  ['요금적용전력', 'appliedPowerKw'],
  ['최대수요전력', 'maxDemandKw'],
  ['기본요금', 'baseChargeWon'],
  ['전력량요금', 'energyChargeWon'],
  ['역률요금', 'powerFactorChargeWon'],
  ['기후환경요금', 'climateChargeWon'],
  ['연료비조정액', 'fuelAdjustmentWon'],
  ['부가세', 'vatWon'],
  ['전력산업기반기금', 'fundWon'],
] as const

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const ancillaryRatioBounds = {
  min: -0.2,
  max: 0.35,
} as const

const matches = (value: string, expected: string) =>
  normalizeRatePlanIdentityPart(value) ===
  normalizeRatePlanIdentityPart(expected)

const describePeriodIssue = (code: string, period?: string) => {
  const periodLabel = period ? `${period} 고지서 기간` : '고지서 기간'
  if (code === 'duplicate-period') return `${periodLabel}이 중복되었습니다.`
  if (code === 'missing-period') return `${periodLabel}이 누락되었습니다.`
  return `${periodLabel}이 올바르지 않습니다.`
}

export interface CurrentPlanResolution {
  plan: RatePlan | null
  exact: boolean
  issue?: string
}

export const resolveCurrentPlan = (
  profile: SchoolProfile,
  ratePlans: RatePlan[],
): CurrentPlanResolution => {
  const collectionValidation = validateRatePlanCollection(ratePlans)
  if (!collectionValidation.valid) {
    return {
      plan: null,
      exact: false,
      issue:
        collectionValidation.issues[0] ??
        '요금제 설정의 중복 또는 잘못된 값을 확인해 주세요.',
    }
  }
  const tupleMatches = ratePlans.filter(
    (candidate) =>
      matches(candidate.contractType, profile.contractType) &&
      matches(candidate.voltageType, profile.voltageType) &&
      matches(candidate.planName, profile.currentPlan),
  )
  const matchingPlans = tupleMatches.filter(isValidRatePlan)

  if (matchingPlans.length === 1) return { plan: matchingPlans[0], exact: true }

  return {
    plan: null,
    exact: false,
    issue:
      tupleMatches.length > 0 && matchingPlans.length === 0
        ? '현재 요금제 단가가 올바르지 않습니다. 요금표의 모든 필수 단가를 확인해 주세요.'
        : matchingPlans.length > 1
        ? '현재 요금제 설정이 중복됩니다. 요금표에서 계약종별·수전전압·요금제 조합을 하나만 남겨 주세요.'
        : '현재 요금제를 요금표에서 확인해 주세요.',
  }
}

export const findCurrentPlan = (
  profile: SchoolProfile,
  ratePlans: RatePlan[],
) => resolveCurrentPlan(profile, ratePlans).plan

export const findExactRatePlan = (
  profile: SchoolProfile,
  ratePlans: RatePlan[],
) => resolveCurrentPlan(profile, ratePlans).plan

const configurationRequiredMessage =
  '요금제 설정이 필요합니다. 현재 요금제를 요금표에서 확인해 주세요. 현재 프로필의 계약종별, 수전전압, 현재 요금제와 정확히 일치하는 요금제를 설정에서 확인해야 자동진단을 진행할 수 있습니다.'

const createConfigurationBlockedComparison = (
  profile: SchoolProfile,
  mode: CalculationMode,
): PlanCandidateComparison => ({
  currentAnnualWon: 0,
  candidateAnnualWon: 0,
  savingWon: 0,
  savingRate: 0,
  annualDataAvailable: false,
  currentThreeYearWon: 0,
  candidateThreeYearWon: 0,
  threeYearSavingWon: 0,
  threeYearDataAvailable: false,
  fiveYearSavingWon: 0,
  peakScenarioCurrentAnnualWon: 0,
  peakScenarioCandidateAnnualWon: 0,
  peakScenarioSavingWon: 0,
  peakScenarioDataAvailable: false,
  recommendation: '추가 검토 필요',
  basis: configurationRequiredMessage,
  candidatePlanId: '',
  candidatePlanName: '요금제 설정 필요',
  contractType: profile.contractType,
  voltageType: profile.voltageType,
  sameContractPriority: false,
  calculationMode: mode,
  calculationBreakdown: [],
  reviewReason: configurationRequiredMessage,
})

export const assessDataConfidence = (bills: MonthlyBill[]): DataConfidence => {
  const validation = validateBillPeriods(bills, 36)
  const recent36 = validation.recentConsecutiveBills.slice(-36)
  const hasDemand = recent36.length > 0 && recent36.every(
    (bill) =>
      bill.maxDemandKw > 0 && hasObservedBillField(bill, 'maxDemandKw'),
  )
  if (validation.hasRequiredConsecutiveMonths && hasDemand) return '데이터 충분'
  if (recent36.length >= 12) return '보통'
  return '낮음'
}

export const getDataRecognitionRate = (bills: MonthlyBill[]) => {
  if (!bills.length) return 0
  const maxScore = 6
  const score = bills.reduce((sum, bill) => {
    const requiredScore =
      Number(Boolean(bill.year)) +
      Number(Boolean(bill.month)) +
      Number(bill.usageKwh > 0) +
      Number(bill.totalBillWon > 0)
    const optionalScore =
      Number(
        bill.appliedPowerKw > 0 && hasObservedBillField(bill, 'appliedPowerKw'),
      ) +
      Number(
        bill.maxDemandKw > 0 && hasObservedBillField(bill, 'maxDemandKw'),
      )
    return sum + requiredScore + optionalScore
  }, 0)
  return Math.round((score / (bills.length * maxScore)) * 100)
}

const getObservedBillComponents = (
  bill: MonthlyBill,
  currentPlan: RatePlan,
) => {
  const season = getSeason(bill.month)
  const baseChargeWon =
    bill.baseChargeWon > 0 && hasObservedBillField(bill, 'baseChargeWon')
      ? bill.baseChargeWon
      : bill.appliedPowerKw * currentPlan.baseRateWonPerKw
  const energyChargeWon =
    bill.energyChargeWon > 0 && hasObservedBillField(bill, 'energyChargeWon')
      ? bill.energyChargeWon
      : bill.usageKwh * currentPlan.seasonRates[season]
  return { baseChargeWon, energyChargeWon }
}

const getBillAdjustmentRatio = (
  bill: MonthlyBill,
  currentPlan: RatePlan,
) => {
  const components = getObservedBillComponents(bill, currentPlan)
  const componentTotal =
    components.baseChargeWon + components.energyChargeWon
  if (componentTotal <= 0) return 0
  const residual = bill.totalBillWon - componentTotal
  return clamp(
    residual / componentTotal,
    ancillaryRatioBounds.min,
    ancillaryRatioBounds.max,
  )
}

const getAdjustedUsage = (bill: MonthlyBill, scenario?: PeakScenario) => {
  const season = getSeason(bill.month)
  const generalIncrease = scenario?.usageIncreasePercent ?? 0
  const seasonalIncrease =
    season === 'summer'
      ? (scenario?.summerIncreasePercent ?? generalIncrease)
      : season === 'winter'
        ? (scenario?.winterIncreasePercent ?? generalIncrease)
        : generalIncrease
  return bill.usageKwh * (1 + seasonalIncrease / 100)
}

const estimateBillDeltaForPlan = (
  bill: MonthlyBill,
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario?: PeakScenario,
) => {
  const season = getSeason(bill.month)
  const adjustedUsage = getAdjustedUsage(bill, scenario)
  const billingPowerKw = scenario?.expectedPeakKw
    ? Math.max(bill.appliedPowerKw, scenario.expectedPeakKw)
    : bill.appliedPowerKw
  const ratio = getBillAdjustmentRatio(bill, currentPlan)
  const observed = getObservedBillComponents(bill, currentPlan)
  const currentBase = scenario
    ? billingPowerKw * currentPlan.baseRateWonPerKw
    : observed.baseChargeWon
  const currentEnergy = scenario
    ? adjustedUsage * currentPlan.seasonRates[season]
    : observed.energyChargeWon
  const candidateBase = billingPowerKw * candidatePlan.baseRateWonPerKw
  const candidateEnergy = adjustedUsage * candidatePlan.seasonRates[season]

  const scenarioCurrent = scenario
    ? Math.max(
        0,
        bill.totalBillWon +
          (currentBase -
            observed.baseChargeWon +
            currentEnergy -
            observed.energyChargeWon) *
            (1 + ratio),
      )
    : bill.totalBillWon
  const delta =
    candidateBase -
    currentBase +
    candidateEnergy -
    currentEnergy

  return Math.max(0, Math.round(scenarioCurrent + delta * (1 + ratio)))
}

const estimateCurrentBillByMode = (
  bill: MonthlyBill,
  currentPlan: RatePlan,
  scenario: PeakScenario | undefined,
  settings: CalculationSettings,
) => {
  if (settings.mode === 'tariffFull') {
    return estimateBillForPlan(bill, currentPlan, scenario, settings)
  }
  if (!scenario) return bill.totalBillWon

  const season = getSeason(bill.month)
  const ratio = getBillAdjustmentRatio(bill, currentPlan)
  const observed = getObservedBillComponents(bill, currentPlan)
  const adjustedBase =
    Math.max(bill.appliedPowerKw, scenario.expectedPeakKw) *
    currentPlan.baseRateWonPerKw
  const adjustedEnergy =
    getAdjustedUsage(bill, scenario) * currentPlan.seasonRates[season]
  return Math.max(
    0,
    Math.round(
      bill.totalBillWon +
        (adjustedBase -
          observed.baseChargeWon +
          adjustedEnergy -
          observed.energyChargeWon) *
          (1 + ratio),
    ),
  )
}

const estimateCandidateBillByMode = (
  bill: MonthlyBill,
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario: PeakScenario | undefined,
  settings: CalculationSettings,
) => {
  if (settings.mode === 'tariffFull') {
    return estimateBillForPlan(bill, candidatePlan, scenario, settings)
  }
  return estimateBillDeltaForPlan(bill, currentPlan, candidatePlan, scenario)
}

const buildCalculationBreakdown = (
  recentBills: MonthlyBill[],
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario: PeakScenario | undefined,
  settings: CalculationSettings,
  currentAnnualWon: number,
  candidateAnnualWon: number,
): CalculationBreakdownRow[] => {
  const breakdown = recentBills.reduce(
    (acc, bill) => {
      const season = getSeason(bill.month)
      const adjustedUsage = getAdjustedUsage(bill, scenario)
      const billingPowerKw = scenario?.expectedPeakKw
        ? Math.max(bill.appliedPowerKw, scenario.expectedPeakKw)
        : bill.appliedPowerKw

      acc.currentBaseWon += billingPowerKw * currentPlan.baseRateWonPerKw
      acc.candidateBaseWon += billingPowerKw * candidatePlan.baseRateWonPerKw
      acc.currentEnergyWon += adjustedUsage * currentPlan.seasonRates[season]
      acc.candidateEnergyWon += adjustedUsage * candidatePlan.seasonRates[season]
      return acc
    },
    {
      currentBaseWon: 0,
      candidateBaseWon: 0,
      currentEnergyWon: 0,
      candidateEnergyWon: 0,
    },
  )
  const currentBaseWon = Math.round(breakdown.currentBaseWon)
  const candidateBaseWon = Math.round(breakdown.candidateBaseWon)
  const currentEnergyWon = Math.round(breakdown.currentEnergyWon)
  const candidateEnergyWon = Math.round(breakdown.candidateEnergyWon)
  const currentAdjustmentWon = Math.round(
    currentAnnualWon - currentBaseWon - currentEnergyWon,
  )
  const candidateAdjustmentWon = Math.round(
    candidateAnnualWon - candidateBaseWon - candidateEnergyWon,
  )
  const rows = [
    {
      label: '기본요금 차액',
      currentWon: currentBaseWon,
      candidateWon: candidateBaseWon,
      note: '최근 고지서의 요금적용전력을 기준으로 kW 단가를 비교합니다.',
    },
    {
      label: '전력량요금 차액',
      currentWon: currentEnergyWon,
      candidateWon: candidateEnergyWon,
      note: '월별 사용량과 계절별 전력량 단가를 반영합니다.',
    },
    {
      label: '부가요금/보정',
      currentWon: currentAdjustmentWon,
      candidateWon: candidateAdjustmentWon,
      note:
        settings.mode === 'billDelta'
          ? '기존 고지서의 부가세, 기금, 기후환경요금, 연료비조정 비율로 보정합니다.'
          : '요금표 기반 추정식의 부가요금 계수를 반영합니다.',
    },
    {
      label: '최근 12개월 합계',
      currentWon: currentAnnualWon,
      candidateWon: candidateAnnualWon,
      note: '공식 청구액이 아닌 학교 내부 진단용 추정 합계입니다.',
    },
  ]

  return rows.map((row) => ({
    ...row,
    differenceWon: row.currentWon - row.candidateWon,
  }))
}

export const comparePlansForDiagnosis = (
  bills: MonthlyBill[],
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario: PeakScenario | undefined,
  settings: CalculationSettings,
): PlanCandidateComparison => {
  const mode = settings.mode
  const validation = validateBillPeriods(bills, 36)
  const recent12 = validation.recentConsecutiveBills.slice(-12)
  const hasTwelveConsecutiveMonths = recent12.length >= 12
  const annualBills = hasTwelveConsecutiveMonths ? recent12 : []
  const threeYearBills = validation.hasRequiredConsecutiveMonths
    ? validation.recentConsecutiveBills.slice(-36)
    : []
  const hasValidScenario =
    Boolean(scenario) &&
    [
      scenario?.targetPeakKw,
      scenario?.expectedPeakKw,
      scenario?.usageIncreasePercent,
      scenario?.summerIncreasePercent,
      scenario?.winterIncreasePercent,
      scenario?.analysisYear,
    ].every((value) => typeof value === 'number' && Number.isFinite(value)) &&
    scenario!.targetPeakKw > 0 &&
    scenario!.expectedPeakKw > 0 &&
    scenario!.usageIncreasePercent >= -30 &&
    scenario!.usageIncreasePercent <= 100 &&
    scenario!.summerIncreasePercent >= -30 &&
    scenario!.summerIncreasePercent <= 100 &&
    scenario!.winterIncreasePercent >= -30 &&
    scenario!.winterIncreasePercent <= 100 &&
    scenario!.analysisYear >= 2020 &&
    scenario!.analysisYear <= 2035
  const peakScenarioDataAvailable =
    hasTwelveConsecutiveMonths && hasValidScenario
  const peakScenarioBills = peakScenarioDataAvailable ? annualBills : []

  const currentAnnualWon = annualBills.reduce(
    (sum, bill) =>
      sum + estimateCurrentBillByMode(bill, currentPlan, undefined, settings),
    0,
  )
  const candidateAnnualWon = annualBills.reduce(
    (sum, bill) =>
      sum +
      estimateCandidateBillByMode(
        bill,
        currentPlan,
        candidatePlan,
        undefined,
        settings,
      ),
    0,
  )
  const savingWon = currentAnnualWon - candidateAnnualWon
  const savingRate = currentAnnualWon ? savingWon / currentAnnualWon : 0
  const currentThreeYearWon = threeYearBills.reduce(
    (sum, bill) =>
      sum + estimateCurrentBillByMode(bill, currentPlan, undefined, settings),
    0,
  )
  const candidateThreeYearWon = threeYearBills.reduce(
    (sum, bill) =>
      sum +
      estimateCandidateBillByMode(
        bill,
        currentPlan,
        candidatePlan,
        undefined,
        settings,
      ),
    0,
  )
  const threeYearSavingWon = currentThreeYearWon - candidateThreeYearWon
  const peakScenarioCurrentAnnualWon = peakScenarioBills.reduce(
    (sum, bill) =>
      sum + estimateCurrentBillByMode(bill, currentPlan, scenario, settings),
    0,
  )
  const peakScenarioCandidateAnnualWon = peakScenarioBills.reduce(
    (sum, bill) =>
      sum +
      estimateCandidateBillByMode(
        bill,
        currentPlan,
        candidatePlan,
        scenario,
        settings,
      ),
    0,
  )
  const peakScenarioSavingWon =
    peakScenarioCurrentAnnualWon - peakScenarioCandidateAnnualWon
  const calculationBreakdown = hasTwelveConsecutiveMonths
    ? buildCalculationBreakdown(
        annualBills,
        currentPlan,
        candidatePlan,
        undefined,
        settings,
        currentAnnualWon,
        candidateAnnualWon,
      )
    : []

  let recommendation: Recommendation = '추가 검토 필요'
  if (!hasTwelveConsecutiveMonths) recommendation = '추가 검토 필요'
  else if (savingWon < 0) recommendation = '유지 추천'
  else if (savingWon > 0 && threeYearSavingWon > 0) recommendation = '변경 추천'

  const basis =
    !hasTwelveConsecutiveMonths
      ? '12개월 이상 월별 고지서 자료가 부족하여 추가 검토가 필요합니다.'
      : recommendation === '변경 추천'
        ? '최근 12개월과 최근 3년 기준이 모두 절감으로 추정됩니다.'
        : recommendation === '유지 추천'
          ? '변경 시 최근 12개월 기준 비용 증가가 추정됩니다.'
          : '절감액, 피크 민감도 또는 데이터 품질을 추가 확인해야 합니다.'

  return {
    currentAnnualWon,
    candidateAnnualWon,
    savingWon,
    savingRate,
    annualDataAvailable: hasTwelveConsecutiveMonths,
    currentThreeYearWon,
    candidateThreeYearWon,
    threeYearSavingWon,
    threeYearDataAvailable: threeYearBills.length === 36,
    fiveYearSavingWon: savingWon * 5,
    peakScenarioCurrentAnnualWon,
    peakScenarioCandidateAnnualWon,
    peakScenarioSavingWon,
    peakScenarioDataAvailable,
    recommendation,
    basis,
    candidatePlanId: candidatePlan.id,
    candidatePlanName: candidatePlan.planName,
    contractType: candidatePlan.contractType,
    voltageType: candidatePlan.voltageType,
    sameContractPriority: false,
    calculationMode: mode,
    calculationBreakdown,
    reviewReason: '',
  }
}

export const buildAutoDiagnosis = ({
  bills,
  profile,
  ratePlans,
  scenario,
  powerPlannerDataSource,
  billsAreUserUploaded = false,
  calculationSettings,
}: {
  bills: MonthlyBill[]
  profile: SchoolProfile
  ratePlans: RatePlan[]
  scenario: PeakScenario
  powerPlannerDataSource?: PowerPlannerDataSource | null
  billsAreUserUploaded?: boolean
  calculationSettings: CalculationSettings
}): AutoDiagnosisResult => {
  const mode = calculationSettings.mode
  const invalidBillCount = bills.filter(
    (bill) => !isValidMonthlyBill(bill),
  ).length
  if (invalidBillCount > 0) {
    const reason =
      `고지서 ${invalidBillCount.toLocaleString('ko-KR')}개 행의 필수 값이 올바르지 않습니다. ` +
      '연도·월·사용량·총 전기요금·요금적용전력과 요금 구성요소를 확인해 주세요.'
    const comparison = {
      ...createConfigurationBlockedComparison(profile, mode),
      candidatePlanName: '고지서 확인 필요',
      basis: reason,
      reviewReason: reason,
    }
    return {
      completed: false,
      configurationRequired: false,
      currentPlan: null,
      recommendedPlan: null,
      topCandidates: [],
      additionalCandidates: [],
      comparison,
      calculationMode: mode,
      calculationSettings,
      dataConfidence: '낮음',
      dataRecognitionRate: 0,
      recognizedMonths: 0,
      lastUploadLabel: '유효하지 않은 고지서 자료',
      availableDocumentCount: 0,
      canGenerateChangeDocuments: false,
      documentBlockReason: reason,
      finalJudgement: '추가 검토 필요',
      judgementBasis: reason,
      missingDataNotes: [reason, rateChangeCaution],
    }
  }
  const profileValidation = validateSchoolProfile(profile)
  if (!profileValidation.valid) {
    const reason =
      `학교 프로필이 올바르지 않습니다. ${
        profileValidation.issues[0] ??
        '학교명과 계약전력 정보를 확인해 주세요.'
      }`
    const comparison = {
      ...createConfigurationBlockedComparison(profile, mode),
      basis: reason,
      reviewReason: reason,
    }
    return {
      completed: false,
      configurationRequired: true,
      currentPlan: null,
      recommendedPlan: null,
      topCandidates: [],
      additionalCandidates: [],
      comparison,
      calculationMode: mode,
      calculationSettings,
      dataConfidence: '낮음',
      dataRecognitionRate: 0,
      recognizedMonths: 0,
      lastUploadLabel: '학교 프로필 확인 필요',
      availableDocumentCount: 0,
      canGenerateChangeDocuments: false,
      documentBlockReason: reason,
      finalJudgement: '추가 검토 필요',
      judgementBasis: reason,
      missingDataNotes: [reason, rateChangeCaution],
    }
  }
  const ratePlanCollectionValidation =
    validateRatePlanCollection(ratePlans)
  if (!ratePlanCollectionValidation.valid) {
    const reason =
      `요금제 설정이 올바르지 않습니다. ${
        ratePlanCollectionValidation.issues[0] ??
        '중복 식별값과 계약 조합을 확인해 주세요.'
      }`
    const comparison = {
      ...createConfigurationBlockedComparison(profile, mode),
      basis: reason,
      reviewReason: reason,
    }
    return {
      completed: false,
      configurationRequired: true,
      currentPlan: null,
      recommendedPlan: null,
      topCandidates: [],
      additionalCandidates: [],
      comparison,
      calculationMode: mode,
      calculationSettings,
      dataConfidence: '낮음',
      dataRecognitionRate: 0,
      recognizedMonths: 0,
      lastUploadLabel: '요금제 설정 확인 필요',
      availableDocumentCount: 0,
      canGenerateChangeDocuments: false,
      documentBlockReason: reason,
      finalJudgement: '추가 검토 필요',
      judgementBasis: reason,
      missingDataNotes: [reason, rateChangeCaution],
    }
  }
  const periodValidation = validateBillPeriods(bills, 12)
  const normalizedBills = periodValidation.normalizedBills
  const currentPlanResolution = resolveCurrentPlan(profile, ratePlans)
  const currentPlan = currentPlanResolution.plan
  const confidence = assessDataConfidence(normalizedBills)
  const recentBills = periodValidation.recentConsecutiveBills.slice(-12)
  const lastBill = recentBills.at(-1)

  if (!currentPlan) {
    const comparison = createConfigurationBlockedComparison(profile, mode)
    return {
      completed: false,
      configurationRequired: true,
      currentPlan: null,
      recommendedPlan: null,
      topCandidates: [],
      additionalCandidates: [],
      comparison,
      calculationMode: mode,
      calculationSettings,
      dataConfidence: confidence,
      dataRecognitionRate: getDataRecognitionRate(normalizedBills),
      recognizedMonths: periodValidation.distinctMonthCount,
      lastUploadLabel: powerPlannerDataSource
        ? `${powerPlannerDataSource.sourceLabel} · ${new Date(powerPlannerDataSource.importedAt).toLocaleString('ko-KR')}`
        : lastBill
          ? `${lastBill.year}년 ${lastBill.month}월 고지서`
          : '자료 없음',
      availableDocumentCount: 0,
      canGenerateChangeDocuments: false,
      documentBlockReason: configurationRequiredMessage,
      finalJudgement: '추가 검토 필요',
      judgementBasis: configurationRequiredMessage,
      missingDataNotes: [
        currentPlanResolution.issue ?? configurationRequiredMessage,
        configurationRequiredMessage,
        rateChangeCaution,
      ],
    }
  }

  const schoolPlans = ratePlans.filter(
    (plan) => plan.contractType.includes('교육용') && isValidRatePlan(plan),
  )
  const candidates = schoolPlans.filter((plan) => plan.id !== currentPlan.id)
  const hasPeriodIssues = periodValidation.issues.length > 0
  const hasAnnualData = periodValidation.hasRequiredConsecutiveMonths
  const periodIssueReason = hasPeriodIssues
    ? `고지서 기간 문제: ${periodValidation.issues
        .map((issue) => describePeriodIssue(issue.code, issue.period))
        .join(' ')}`
    : ''
  const rankedBeforePeriodReview = candidates
    .map((candidate) => {
      const sameContractPriority =
        matches(candidate.contractType, profile.contractType) &&
        matches(candidate.voltageType, profile.voltageType)
      const comparison = comparePlansForDiagnosis(
        normalizedBills,
        currentPlan,
        candidate,
        scenario,
        calculationSettings,
      )
      const eligibleComparison = sameContractPriority
        ? comparison
        : {
            ...comparison,
            recommendation: '추가 검토 필요' as const,
            basis:
              '계약종별 또는 수전전압이 현재 계약과 달라 한전 적용 가능 여부를 먼저 확인해야 합니다.',
          }
      return {
        ...eligibleComparison,
        sameContractPriority,
        reviewReason: sameContractPriority
          ? '현재 계약종별과 수전전압이 일치하는 우선 후보입니다.'
          : '다른 학교용 요금제로 계약 조건 확인 후 추가 검토가 필요합니다.',
      }
    })
    .sort(
      (a, b) =>
        Number(b.sameContractPriority) - Number(a.sameContractPriority) ||
        b.savingWon - a.savingWon,
    )

  const insufficientAnnualReason =
    '최근 12개월의 연속된 고지서 자료가 부족하여 요금제 추천을 확정할 수 없습니다.'
  const applyPeriodReview = (candidate: PlanCandidateComparison) =>
    hasPeriodIssues || !hasAnnualData
      ? {
          ...candidate,
          recommendation: '추가 검토 필요' as const,
          basis: hasPeriodIssues ? periodIssueReason : insufficientAnnualReason,
          reviewReason: hasPeriodIssues
            ? periodIssueReason
            : insufficientAnnualReason,
        }
      : candidate
  const ranked = rankedBeforePeriodReview.map(applyPeriodReview)
  const topCandidates = ranked.slice(0, 3)
  const fallbackComparison = applyPeriodReview(
    comparePlansForDiagnosis(
      normalizedBills,
      currentPlan,
      currentPlan,
      scenario,
      calculationSettings,
    ),
  )
  const comparison = topCandidates[0] ?? fallbackComparison
  const recommendedPlan =
    hasPeriodIssues ||
    !comparison.annualDataAvailable ||
    topCandidates.length === 0
      ? null
      : findUniqueRatePlanById(
          ratePlans,
          comparison.candidatePlanId,
        ) ?? currentPlan
  const hasValidRequiredPeriods =
    periodValidation.hasRequiredConsecutiveMonths && !hasPeriodIssues
  const canGenerateChangeDocuments =
    billsAreUserUploaded &&
    hasValidRequiredPeriods &&
    comparison.sameContractPriority &&
    comparison.recommendation === '변경 추천'
  const documentBlockReason = canGenerateChangeDocuments
    ? ''
    : hasPeriodIssues
      ? periodIssueReason
      : !comparison.annualDataAvailable
        ? `${insufficientAnnualReason} 변경신청 문서를 생성할 수 없습니다.`
      : !billsAreUserUploaded
        ? '사용자 고지서 업로드 후 생성 가능'
        : '최종 판단이 변경 추천이고 현재 계약종별·수전전압과 일치하는 후보인 경우에만 변경신청 문서를 생성할 수 있습니다.'
  const missingDataNotes = [
    ...(!periodValidation.hasRequiredConsecutiveMonths
      ? ['최근 12개월의 연속된 고지서 자료가 부족합니다.']
      : []),
    ...periodValidation.issues.map((issue) =>
      `고지서 기간 문제: ${describePeriodIssue(issue.code, issue.period)}`,
    ),
    ...(confidence !== '데이터 충분'
      ? ['36개월 이상 자료와 최대수요전력 컬럼이 있으면 신뢰도가 높아집니다.']
      : []),
    rateChangeCaution,
  ]

  return {
    completed: hasValidRequiredPeriods,
    configurationRequired: false,
    currentPlan,
    recommendedPlan,
    topCandidates,
    additionalCandidates: ranked.filter((candidate) => !candidate.sameContractPriority),
    comparison,
    calculationMode: mode,
    calculationSettings,
    dataConfidence: confidence,
    dataRecognitionRate: getDataRecognitionRate(normalizedBills),
    recognizedMonths: periodValidation.distinctMonthCount,
    lastUploadLabel: powerPlannerDataSource
      ? `${powerPlannerDataSource.sourceLabel} · ${new Date(powerPlannerDataSource.importedAt).toLocaleString('ko-KR')}`
      : lastBill
        ? `${lastBill.year}년 ${lastBill.month}월 고지서`
        : '자료 없음',
    availableDocumentCount: canGenerateChangeDocuments ? 6 : 2,
    canGenerateChangeDocuments,
    documentBlockReason,
    finalJudgement: hasPeriodIssues ? '추가 검토 필요' : comparison.recommendation,
    judgementBasis: hasPeriodIssues ? periodIssueReason : comparison.basis,
    missingDataNotes,
  }
}

export const summarizeWorkbookRecognition = (
  result: WorkbookParseResult | null,
  mapping: Record<string, string>,
): UploadRecognitionSummary | null => {
  if (!result) return null
  const rows = result.sheets.flatMap((sheet) => sheet.rows)
  const headers = Array.from(new Set(result.sheets.flatMap((sheet) => sheet.headers)))
  const mappedYears = Array.from(
    new Set(
      rows
        .map((row) => Number(row[mapping.year]))
        .filter((year) => Number.isFinite(year) && year > 1900),
    ),
  ).sort((a, b) => a - b)
  const requiredMap = [
    ['연도', mapping.year],
    ['월', mapping.month],
    ['사용량', mapping.usageKwh],
    ['총 전기요금', mapping.totalBillWon],
  ] as const
  const missingRequiredColumns = requiredMap
    .filter(([, key]) => !key)
    .map(([label]) => label)
  const mappedOptionalColumns = optionalBillColumns.filter((label) =>
    headers.some((header) => header.includes(label) || label.includes(header)),
  )
  const hasAutoRows = result.autoRows.length > 0
  const optionalColumns = hasAutoRows
    ? normalizedOptionalBillColumns
        .filter(([, key]) =>
          result.autoRows.some((bill) => hasObservedBillField(bill, key)),
        )
        .map(([label]) => label)
    : mappedOptionalColumns
  const recognizedYears = hasAutoRows
    ? Array.from(new Set(result.autoRows.map((bill) => bill.year))).sort((a, b) => a - b)
    : mappedYears
  const normalizedRequiredColumns = hasAutoRows
    ? requiredMap.map(([label]) => label)
    : requiredMap
        .filter(([, key]) => Boolean(key))
        .map(([label]) => label)
  const normalizedMissingRequiredColumns = hasAutoRows ? [] : missingRequiredColumns
  const mappingConfidence = hasAutoRows
    ? Math.min(
        99,
        Math.round(
          80 +
            (optionalColumns.length / normalizedOptionalBillColumns.length) * 19,
        ),
      )
    : Math.round(
        ((requiredMap.length - missingRequiredColumns.length) / requiredMap.length) * 100,
      )

  return {
    sheetNames: result.sheets.map((sheet) => sheet.name),
    recognizedYears,
    recognizedRecordCount: hasAutoRows ? result.autoRows.length : rows.length,
    requiredColumns: normalizedRequiredColumns,
    optionalColumns,
    missingRequiredColumns: normalizedMissingRequiredColumns,
    mappingConfidence,
    canAnalyze: normalizedMissingRequiredColumns.length === 0,
    guidance:
      hasAutoRows
        ? '파일 구조가 자동 인식되었습니다. 이 매핑으로 자동진단을 시작할 수 있습니다.'
        : missingRequiredColumns.length > 0
        ? '총 전기요금 또는 사용량 컬럼을 찾지 못했습니다. 컬럼을 직접 지정해주세요.'
        : '필수 컬럼이 인식되었습니다. 이 매핑으로 자동진단을 시작할 수 있습니다.',
  }
}
