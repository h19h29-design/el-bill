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

const normalizeHeaderAlias = (header: string) =>
  header.toLocaleLowerCase('ko-KR').replace(/[\s()[\]{}_-]/g, '')

const mappingAliases = {
  year: ['연도', '년도', '청구연도', '청구년도'],
  month: ['월', '월분', '청구월', '청구월분'],
  usageKwh: [
    '사용량',
    '사용량kwh',
    '전력사용량',
    '전력사용량kwh',
    '사용전력량',
    '사용전력량kwh',
  ],
  totalBillWon: [
    '총전기요금',
    '총전기요금원',
    '전기요금',
    '전기요금원',
    '청구금액',
    '청구금액원',
    '납부금액',
    '납부금액원',
    '청구요금',
    '청구요금원',
    '납부요금',
    '납부요금원',
  ],
  appliedPowerKw: ['요금적용전력', '요금적용전력kw'],
  maxDemandKw: ['최대수요전력', '최대수요전력kw'],
  baseChargeWon: ['기본요금', '기본요금원'],
  energyChargeWon: ['전력량요금', '전력량요금원'],
  powerFactorChargeWon: ['역률요금', '역률요금원'],
  climateChargeWon: ['기후환경요금', '기후환경요금원'],
  fuelAdjustmentWon: ['연료비조정액', '연료비조정액원'],
  vatWon: ['부가세', '부가세원'],
  fundWon: ['전력산업기반기금', '전력산업기반기금원'],
  note: ['메모', '비고'],
} as const

const requiredDraftFields = ['usageKwh', 'totalBillWon'] as const
const maxManualBillRows = 36
const rowLimitMessage = '고지서 입력은 최대 36행까지만 가능합니다.'
const maxDecimalPlaces = 12

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

const numericMaximums: Partial<Record<ManualBillDraftField, number>> = {
  usageKwh: 1_000_000_000,
  totalBillWon: 1_000_000_000_000,
  maxDemandKw: 10_000_000,
  appliedPowerKw: 10_000_000,
  baseChargeWon: 1_000_000_000_000,
  energyChargeWon: 1_000_000_000_000,
  powerFactorChargeWon: 1_000_000_000_000,
  climateChargeWon: 1_000_000_000_000,
  fuelAdjustmentWon: 1_000_000_000_000,
  vatWon: 1_000_000_000_000,
  fundWon: 1_000_000_000_000,
}

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

const normalizeDraftNumber = (value: string) =>
  value
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/(?:kwh|kw|원)$/i, '')

const parseDraftNumber = (value: string) => {
  const normalized = normalizeDraftNumber(value)
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return { ok: false as const, reason: 'format' as const }
  }
  const decimalPlaces = normalized.split('.')[1]?.length ?? 0
  if (decimalPlaces > maxDecimalPlaces) {
    return { ok: false as const, reason: 'precision' as const }
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed)
    ? { ok: true as const, value: parsed, normalized }
    : { ok: false as const, reason: 'format' as const }
}

const exceedsAbsoluteMaximum = (
  normalized: string,
  maximum: number,
) => {
  const unsigned = /^[+-]/.test(normalized)
    ? normalized.slice(1)
    : normalized
  const [integerPart = '', decimalPart = ''] = unsigned.split('.')
  const canonicalInteger = (integerPart || '0').replace(/^0+(?=\d)/, '')
  const maximumInteger = String(maximum)
  if (canonicalInteger.length !== maximumInteger.length) {
    return canonicalInteger.length > maximumInteger.length
  }
  if (canonicalInteger !== maximumInteger) {
    return canonicalInteger > maximumInteger
  }
  return /[1-9]/.test(decimalPart)
}

export const formatManualBillNumericDisplay = (value: string) => {
  const parsed = parseDraftNumber(value)
  if (!parsed.ok) return value
  const normalized = normalizeDraftNumber(value)
  const sign = normalized.startsWith('-') || normalized.startsWith('+')
    ? normalized[0]
    : ''
  const unsigned = sign ? normalized.slice(1) : normalized
  const [integerPart, decimalPart] = unsigned.split('.')
  const groupedInteger = (integerPart || '0').replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  )
  return `${sign}${groupedInteger}${decimalPart === undefined ? '' : `.${decimalPart}`}`
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

