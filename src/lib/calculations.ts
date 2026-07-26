import type {
  CalculationSettings,
  MonthlyBill,
  PeakScenario,
  RatePlan,
  Season,
} from '../types'
import { validateBillPeriods } from './billPeriods'

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
  validateBillPeriods(bills).normalizedBills

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
  validateBillPeriods(bills).normalizedBills.slice(-count)

export const getBillsByFiscalYears = (bills: MonthlyBill[], years: number) => {
  const sorted = validateBillPeriods(bills).normalizedBills
  return sorted.slice(Math.max(0, sorted.length - years * 12))
}

export const estimateBillForPlan = (
  bill: MonthlyBill,
  plan: RatePlan,
  scenario: PeakScenario | undefined,
  settings: CalculationSettings,
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
  const climateChargeWon =
    usageKwh * settings.climateEnvironmentWonPerKwh
  const fuelAdjustmentWon = usageKwh * settings.fuelAdjustmentWonPerKwh
  const subtotal =
    baseChargeWon + energyChargeWon + climateChargeWon + fuelAdjustmentWon
  const vatWon = subtotal * (settings.vatPercent / 100)
  const fundWon = subtotal * (settings.fundPercent / 100)

  return Math.max(0, Math.round(subtotal + vatWon + fundWon))
}

export const calculateUsageHours = (bill: MonthlyBill) => {
  if (!bill.appliedPowerKw) return 0
  return bill.usageKwh / bill.appliedPowerKw
}

export const getDashboardSummary = (
  bills: MonthlyBill[],
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
