import type { BillImportContext, MonthlyBill } from '../types'
import { validateBillPeriods } from './billPeriods'
import { mapRowsToBills, parseDelimitedMatrix, type ParsedSheet } from './excel'

export const standardBillCsvHeaders = [
  '연도',
  '월',
  '사용량(kWh)',
  '총 전기요금(원)',
  '요금적용전력(kW)',
  '최대수요전력(kW)',
  '기본요금(원)',
  '전력량요금(원)',
  '역률요금(원)',
  '기후환경요금(원)',
  '연료비조정액(원)',
  '부가세(원)',
  '전력산업기반기금(원)',
  '메모',
] as const

export type ManualBillDraftField =
  | 'yearMonth'
  | 'usageKwh'
  | 'totalBillWon'
  | 'maxDemandKw'
  | 'appliedPowerKw'
  | 'baseChargeWon'
  | 'energyChargeWon'
  | 'powerFactorChargeWon'
  | 'climateChargeWon'
  | 'fuelAdjustmentWon'
  | 'vatWon'
  | 'fundWon'
  | 'note'

export interface ManualBillDraftRow {
  id: string
  yearMonth: string
  usageKwh: string
  totalBillWon: string
  maxDemandKw: string
  appliedPowerKw: string
  baseChargeWon: string
  energyChargeWon: string
  powerFactorChargeWon: string
  climateChargeWon: string
  fuelAdjustmentWon: string
  vatWon: string
  fundWon: string
  note: string
}

export interface BillInputIssue {
  rowId: string
  field: ManualBillDraftField | 'period'
  message: string
}

export interface BillInputValidation {
  bills: MonthlyBill[]
  issues: BillInputIssue[]
}

const mappingLabels = {
  year: '연도',
  month: '월',
  usageKwh: '사용량',
  totalBillWon: '총',
  appliedPowerKw: '요금적용전력',
  maxDemandKw: '최대수요전력',
  baseChargeWon: '기본요금',
  energyChargeWon: '전력량요금',
  powerFactorChargeWon: '역률요금',
  climateChargeWon: '기후환경요금',
  fuelAdjustmentWon: '연료비조정액',
  vatWon: '부가세',
  fundWon: '전력산업기반기금',
  note: '메모',
} as const

const requiredDraftFields = ['usageKwh', 'totalBillWon'] as const
const maxManualBillRows = 36
const rowLimitMessage = '고지서 입력은 최대 36행까지만 가능합니다.'

const optionalNumericFields = [
  'maxDemandKw',
  'appliedPowerKw',
  'baseChargeWon',
  'energyChargeWon',
  'powerFactorChargeWon',
  'climateChargeWon',
  'fuelAdjustmentWon',
  'vatWon',
  'fundWon',
] as const

const nonNegativeOptionalFields = new Set<ManualBillDraftField>([
  'baseChargeWon',
  'energyChargeWon',
  'climateChargeWon',
  'vatWon',
  'fundWon',
])

const positiveOptionalFields = new Set<ManualBillDraftField>([
  'maxDemandKw',
  'appliedPowerKw',
])

const trim = (value: string) => value.trim()

const parseYearMonth = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null
  return { year, month }
}