export const buildBillColumnMapping = (headers: string[]): Record<string, string> => {
  const normalizedHeaders = headers.map((header) => ({
    header,
    normalized: normalizeHeaderAlias(header),
  }))
  const candidates = Object.entries(mappingAliases).map(([field, aliases]) => {
    const normalizedAliases = new Set<string>(aliases.map(normalizeHeaderAlias))
    const matches = normalizedHeaders.filter(({ normalized }) =>
      normalizedAliases.has(normalized)
    )
    return { field, matches }
  })
  const fieldsByHeader = new Map<string, string[]>()
  candidates.forEach(({ field, matches }) => {
    if (matches.length !== 1) return
    const header = matches[0].header
    fieldsByHeader.set(header, [...(fieldsByHeader.get(header) ?? []), field])
  })

  return Object.fromEntries(
    candidates.map(({ field, matches }) => {
      const header = matches.length === 1 ? matches[0].header : ''
      return [
        field,
        header && fieldsByHeader.get(header)?.length === 1 ? header : '',
      ]
    }),
  )
}

export const assignBillColumnMapping = (
  mapping: Record<string, string>,
  field: string,
  header: string,
): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(mapping).map(([currentField, currentHeader]) => [
      currentField,
      currentField !== field && header && currentHeader === header
        ? ''
        : currentHeader,
    ]),
  ),
  [field]: header,
})

export const parsePastedBillSheet = (
  text: string,
  { firstRowIsHeader = true }: { firstRowIsHeader?: boolean } = {},
): ParsedSheet => {
  const firstNonEmptyLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  const matrix = parseDelimitedMatrix(
    text,
    firstNonEmptyLine.includes('\t') ? '\t' : ',',
  )
  const dataMatrix = firstRowIsHeader ? matrix.slice(1) : matrix
  if (dataMatrix.length > maxManualBillRows) throw new Error(rowLimitMessage)
  const headerCounts = new Map<string, number>()
  const columnCount = Math.max(0, ...matrix.map((row) => row.length))
  const headers = Array.from({ length: columnCount }, (_, index) => {
    const headerValue = firstRowIsHeader
      ? matrix[0]?.[index] ?? ''
      : ''
    const rawHeader = (
      index === 0 ? headerValue.replace(/^\uFEFF/, '') : headerValue
    ).trim()
    const base = rawHeader || `열 ${index + 1}`
    const count = (headerCounts.get(base) ?? 0) + 1
    headerCounts.set(base, count)
    return count === 1 ? base : `${base} ${count}`
  })
  const rows = dataMatrix.map((values) =>
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
    const period = parseYearMonth(row.yearMonth)
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
      if (!parsed.ok) {
        addIssue(
          issues,
          row.id,
          field,
          parsed.reason === 'precision'
            ? '소수점 이하는 최대 12자리까지 입력해 주세요.'
            : '0보다 큰 숫자를 입력해 주세요.',
        )
        valid = false
      } else if (parsed.value <= 0) {
        addIssue(issues, row.id, field, '0보다 큰 숫자를 입력해 주세요.')
        valid = false
      } else if (
        exceedsAbsoluteMaximum(
          parsed.normalized,
          numericMaximums[field] ?? Number.MAX_VALUE,
        )
      ) {
        addIssue(
          issues,
          row.id,
          field,
          field === 'usageKwh'
            ? '사용량은 1,000,000,000kWh 이하로 입력해 주세요.'
            : '총 전기요금은 1,000,000,000,000원 이하로 입력해 주세요.',
        )
        valid = false
      } else {
        values[field] = parsed.value
      }
    }

    for (const field of optionalNumericFields) {
      if (!trim(row[field])) continue
      const parsed = parseDraftNumber(row[field])
      const invalid =
        !parsed.ok ||
        (parsed.ok && positiveOptionalFields.has(field) && parsed.value <= 0) ||
        (parsed.ok && nonNegativeOptionalFields.has(field) && parsed.value < 0) ||
        (parsed.ok &&
          exceedsAbsoluteMaximum(
            parsed.normalized,
            numericMaximums[field] ?? Number.MAX_VALUE,
          ))
      if (invalid) {
        addIssue(
          issues,
          row.id,
          field,
          !parsed.ok && parsed.reason === 'precision'
            ? '소수점 이하는 최대 12자리까지 입력해 주세요.'
            : '입력한 값이 올바르지 않습니다.',
        )
        valid = false
      } else if (parsed.ok) {
        values[field] = parsed.value
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

  const addDuplicateIssues = () => {
    rowsByPeriod.forEach((periodRows, period) => {
      if (periodRows.length < 2) return
      periodRows.forEach((row) =>
        addIssue(issues, row.id, 'period', `${period} billing period is duplicated.`),
      )
    })
  }

  if (issues.length) {
    addDuplicateIssues()
    return { bills: [], issues }
  }

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
