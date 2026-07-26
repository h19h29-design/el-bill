import * as XLSX from 'xlsx'
import type {
  BillImportContext,
  MonthlyBill,
  MonthlyBillObservedField,
} from '../types'

export interface ParsedSheet {
  name: string
  headers: string[]
  rows: Record<string, unknown>[]
}

export interface WorkbookParseResult {
  sheets: ParsedSheet[]
  autoRows: MonthlyBill[]
  diagnostics: string[]
}

const maxUploadFileBytes = 10 * 1024 * 1024
const maxWorkbookRows = 10_000

export const validateUploadFile = (
  file: Pick<File, 'name' | 'size'>,
): string | null => {
  if (file.size > maxUploadFileBytes) {
    return '파일 크기는 10MB 이하만 분석할 수 있습니다.'
  }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    return '엑셀(.xlsx, .xls) 또는 CSV(.csv) 파일만 업로드할 수 있습니다.'
  }
  return null
}

export const getWorkbookLimitMessage = (
  result: WorkbookParseResult,
): string | null => {
  const totalRows = result.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)
  return totalRows > maxWorkbookRows
    ? '전체 데이터가 10,000행을 초과하여 브라우저 분석을 중단했습니다. 기간이나 시트를 나눠 업로드해 주세요.'
    : null
}

const normalize = (value: unknown) => String(value ?? '').trim()
const asNumber = (value: unknown) => {
  if (typeof value === 'number') return value
  const cleaned = normalize(value).replace(/,/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

const asMonth = (value: unknown) => {
  const match = normalize(value).match(/(\d{1,2})/)
  if (!match) return 0
  const month = Number(match[1])
  return month >= 1 && month <= 12 ? month : 0
}

const asYearMonth = (value: unknown) => {
  const match = normalize(value).match(/(\d{4})\D+(\d{1,2})/)
  if (!match) return { year: 0, month: 0 }
  const year = Number(match[1])
  const month = Number(match[2])
  return {
    year: Number.isFinite(year) ? year : 0,
    month: month >= 1 && month <= 12 ? month : 0,
  }
}

const seasonForMonth = (month: number) => {
  if (month >= 6 && month <= 8) return 'summer'
  if ([12, 1, 2].includes(month)) return 'winter'
  return 'springAutumn'
}

const inferYearFromSheetName = (name: string) => {
  const match = name.match(/(\d{2,4})/)
  if (!match) return 0
  const raw = Number(match[1])
  return raw < 100 ? 2000 + raw : raw
}

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const stripHtml = (value: string) =>
  decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

const getHtmlAttr = (attrs: string, name: string) => {
  const match = attrs.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))
  return match ? decodeHtmlEntities(match[1]) : ''
}

const decodeSpreadsheetText = (buffer: ArrayBuffer) => {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('\uFFFD')) return utf8

  try {
    return new TextDecoder('euc-kr').decode(buffer)
  } catch {
    return utf8
  }
}

const parseCsvMatrix = (text: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (char === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

const parseCsvSheet = (text: string, name: string): ParsedSheet => {
  const matrix = parseCsvMatrix(text)
  const headers = (matrix[0] ?? []).map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim(),
  )
  const rows = matrix.slice(1).map((values) =>
    headers.reduce<Record<string, unknown>>((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {}),
  )

  return {
    name,
    headers,
    rows,
  }
}

const makeImportedBill = (
  year: number,
  month: number,
  usageKwh: number,
  totalBillWon: number,
  context?: BillImportContext,
  observedFields: MonthlyBillObservedField[] = [
    'year',
    'month',
    'usageKwh',
    'totalBillWon',
  ],
): MonthlyBill => {
  const appliedPowerKw = context?.appliedPowerKw ?? 0
  const baseChargeWon = context
    ? Math.round(appliedPowerKw * context.currentPlan.baseRateWonPerKw)
    : 0
  const energyChargeWon = context
    ? Math.round(usageKwh * context.currentPlan.seasonRates[seasonForMonth(month)])
    : 0
  return {
    id: `import-${year}-${month}-${usageKwh}-${totalBillWon}`,
    year,
    month,
    usageKwh,
    totalBillWon,
    baseChargeWon,
    energyChargeWon,
    appliedPowerKw,
    maxDemandKw: 0,
    powerFactorChargeWon: 0,
    climateChargeWon: 0,
    fuelAdjustmentWon: 0,
    vatWon: 0,
    fundWon: 0,
    note: '업로드 엑셀 자동 파싱',
    observedFields,
  }
}

const parseYearlyBillWorkbook = (
  workbook: XLSX.WorkBook,
  context?: BillImportContext,
): { rows: MonthlyBill[]; diagnostics: string[] } => {
  const rows: MonthlyBill[] = []
  const diagnostics: string[] = []

  workbook.SheetNames.forEach((sheetName) => {
    const year = inferYearFromSheetName(sheetName)
    if (!year) return

    const sheet = workbook.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
    })
    const headerIndex = matrix.findIndex((row) =>
      row.some((cell) => normalize(cell).includes('월분')),
    )
    if (headerIndex === -1) {
      diagnostics.push(`${sheetName}: 월분 헤더를 찾지 못함`)
      return
    }

    const headers = matrix[headerIndex].map(normalize)
    const monthCol = headers.findIndex((header) => header.includes('월분'))
    const usageCol = headers.findIndex((header) => header.includes('사용량'))
    const amountCol = headers.findIndex((header) =>
      header.includes(`${year}학년도`),
    )

    if (monthCol < 0 || usageCol < 0 || amountCol < 0) {
      diagnostics.push(`${sheetName}: 연도/월/사용량/금액 자동 매핑 실패`)
      return
    }

    matrix.slice(headerIndex + 1).forEach((row) => {
      const month = asMonth(row[monthCol])
      const totalBillWon = asNumber(row[amountCol])
      const usageKwh = asNumber(row[usageCol])
      if (!month || !totalBillWon || !usageKwh) return
      rows.push(makeImportedBill(year, month, usageKwh, totalBillWon, context))
    })
  })

  return { rows, diagnostics }
}

