import type {
  MonthlyBill,
  PeakScenario,
  PlanComparison,
  RatePlan,
  Recommendation,
  Season,
} from '../types'

const fiscalMonthOrder = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]

export const formatWon = (value: number) =>
  `${Math.round(value).toLocaleString('ko-KR')}원`

export const formatKwh = (value: number) =>
  `${Math.round(value).toLocaleString('ko-KR')}kWh`

export const getFiscalMonthIndex = (month: number) => {
  const index = fiscalMonthOrder.indexOf(month)
  return index === -1 ? month : index + 1
}

export const sortBillsChronologically = (bills: MonthlyBill[]) =>
  [...bills].sort((a, b) => {
    const aKey = a.year * 100 + getFiscalMonthIndex(a.month)
    const bKey = b.year * 100 + getFiscalMonthIndex(b.month)
    return aKey - bKey
  })

export const getSeason = (month: number): Season => {
  if ([6, 7, 8].includes(month)) return 'summer'
  if ([11, 12, 1, 2].includes(month)) return 'winter'
  return 'springAutumn'
}

export const getSeasonLabel = (season: Season) => {
  if (season === 'summer') return '여름철'
  if (season === 'winter') return '겨울철'
  return '봄·가을철'
}

export const getRecentBills = (bills: MonthlyBill[], count: number) =>
  sortBillsChronologically(bills).slice(-count)

export const getBillsByFiscalYears = (bills: MonthlyBill[], years: number) => {
  const sorted = sortBillsChronologically(bills)
  return sorted.slice(Math.max(0, sorted.length - years * 12))
}

export const estimateBillForPlan = (
  bill: MonthlyBill,
  plan: RatePlan,
  scenario?: PeakScenario,
) => {
  const season = getSeason(bill.month)
  const generalIncrease = scenario?.usageIncreasePercent ?? 0
  const seasonalIncrease =
    season === 'summer'
      ? (scenario?.summerIncreasePercent ?? generalIncrease)
      : season === 'winter'
        ? (scenario?.winterIncreasePercent ?? generalIncrease)
        : generalIncrease
  const usageKwh = bill.usageKwh * (1 + seasonalIncrease / 100)
  const billingPowerKw = scenario?.expectedPeakKw
    ? Math.max(bill.appliedPowerKw, scenario.expectedPeakKw)
    : bill.appliedPowerKw
  const baseChargeWon = billingPowerKw * plan.baseRateWonPerKw
  const energyChargeWon = usageKwh * plan.seasonRates[season]
  const climateChargeWon = usageKwh * 9
  const fuelAdjustmentWon = usageKwh * -5
  const subtotal =
    baseChargeWon + energyChargeWon + climateChargeWon + fuelAdjustmentWon
  const vatWon = subtotal * 0.1
  const fundWon = subtotal * 0.037

  return Math.max(0, Math.round(subtotal + vatWon + fundWon))
}

export const calculateUsageHours = (bill: MonthlyBill) => {
  if (!bill.appliedPowerKw) return 0
  return bill.usageKwh / bill.appliedPowerKw
}

export const comparePlans = (
  bills: MonthlyBill[],
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario?: PeakScenario,
): PlanComparison => {
  const recent12 = getRecentBills(bills, 12)
  if (recent12.length < 12) {
    return {
      currentAnnualWon: 0,
      candidateAnnualWon: 0,
      savingWon: 0,
      savingRate: 0,
      threeYearSavingWon: 0,
      fiveYearSavingWon: 0,
      recommendation: '추가 검토 필요',
      basis: '12개월 이상 자료가 부족하여 보수적으로 추가 검토 필요로 표시',
    }
  }

  const currentAnnualWon = recent12.reduce(
    (sum, bill) => sum + estimateBillForPlan(bill, currentPlan, scenario),
    0,
  )
  const candidateAnnualWon = recent12.reduce(
    (sum, bill) => sum + estimateBillForPlan(bill, candidatePlan, scenario),
    0,
  )
  const savingWon = currentAnnualWon - candidateAnnualWon
  const savingRate = currentAnnualWon ? savingWon / currentAnnualWon : 0
  const threeYearBills = getBillsByFiscalYears(bills, 3)
  const threeYearSavingWon = threeYearBills.reduce(
    (sum, bill) =>
      sum +
      estimateBillForPlan(bill, currentPlan, scenario) -
      estimateBillForPlan(bill, candidatePlan, scenario),
    0,
  )
  const fiveYearSavingWon = savingWon * 5

  let recommendation: Recommendation = '추가 검토 필요'
  if (savingWon < 0) recommendation = '유지 추천'
  else if (savingWon > 1_000_000 && savingRate >= 0.03 && threeYearSavingWon > 0)
    recommendation = '변경 추천'

  const basis =
    recommendation === '변경 추천'
      ? '최근 12개월과 최근 3년 추정 모두 절감으로 표시됨'
      : recommendation === '유지 추천'
        ? '변경안 적용 시 비용 증가로 추정됨'
        : '절감폭 또는 피크 시나리오 민감도가 있어 담당자 추가 검토 필요'

  return {
    currentAnnualWon,
    candidateAnnualWon,
    savingWon,
    savingRate,
    threeYearSavingWon,
    fiveYearSavingWon,
    recommendation,
    basis,
  }
}

export const getDashboardSummary = (
  bills: MonthlyBill[],
  currentPlan: RatePlan,
  candidatePlan: RatePlan,
  scenario?: PeakScenario,
) => {
  const sorted = sortBillsChronologically(bills)
  const latest = sorted.at(-1)
  const latestYear = latest?.year ?? new Date().getFullYear()
  const yearBills = sorted.filter((bill) => bill.year === latestYear)
  const previousYearBills = sorted.filter((bill) => bill.year === latestYear - 1)
  const currentYearTotal = yearBills.reduce(
    (sum, bill) => sum + bill.totalBillWon,
    0,
  )
  const previousComparable = previousYearBills
    .filter((bill) => yearBills.some((current) => current.month === bill.month))
    .reduce((sum, bill) => sum + bill.totalBillWon, 0)
  const yoyRate = previousComparable
    ? (currentYearTotal - previousComparable) / previousComparable
    : 0
  const comparison = comparePlans(bills, currentPlan, candidatePlan, scenario)
  const peakRisk =
    scenario && scenario.targetPeakKw
      ? scenario.expectedPeakKw / scenario.targetPeakKw
      : latest
        ? latest.maxDemandKw / latest.appliedPowerKw
        : 0

  return {
    latest,
    latestYear,
    currentYearTotal,
    previousComparable,
    yoyRate,
    comparison,
    peakRisk,
  }
}

export const groupBillsForCharts = (bills: MonthlyBill[]) => {
  const sorted = sortBillsChronologically(bills)
  const latest = sorted.at(-1)
  const latestYear = latest?.year ?? 2025
  const priorYear = latestYear - 1
  const byMonth = fiscalMonthOrder.map((month) => {
    const current = sorted.find(
      (bill) => bill.year === latestYear && bill.month === month,
    )
    const prior = sorted.find(
      (bill) => bill.year === priorYear && bill.month === month,
    )
    return {
      month: `${month}월`,
      currentBill: current?.totalBillWon ?? null,
      priorBill: prior?.totalBillWon ?? null,
      currentUsage: current?.usageKwh ?? null,
      priorUsage: prior?.usageKwh ?? null,
      currentDemand: current?.maxDemandKw ?? null,
      priorDemand: prior?.maxDemandKw ?? null,
    }
  })

  return { latestYear, priorYear, byMonth }
}