const formatYearMonth = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`

const parseDraftNumber = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/(?:kwh|kw|원)$/i, '')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const emptyDraftRow = (id: string, yearMonth = ''): ManualBillDraftRow => ({
  id,
  yearMonth,
  usageKwh: '',
  totalBillWon: '',
  maxDemandKw: '',
  appliedPowerKw: '',
  baseChargeWon: '',
  energyChargeWon: '',
  powerFactorChargeWon: '',
  climateChargeWon: '',
  fuelAdjustmentWon: '',
  vatWon: '',
  fundWon: '',
  note: '',
})

export const createManualBillRows = (
  lastYearMonth: string,
  count: 12 | 36,
): ManualBillDraftRow[] => {
  const lastPeriod = parseYearMonth(lastYearMonth)
  if (!lastPeriod) return []

  const lastIndex = lastPeriod.year * 12 + lastPeriod.month - 1
  return Array.from({ length: count }, (_, index) => {
    const periodIndex = lastIndex - index
    const year = Math.floor(periodIndex / 12)
    const month = (periodIndex % 12) + 1
    return emptyDraftRow(`manual-${formatYearMonth(year, month)}-${index}`, formatYearMonth(year, month))
  })
}

export const buildBillColumnMapping = (headers: string[]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(mappingLabels).map(([field, label]) => [
      field,
      headers.find((header) => header.includes(label) || label.includes(header)) ?? '',
    ]),
  )

export const parsePastedBillSheet = (text: string): ParsedSheet => {
  const firstNonEmptyLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  const matrix = parseDelimitedMatrix(
    text,
    firstNonEmptyLine.includes('\t') ? '\t' : ',',
  )
  if (matrix.length - 1 > maxManualBillRows) throw new Error(rowLimitMessage)
  const headers = (matrix[0] ?? []).map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim(),
  )
  const rows = matrix.slice(1).map((values) =>
    headers.reduce<Record<string, unknown>>((row, header, index) => {
      row[header] = values[index] ?? ''
      return row
    }, {}),
  )

  return { name: '붙여넣기', headers, rows }
}

export const applyMatrixToDraftRows = (
  rows: ManualBillDraftRow[],
  startRowIndex: number,
  startField: ManualBillDraftField,
  matrix: string[][],
  visibleFields: ManualBillDraftField[],
): ManualBillDraftRow[] => {
  const startFieldIndex = visibleFields.indexOf(startField)
  if (startRowIndex < 0 || startFieldIndex < 0) return rows

  return rows.map((row, rowIndex) => {
    const values = matrix[rowIndex - startRowIndex]
    if (!values) return row
    const updated = { ...row }
    values.forEach((value, valueIndex) => {
      const field = visibleFields[startFieldIndex + valueIndex]
      if (field) updated[field] = value
    })
    return updated
  })
}

const addIssue = (
  issues: BillInputIssue[],
  rowId: string,
  field: ManualBillDraftField | 'period',
  message: string,
) => issues.push({ rowId, field, message })

export const validateManualBillRows = (
  rows: ManualBillDraftRow[],
  context?: BillImportContext,
): BillInputValidation => {
  if (rows.length > maxManualBillRows) {
    return {
      bills: [],
      issues: [{
        rowId: rows[maxManualBillRows]?.id ?? '',
        field: 'period',
        message: rowLimitMessage,
      }],
    }
  }

  const issues: BillInputIssue[] = []
  const records: Record<string, unknown>[] = []
  const validRows: ManualBillDraftRow[] = []
  const rowsByPeriod = new Map<string, ManualBillDraftRow[]>()

  for (const row of rows) {
    const period = parseYearMonth(trim(row.yearMonth))
    let valid = true
    if (!period) {
      addIssue(issues, row.id, 'yearMonth', '연월은 YYYY-MM 형식으로 입력해 주세요.')
      valid = false
    } else {
      const key = `${period.year}-${period.month}`
      const periodRows = rowsByPeriod.get(key) ?? []
      periodRows.push(row)
      rowsByPeriod.set(key, periodRows)
    }

    const values: Partial<Record<ManualBillDraftField, number>> = {}
    for (const field of requiredDraftFields) {
      const parsed = parseDraftNumber(row[field])
      if (parsed === null || parsed <= 0) {
        addIssue(issues, row.id, field, '0보다 큰 숫자를 입력해 주세요.')
        valid = false
      } else {
        values[field] = parsed
      }
    }

    for (const field of optionalNumericFields) {
      if (!trim(row[field])) continue
      const parsed = parseDraftNumber(row[field])
      const invalid =
        parsed === null ||
        (positiveOptionalFields.has(field) && parsed <= 0) ||
        (nonNegativeOptionalFields.has(field) && parsed < 0)
      if (invalid) {
        addIssue(issues, row.id, field, '입력한 값이 올바르지 않습니다.')
        valid = false
      } else {
        values[field] = parsed
      }
    }

    if (!valid || !period) continue
    records.push({
      연도: period.year,
      월: period.month,
      사용량: values.usageKwh,
      '총 전기요금': values.totalBillWon,
      요금적용전력: values.appliedPowerKw,
      최대수요전력: values.maxDemandKw,
      기본요금: values.baseChargeWon,
      전력량요금: values.energyChargeWon,
      역률요금: values.powerFactorChargeWon,
      기후환경요금: values.climateChargeWon,
      연료비조정액: values.fuelAdjustmentWon,
      부가세: values.vatWon,
      전력산업기반기금: values.fundWon,
      메모: row.note,
    })
    validRows.push(row)
  }

  rowsByPeriod.forEach((periodRows, period) => {
    if (periodRows.length < 2) return
    periodRows.forEach((row) =>
      addIssue(issues, row.id, 'period', `${period} billing period is duplicated.`),
    )
  })

  if (issues.length) return { bills: [], issues }

  const mapping = {
    year: '연도',
    month: '월',
    usageKwh: '사용량',
    totalBillWon: '총 전기요금',
    appliedPowerKw: '요금적용전력',
    maxDemandKw: '최대수요전력',
    baseChargeWon: '기본요금',
    energyChargeWon: '전력량요금',
    powerFactorChargeWon: '역률요금',
    climateChargeWon: '기후환경요금',
    fuelAdjustmentWon: '연료비조정액',
    vatWon: '부가세',
    fundWon: '전력산업기반기금',
    note: '메모',
  }
  const bills = mapRowsToBills(records, mapping, context)
  if (bills.length !== records.length) {
    validRows.forEach((row) =>
      addIssue(issues, row.id, 'period', '고지서 행의 값이 올바르지 않습니다.'),
    )
    return { bills: [], issues }
  }

  const periodValidation = validateBillPeriods(bills)

  for (const issue of periodValidation.issues) {
    if (issue.code === 'duplicate-period') {
      const duplicateRows = rowsByPeriod.get(issue.period ?? '') ?? []
      duplicateRows.forEach((row) => addIssue(issues, row.id, 'period', issue.message))
      continue
    }
    addIssue(issues, '', 'period', issue.message)
  }

  const hasDuplicate = periodValidation.issues.some(
    (issue) => issue.code === 'duplicate-period',
  )
  return {
    bills: hasDuplicate ? [] : periodValidation.normalizedBills,
    issues,
  }
}

export const createStandardBillCsv = () =>
  `\uFEFF${standardBillCsvHeaders.join(',')}\n${Array(standardBillCsvHeaders.length).fill('').join(',')}\n`