const getRowValue = (row: Record<string, unknown>, ...patterns: string[]) => {
  const found = Object.entries(row).find(([key]) =>
    patterns.some((pattern) => key.includes(pattern)),
  )
  return found?.[1]
}

const parsePowerPlannerMonthlyBills = (
  sheet: ParsedSheet,
  context?: BillImportContext,
): MonthlyBill[] =>
  sheet.rows
    .map((row, index) => {
      const { year, month } = asYearMonth(getRowValue(row, '연월', '사용월'))
      const usageKwh = asNumber(getRowValue(row, '사용전력량', '사용량'))
      const totalBillWon = asNumber(getRowValue(row, '청구요금', '예상요금'))
      const rawAppliedPowerKw = getRowValue(row, '요금적용전력')
      const appliedPowerKw = asNumber(rawAppliedPowerKw)
      if (!year || !month || !usageKwh || !totalBillWon) return null

      const bill = makeImportedBill(year, month, usageKwh, totalBillWon, context)
      const baseChargeWon = appliedPowerKw
        ? Math.round(appliedPowerKw * (context?.currentPlan.baseRateWonPerKw ?? 0))
        : bill.baseChargeWon
      return {
        ...bill,
        id: `power-planner-${year}-${month}-${index}`,
        appliedPowerKw: appliedPowerKw || bill.appliedPowerKw,
        maxDemandKw: 0,
        baseChargeWon,
        observedFields: rawAppliedPowerKw === undefined
          ? bill.observedFields
          : [...bill.observedFields, 'appliedPowerKw'],
        note: '파워플래너 월별청구요금 업로드',
      }
    })
    .filter((bill): bill is MonthlyBill => Boolean(bill))

const parsePowerPlannerHtmlSheet = (text: string): ParsedSheet | null => {
  if (!text.includes('ui-jqgrid') || !text.includes('aria-describedby="grid_')) {
    return null
  }

  const columns: Array<{ id: string; label: string }> = []
  const headerRegex = /<th\b([^>]*)>([\s\S]*?)<\/th>/gi
  let headerMatch: RegExpExecArray | null
  while ((headerMatch = headerRegex.exec(text))) {
    const id = getHtmlAttr(headerMatch[1], 'id').replace(/^grid_/, '')
    if (!id) continue
    const label = stripHtml(headerMatch[2])
    if (!label) continue
    columns.push({ id, label })
  }

  const labelById = new Map(columns.map((column) => [column.id, column.label]))
  if (!labelById.size) return null

  const rows: Record<string, unknown>[] = []
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(text))) {
    const row: Record<string, unknown> = {}
    const cellRegex = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const describedBy = getHtmlAttr(cellMatch[1], 'aria-describedby').replace(
        /^grid_/,
        '',
      )
      const label = labelById.get(describedBy)
      if (!label) continue
      row[label] = getHtmlAttr(cellMatch[1], 'title') || stripHtml(cellMatch[2])
    }
    if (Object.keys(row).length) rows.push(row)
  }

  if (!rows.length) return null

  return {
    name: '한전 파워플래너 월별청구요금',
    headers: columns.map((column) => column.label),
    rows,
  }
}

