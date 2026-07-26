import type { WorkbookParseResult } from './excel'
import type {
  AutoDiagnosisResult,
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

const matches = (value: string, expected: string) =>
  value.trim().replace(/\s/g, '') === expected.trim().replace(/\s/g, '')

const describePeriodIssue = (code: string, period?: string) => {
  const periodLabel = period ? `${period} 고지서 기간` : '고지서 기간'
  if (code === 'duplicate-period') return `${periodLabel}이 중복되었습니다.`
  if (code === 'missing-period') return `${periodLabel}이 누락되었습니다.`
  return `${periodLabel}이 올바르지 않습니다.`
}

export const findCurrentPlan = (
  profile: SchoolProfile,
  ratePlans: RatePlan[],
) => {
  if (!ratePlans.length) {
    throw new Error('요금제 설정이 비어 있어 자동진단을 실행할 수 없습니다.')
  }
  const exact = findExactRatePlan(profile, ratePlans)
  if (exact) return exact

  return (
    ratePlans.find(
      (plan) =>
        matches(plan.contractType, profile.contractType) &&
        matches(plan.voltageType, profile.voltageType),
    ) ?? ratePlans[0]
  )
}

export const findExactRatePlan = (
  profile: SchoolProfile,
  ratePlans: RatePlan[],
) =>
  ratePlans.find(
    (plan) =>
      matches(plan.contractType, profile.contractType) &&
      matches(plan.voltageType, profile.voltageType) &&
      matches(plan.planName, profile.currentPlan),
  ) ?? null

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

const getBillAdjustmentRatio = (bill: MonthlyBill) => {
  const base = bill.baseChargeWon + bill.energyChargeWon
  if (base <= 0) return 0.137
  const knownAdjustments =
    bill.powerFactorChargeWon +
    bill.climateChargeWon +
    bill.fuelAdjustmentWon +
    bill.vatWon +
    bill.fundWon
  return clamp(knownAdjustments / base, -0.2, 0.35)
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
  const ratio = getBillAdjustmentRatio(bill)

  const originalCurrentEnergy =
    bill.energyChargeWon || bill.usageKwh * currentPlan.seasonRates[season]
  const adjustedCurrentEnergy = adjustedUsage * currentPlan.seasonRates[season]
  const currentBase = billingPowerKw * currentPlan.baseRateWonPerKw
  const candidateBase = billingPowerKw * candidatePlan.baseRateWonPerKw
  const candidateEnergy = adjustedUsage * candidatePlan.seasonRates[season]

  const scenarioCurrent = Math.max(
    0,
    bill.totalBillWon + (adjustedCurrentEnergy - originalCurrentEnergy) * (1 + ratio),
  )
  const delta =
    candidateBase -
    currentBase +
    candidateEnergy -
    adjustedCurrentEnergy

  return Math.max(0, Math.round(scenarioCurrent + delta * (1 + ratio)))
}

const estimateCurrentBillByMode = (
  bill: MonthlyBill,
  currentPlan: RatePlan,
  scenario: PeakScenario | undefined,
  mode: CalculationMode,
) => {
  if (mode === 'tariffFull') return estimateBillForPlan(bill, currentPlan, scenario)

  const season = getSeason(bill.month)
  const ratio = getBillAdjustmentRatio(bill)
  const adjustedUsage = getAdjustedUsage(bill, scenario)
  const originalCurrentEnergy =
    bill.energyChargeWon || bill.usageKwh * currentPlan.seasonRates[season]
  const adjustedCurrentEnergy = adjustedUsage * currentPlan.seasonRates[season]
  return Math.max(
    0,
    Math.round(bill.totalBillWon + (adjustedCurrentEnergy - originalCurrentEnergy) * (1 + ratio)),
  )
}

const estimateCandidateBillByMode = (
  bill: MonthlyBill,
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario: PeakScenario | undefined,
  mode: CalculationMode,
) => {
  if (mode === 'tariffFull') return estimateBillForPlan(bill, candidatePlan, scenario)
  return estimateBillDeltaForPlan(bill, currentPlan, candidatePlan, scenario)
}

const buildCalculationBreakdown = (
  recentBills: MonthlyBill[],
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario: PeakScenario | undefined,
  mode: CalculationMode,
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
      note: '요금적용전력과 예상 피크값 중 큰 값을 기준으로 kW 단가를 비교합니다.',
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
        mode === 'billDelta'
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
  scenario?: PeakScenario,
  mode: CalculationMode = 'billDelta',
): PlanCandidateComparison => {
  const validation = validateBillPeriods(bills, 36)
  const recent12 = validation.recentConsecutiveBills.slice(-12)
  const hasTwelveConsecutiveMonths = recent12.length >= 12
  const threeYearBills = validation.hasRequiredConsecutiveMonths
    ? validation.recentConsecutiveBills.slice(-36)
    : []

  const currentAnnualWon = recent12.reduce(
    (sum, bill) => sum + estimateCurrentBillByMode(bill, currentPlan, scenario, mode),
    0,
  )
  const candidateAnnualWon = recent12.reduce(
    (sum, bill) =>
      sum + estimateCandidateBillByMode(bill, currentPlan, candidatePlan, scenario, mode),
    0,
  )
  const savingWon = currentAnnualWon - candidateAnnualWon
  const savingRate = currentAnnualWon ? savingWon / currentAnnualWon : 0
  const threeYearSavingWon = threeYearBills.reduce(
    (sum, bill) =>
      sum +
      estimateCurrentBillByMode(bill, currentPlan, scenario, mode) -
      estimateCandidateBillByMode(bill, currentPlan, candidatePlan, scenario, mode),
    0,
  )

  const peakScenarioSavingWon = scenario ? savingWon : 0
  const calculationBreakdown = buildCalculationBreakdown(
    recent12,
    currentPlan,
    candidatePlan,
    scenario,
    mode,
    currentAnnualWon,
    candidateAnnualWon,
  )

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
    threeYearSavingWon,
    fiveYearSavingWon: savingWon * 5,
    recommendation,
    basis,
    candidatePlanId: candidatePlan.id,
    candidatePlanName: candidatePlan.planName,
    contractType: candidatePlan.contractType,
    voltageType: candidatePlan.voltageType,
    sameContractPriority: false,
    peakScenarioSavingWon,
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
  mode = 'billDelta',
}: {
  bills: MonthlyBill[]
  profile: SchoolProfile
  ratePlans: RatePlan[]
  scenario: PeakScenario
  powerPlannerDataSource?: PowerPlannerDataSource | null
  mode?: CalculationMode
}): AutoDiagnosisResult => {
  const periodValidation = validateBillPeriods(bills, 12)
  const normalizedBills = periodValidation.normalizedBills
  const currentPlan = findCurrentPlan(profile, ratePlans)
  const schoolPlans = ratePlans.filter((plan) => plan.contractType.includes('교육용'))
  const candidates = schoolPlans.filter((plan) => plan.id !== currentPlan.id)
  const ranked = candidates
    .map((candidate) => {
      const sameContractPriority =
        matches(candidate.contractType, profile.contractType) &&
        matches(candidate.voltageType, profile.voltageType)
      const comparison = comparePlansForDiagnosis(
        normalizedBills,
        currentPlan,
        candidate,
        scenario,
        mode,
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

  const topCandidates = ranked.slice(0, 3)
  const comparison =
    topCandidates[0] ??
    comparePlansForDiagnosis(normalizedBills, currentPlan, currentPlan, scenario, mode)
  const recommendedPlan =
    ratePlans.find((plan) => plan.id === comparison.candidatePlanId) ?? currentPlan
  const confidence = assessDataConfidence(normalizedBills)
  const recentBills = periodValidation.recentConsecutiveBills.slice(-12)
  const lastBill = recentBills.at(-1)
  const canGenerateChangeDocuments =
    periodValidation.hasRequiredConsecutiveMonths &&
    comparison.sameContractPriority &&
    comparison.recommendation === '변경 추천'
  const documentBlockReason = canGenerateChangeDocuments
    ? ''
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
    completed: periodValidation.hasRequiredConsecutiveMonths,
    currentPlan,
    recommendedPlan,
    topCandidates,
    additionalCandidates: ranked.filter((candidate) => !candidate.sameContractPriority),
    comparison,
    calculationMode: mode,
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
    finalJudgement: comparison.recommendation,
    judgementBasis: comparison.basis,
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
