import type {
  BillPeriodIssue,
  BillPeriodValidation,
  MonthlyBill,
} from '../types'

export const getCalendarMonthIndex = (year: number, month: number) =>
  year * 12 + (month - 1)

const formatPeriod = (year: number, month: number) => `${year}-${month}`

const isValidPeriod = (bill: MonthlyBill) =>
  Number.isInteger(bill.year) &&
  Number.isInteger(bill.month) &&
  bill.month >= 1 &&
  bill.month <= 12

export const validateBillPeriods = (
  bills: MonthlyBill[],
  requiredMonths = 12,
): BillPeriodValidation => {
  const issues: BillPeriodIssue[] = []
  const billsByPeriod = new Map<number, MonthlyBill[]>()

  for (const bill of bills) {
    if (!isValidPeriod(bill)) {
      issues.push({
        code: 'invalid-period',
        period: formatPeriod(bill.year, bill.month),
        message: `${formatPeriod(bill.year, bill.month)} billing period is invalid.`,
      })
      continue
    }

    const index = getCalendarMonthIndex(bill.year, bill.month)
    billsByPeriod.set(index, [...(billsByPeriod.get(index) ?? []), bill])
  }

  const uniqueBills = new Map<number, MonthlyBill>()
  for (const [index, periodBills] of billsByPeriod) {
    const [bill] = periodBills
    if (periodBills.length > 1) {
      const period = formatPeriod(bill.year, bill.month)
      issues.push({
        code: 'duplicate-period',
        period,
        message: `${period} billing period is duplicated.`,
      })
      continue
    }
    uniqueBills.set(index, bill)
  }

  const normalizedBills = [...uniqueBills.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bill]) => bill)
  const indexes = normalizedBills.map((bill) =>
    getCalendarMonthIndex(bill.year, bill.month),
  )

  for (let index = 1; index < indexes.length; index += 1) {
    const missingStart = indexes[index - 1] + 1
    const missingEnd = indexes[index] - 1
    if (missingStart > missingEnd) continue

    const startPeriod = formatPeriod(
      Math.floor(missingStart / 12),
      (missingStart % 12) + 1,
    )
    const endPeriod = formatPeriod(
      Math.floor(missingEnd / 12),
      (missingEnd % 12) + 1,
    )
    const period =
      startPeriod === endPeriod ? startPeriod : `${startPeriod} through ${endPeriod}`
    issues.push({
      code: 'missing-period',
      period,
      message: `${period} billing period is missing.`,
    })
  }

  const recentConsecutiveBills: MonthlyBill[] = []
  for (let index = normalizedBills.length - 1; index >= 0; index -= 1) {
    const bill = normalizedBills[index]
    const next = recentConsecutiveBills[0]
    if (
      next &&
      getCalendarMonthIndex(bill.year, bill.month) + 1 !==
        getCalendarMonthIndex(next.year, next.month)
    ) {
      break
    }
    recentConsecutiveBills.unshift(bill)
  }

  issues.sort(
    (left, right) =>
      `${left.code}:${left.period ?? ''}`.localeCompare(`${right.code}:${right.period ?? ''}`),
  )

  return {
    normalizedBills,
    distinctMonthCount: normalizedBills.length,
    recentConsecutiveBills,
    hasRequiredConsecutiveMonths: recentConsecutiveBills.length >= requiredMonths,
    issues,
  }
}