const parseWorkbookContents = async (
  file: File | ArrayBuffer,
  context?: BillImportContext,
): Promise<WorkbookParseResult> => {
  const buffer = file instanceof File ? await file.arrayBuffer() : file
  const decodedText = decodeSpreadsheetText(buffer)
  if (file instanceof File && file.name.toLowerCase().endsWith('.csv')) {
    return {
      sheets: [parseCsvSheet(decodedText, file.name)],
      autoRows: [],
      diagnostics: ['CSV 파일을 브라우저 로컬 파서로 읽었습니다.'],
    }
  }

  const powerPlannerSheet = parsePowerPlannerHtmlSheet(decodedText)

  if (powerPlannerSheet) {
    const autoRows = parsePowerPlannerMonthlyBills(powerPlannerSheet, context)
    return {
      sheets: [powerPlannerSheet],
      autoRows,
      diagnostics: [
        '한전 파워플래너 HTML xls 내보내기 형식으로 인식했습니다.',
        autoRows.length
          ? `월별청구요금 ${autoRows.length.toLocaleString('ko-KR')}건을 자동 변환했습니다.`
          : '월별청구요금 자동 변환은 어려워 컬럼 매핑을 사용합니다.',
      ],
    }
  }

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    })
    const headers = rows[0] ? Object.keys(rows[0]) : []
    return { name, headers, rows }
  })
  const known = parseYearlyBillWorkbook(workbook, context)

  return {
    sheets,
    autoRows: known.rows,
    diagnostics: known.diagnostics,
  }
}

export const parseWorkbook = async (
  file: File | ArrayBuffer,
  context?: BillImportContext,
): Promise<WorkbookParseResult> => {
  if (file instanceof File) {
    const fileMessage = validateUploadFile(file)
    if (fileMessage) throw new Error(fileMessage)
  }

  const result = await parseWorkbookContents(file, context)
  const rowLimitMessage = getWorkbookLimitMessage(result)
  if (rowLimitMessage) throw new Error(rowLimitMessage)
  return result
}

export const mapRowsToBills = (
  rows: Record<string, unknown>[],
  mapping: Record<string, string>,
  context?: BillImportContext,
): MonthlyBill[] =>
  rows
    .map((row, index) => {
      const year = asNumber(row[mapping.year])
      const month = asMonth(row[mapping.month])
      const usageKwh = asNumber(row[mapping.usageKwh])
      const totalBillWon = asNumber(row[mapping.totalBillWon])
      if (!year || !month || !usageKwh || !totalBillWon) return null

      const hasMappedValue = (field: string) => {
        const column = mapping[field]
        return Boolean(column && normalize(row[column]))
      }
      const observedFields: MonthlyBillObservedField[] = [
        'year',
        'month',
        'usageKwh',
        'totalBillWon',
      ]
      const optionalFields: MonthlyBillObservedField[] = [
        'appliedPowerKw',
        'maxDemandKw',
        'baseChargeWon',
        'energyChargeWon',
        'powerFactorChargeWon',
        'climateChargeWon',
        'fuelAdjustmentWon',
        'vatWon',
        'fundWon',
      ]
      optionalFields.forEach((field) => {
        if (hasMappedValue(field)) observedFields.push(field)
      })
      const imported = makeImportedBill(
        year,
        month,
        usageKwh,
        totalBillWon,
        context,
        observedFields,
      )

      return {
        ...imported,
        id: `mapped-${year}-${month}-${index}`,
        appliedPowerKw: hasMappedValue('appliedPowerKw')
          ? asNumber(row[mapping.appliedPowerKw])
          : imported.appliedPowerKw,
        maxDemandKw: hasMappedValue('maxDemandKw')
          ? asNumber(row[mapping.maxDemandKw])
          : 0,
        baseChargeWon: hasMappedValue('baseChargeWon')
          ? asNumber(row[mapping.baseChargeWon])
          : imported.baseChargeWon,
        energyChargeWon: hasMappedValue('energyChargeWon')
          ? asNumber(row[mapping.energyChargeWon])
          : imported.energyChargeWon,
        powerFactorChargeWon: hasMappedValue('powerFactorChargeWon')
          ? asNumber(row[mapping.powerFactorChargeWon])
          : 0,
        climateChargeWon: hasMappedValue('climateChargeWon')
          ? asNumber(row[mapping.climateChargeWon])
          : 0,
        fuelAdjustmentWon: hasMappedValue('fuelAdjustmentWon')
          ? asNumber(row[mapping.fuelAdjustmentWon])
          : 0,
        vatWon: hasMappedValue('vatWon') ? asNumber(row[mapping.vatWon]) : 0,
        fundWon: hasMappedValue('fundWon') ? asNumber(row[mapping.fundWon]) : 0,
        note: normalize(row[mapping.note]) || '컬럼 매핑 입력',
      }
    })
    .filter((bill): bill is MonthlyBill => Boolean(bill))
