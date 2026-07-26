import ExcelJS from 'exceljs'
import { Inflate } from 'pako'
import type {
  BillImportContext,
  MonthlyBill,
  MonthlyBillObservedField,
} from '../types'
import {
  isValidMonthlyBill,
  parseBillNumericValue,
  validateBillRequiredValues,
} from './domainValidation'
import {
  parseStrictCalendarValue,
  parseStrictMonth,
  parseStrictYear,
} from './calendar'

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
const maxWorksheetColumns = 256
const maxZipEntries = 200
const maxZipUncompressedBytes = 50 * 1024 * 1024
const legacyXlsMessage =
  '이 형식은 지원하지 않습니다. 한전/Excel에서 XLSX 또는 CSV로 다시 저장해 주세요.'
const rowLimitMessage =
  '전체 데이터가 10,000행을 초과하여 브라우저 분석을 중단했습니다. 기간이나 시트를 나눠 업로드해 주세요.'
const columnLimitMessage =
  '시트 열 수가 256개를 초과하여 브라우저 분석을 중단했습니다. 필요한 열만 남겨 다시 저장해 주세요.'
const zipEntryLimitMessage =
  'XLSX 내부 파일 수가 200개를 초과하여 브라우저 분석을 중단했습니다. 필요한 시트와 이미지만 남겨 다시 저장해 주세요.'
const zipUncompressedLimitMessage =
  '실제 압축 해제 출력이 50MB를 초과하여 브라우저 분석을 중단했습니다. 기간이나 시트를 나눠 업로드해 주세요.'
const csvColumnLimitMessage =
  'CSV 열 수가 256개를 초과하여 브라우저 분석을 중단했습니다. 필요한 열만 남겨 다시 저장해 주세요.'
const htmlColumnLimitMessage =
  'HTML 열 수가 256개를 초과하여 브라우저 분석을 중단했습니다. 필요한 열만 남겨 다시 저장해 주세요.'

interface ZipEntryMetadata {
  crc32: number
  flags: number
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const updateCrc32 = (crc32: number, chunk: Uint8Array) => {
  let value = crc32
  for (let index = 0; index < chunk.byteLength; index += 1) {
    value = crc32Table[(value ^ chunk[index]) & 0xff] ^ (value >>> 8)
  }
  return value >>> 0
}

export const validateUploadFile = (
  file: Pick<File, 'name' | 'size'>,
): string | null => {
  if (file.size > maxUploadFileBytes) {
    return '파일 크기는 10MB 이하만 분석할 수 있습니다.'
  }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    return 'XLSX(.xlsx), CSV(.csv), 또는 파워플래너 HTML .xls 파일만 업로드할 수 있습니다.'
  }
  return null
}

export const getWorkbookLimitMessage = (
  result: WorkbookParseResult,
): string | null => {
  const totalRows = result.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)
  return totalRows > maxWorkbookRows
    ? rowLimitMessage
    : null
}

const normalize = (value: unknown) => String(value ?? '').trim()
const asNumber = parseBillNumericValue

const hasNumericValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value)
  const cleaned = normalize(value).replace(/,/g, '')
  return cleaned !== '' && Number.isFinite(Number(cleaned))
}

const asMonth = (value: unknown) => {
  return parseStrictMonth(value) ?? 0
}

const asYearMonth = (value: unknown) => {
  const parsed = parseStrictCalendarValue(value)
  return parsed
    ? { year: parsed.year, month: parsed.month }
    : { year: 0, month: 0 }
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
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*["']\\s*([^"']*)["']`, 'i'))
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

const isCfbfBinary = (buffer: ArrayBuffer) => {
  if (buffer.byteLength < 4) return false
  const bytes = new Uint8Array(buffer, 0, 4)
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

const findZipEndOfCentralDirectory = (view: DataView) => {
  const minimumOffset = Math.max(0, view.byteLength - 65_557)
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  }
  return -1
}

const inspectXlsxArchive = (buffer: ArrayBuffer): ZipEntryMetadata[] => {
  const view = new DataView(buffer)
  const eocdOffset = findZipEndOfCentralDirectory(view)
  if (eocdOffset < 0) throw new Error(legacyXlsMessage)

  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectoryOffset + centralDirectorySize > eocdOffset
  ) {
    throw new Error(legacyXlsMessage)
  }
  if (entryCount > maxZipEntries) throw new Error(zipEntryLimitMessage)

  let offset = centralDirectoryOffset
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  let uncompressedBytes = 0
  const entries: ZipEntryMetadata[] = []
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(legacyXlsMessage)
    }
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const crc32 = view.getUint32(offset + 16, true)
    const fileNameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error(legacyXlsMessage)
    }

    uncompressedBytes += uncompressedSize
    if (uncompressedBytes > maxZipUncompressedBytes) {
      throw new Error(zipUncompressedLimitMessage)
    }
    entries.push({
      crc32,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })
    offset += 46 + fileNameLength + extraLength + commentLength
  }

  if (offset !== centralDirectoryEnd) throw new Error(legacyXlsMessage)
  return entries
}

const getZipEntryPayload = (
  view: DataView,
  centralDirectoryOffset: number,
  entry: ZipEntryMetadata,
) => {
  const { localHeaderOffset, flags, method, compressedSize, uncompressedSize } = entry
  if (localHeaderOffset + 30 > centralDirectoryOffset) throw new Error(legacyXlsMessage)
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error(legacyXlsMessage)
  }

  const localFlags = view.getUint16(localHeaderOffset + 6, true)
  const localMethod = view.getUint16(localHeaderOffset + 8, true)
  const localCrc32 = view.getUint32(localHeaderOffset + 14, true)
  const localCompressedSize = view.getUint32(localHeaderOffset + 18, true)
  const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true)
  const fileNameLength = view.getUint16(localHeaderOffset + 26, true)
  const extraLength = view.getUint16(localHeaderOffset + 28, true)
  if (
    localFlags !== flags ||
    localMethod !== method ||
    flags & 0x0001 ||
    flags & 0x0040 ||
    (!(flags & 0x0008) && localCrc32 !== entry.crc32) ||
    (flags & 0x0008
      ? (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)
      : localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)
  ) {
    throw new Error(legacyXlsMessage)
  }
  if (method !== 0 && method !== 8) throw new Error(legacyXlsMessage)

  const payloadStart = localHeaderOffset + 30 + fileNameLength + extraLength
  const payloadEnd = payloadStart + compressedSize
  if (payloadEnd > centralDirectoryOffset) throw new Error(legacyXlsMessage)
  return new Uint8Array(view.buffer, payloadStart, compressedSize)
}

const assertXlsxInflatedBytesWithinLimit = (buffer: ArrayBuffer, entries: ZipEntryMetadata[]) => {
  const view = new DataView(buffer)
  const centralDirectoryOffset = findZipEndOfCentralDirectory(view) < 0
    ? -1
    : view.getUint32(findZipEndOfCentralDirectory(view) + 16, true)
  if (centralDirectoryOffset < 0) throw new Error(legacyXlsMessage)

  let inflatedBytes = 0
  const addInflatedBytes = (size: number) => {
    inflatedBytes += size
    if (inflatedBytes > maxZipUncompressedBytes) {
      throw new Error(zipUncompressedLimitMessage)
    }
  }

  for (const entry of entries) {
    const payload = getZipEntryPayload(view, centralDirectoryOffset, entry)
    let crc32 = 0xffffffff
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) throw new Error(legacyXlsMessage)
      addInflatedBytes(payload.byteLength)
      crc32 = updateCrc32(crc32, payload)
    } else {
      const inflater = new Inflate({ raw: true, chunkSize: 64 * 1024 })
      inflater.onData = (chunk) => {
        const bytes = chunk instanceof Uint8Array
          ? chunk
          : chunk instanceof ArrayBuffer
            ? new Uint8Array(chunk)
            : null
        if (!bytes) throw new Error(legacyXlsMessage)
        addInflatedBytes(bytes.byteLength)
        crc32 = updateCrc32(crc32, bytes)
      }
      try {
        for (let offset = 0; offset < payload.byteLength; offset += 64 * 1024) {
          inflater.push(
            payload.subarray(offset, Math.min(offset + 64 * 1024, payload.byteLength)),
            offset + 64 * 1024 >= payload.byteLength,
          )
        }
      } catch (error) {
        if (error instanceof Error && error.message === zipUncompressedLimitMessage) throw error
        throw new Error(legacyXlsMessage)
      }
      if (inflater.err) throw new Error(legacyXlsMessage)
    }
    if (((crc32 ^ 0xffffffff) >>> 0) !== entry.crc32) throw new Error(legacyXlsMessage)
  }
}

const assertCsvLimits = (text: string) => {
  let logicalRows = 0
  let quoted = false
  let rowHasContent = false
  let columns = 1

  const finishRow = () => {
    if (rowHasContent) logicalRows += 1
    if (logicalRows > maxWorkbookRows + 1) throw new Error(rowLimitMessage)
    rowHasContent = false
    columns = 1
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"') {
      if (quoted && next === '"') {
        rowHasContent = true
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      columns += 1
      if (columns > maxWorksheetColumns) throw new Error(csvColumnLimitMessage)
      continue
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      finishRow()
      continue
    }
    if (!/\s/.test(char)) rowHasContent = true
  }

  if (rowHasContent) finishRow()
}

const assertPowerPlannerHtmlLimits = (text: string) => {
  const headers = text.match(/<th\b/gi)?.length ?? 0
  if (headers > maxWorksheetColumns) throw new Error(htmlColumnLimitMessage)

  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let dataRows = 0
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(text))) {
    const cells = match[1].match(/<td\b/gi)?.length ?? 0
    if (cells > maxWorksheetColumns) throw new Error(htmlColumnLimitMessage)
    if (!/<td\b[^>]*aria-describedby\s*=\s*["']\s*grid_/i.test(match[1])) continue
    dataRows += 1
    if (dataRows > maxWorkbookRows) throw new Error(rowLimitMessage)
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

const getDisplayedCellValue = (cell: ExcelJS.Cell): string => cell.text

const workbookSheetToMatrix = (sheet: ExcelJS.Worksheet): string[][] => {
  const matrix: string[][] = []
  const columnCount = sheet.actualColumnCount

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.from({ length: columnCount }, (_, index) =>
      getDisplayedCellValue(row.getCell(index + 1)),
    )
    if (values.some((value) => normalize(value))) matrix.push(values)
  })

  return matrix
}

const matrixToParsedSheet = (name: string, matrix: string[][]): ParsedSheet => {
  const headerCounts = new Map<string, number>()
  const headers = (matrix[0] ?? []).map((header, index) => {
    const base = normalize(header) || `열 ${index + 1}`
    const count = (headerCounts.get(base) ?? 0) + 1
    headerCounts.set(base, count)
    return count === 1 ? base : `${base} ${count}`
  })
  const rows = matrix.slice(1).map((values) =>
    headers.reduce<Record<string, unknown>>((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {}),
  )

  return { name, headers, rows }
}

const getRowLimitMessageForSheets = (sheets: ParsedSheet[]) =>
  getWorkbookLimitMessage({ sheets, autoRows: [], diagnostics: [] })

const assertWorkbookRowsWithinLimit = (sheets: ParsedSheet[]) => {
  const message = getRowLimitMessageForSheets(sheets)
  if (message) throw new Error(message)
}

const assertLoadedWorkbookLimits = (workbook: ExcelJS.Workbook) => {
  let actualRows = 0
  for (const sheet of workbook.worksheets) {
    if (Math.max(sheet.columnCount, sheet.actualColumnCount) > maxWorksheetColumns) {
      throw new Error(columnLimitMessage)
    }
    actualRows += sheet.actualRowCount
    if (actualRows > maxWorkbookRows) throw new Error(rowLimitMessage)
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
  workbook: ExcelJS.Workbook,
  context?: BillImportContext,
): { rows: MonthlyBill[]; diagnostics: string[] } => {
  const rows: MonthlyBill[] = []
  const diagnostics: string[] = []

  workbook.worksheets.forEach((sheet) => {
    const sheetName = sheet.name
    const year = inferYearFromSheetName(sheetName)
    if (!year) return

    const matrix = workbookSheetToMatrix(sheet)
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
      const requiredValidation = validateBillRequiredValues({
        year,
        month,
        usageKwh,
        totalBillWon,
      })
      if (!requiredValidation.valid) {
        diagnostics.push(
          `${sheetName}: ${month || '확인 불가'}월 행의 ${requiredValidation.issues.join(' ')} 해당 행을 제외했습니다.`,
        )
        return
      }
      const bill = makeImportedBill(year, month, usageKwh, totalBillWon, context)
      if (!context || isValidMonthlyBill(bill)) {
        rows.push(bill)
      } else {
        diagnostics.push(
          `${sheetName}: ${month}월 행의 사용량·총 전기요금·요금적용전력 또는 요금 구성요소가 올바르지 않아 제외했습니다.`,
        )
      }
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
      const hasObservedAppliedPower = hasNumericValue(rawAppliedPowerKw)
      if (
        !validateBillRequiredValues({
          year,
          month,
          usageKwh,
          totalBillWon,
        }).valid
      ) {
        return null
      }

      const bill = makeImportedBill(year, month, usageKwh, totalBillWon, context)
      const baseChargeWon = hasObservedAppliedPower
        ? Math.round(appliedPowerKw * (context?.currentPlan.baseRateWonPerKw ?? 0))
        : bill.baseChargeWon
      return {
        ...bill,
        id: `power-planner-${year}-${month}-${index}`,
        appliedPowerKw: hasObservedAppliedPower ? appliedPowerKw : bill.appliedPowerKw,
        maxDemandKw: 0,
        baseChargeWon,
        observedFields: hasObservedAppliedPower
          ? [...bill.observedFields, 'appliedPowerKw']
          : bill.observedFields,
        note: '파워플래너 월별청구요금 업로드',
      }
    })
    .filter(
      (bill): bill is MonthlyBill =>
        Boolean(bill) && (!context || isValidMonthlyBill(bill)),
    )

const isPowerPlannerHtmlExport = (text: string) =>
  /ui-jqgrid/i.test(text) &&
  /aria-describedby\s*=\s*["']\s*grid_/i.test(text)

const parsePowerPlannerHtmlSheet = (text: string): ParsedSheet | null => {
  if (!isPowerPlannerHtmlExport(text)) {
    return null
  }

  const columns: Array<{ id: string; label: string }> = []
  const headerRegex = /<th\b([^>]*)>([\s\S]*?)<\/th>/gi
  let headerMatch: RegExpExecArray | null
  while ((headerMatch = headerRegex.exec(text))) {
    const id = getHtmlAttr(headerMatch[1], 'id').trim().replace(/^grid_/i, '')
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
      const describedBy = getHtmlAttr(cellMatch[1], 'aria-describedby')
        .trim()
        .replace(/^grid_/i, '')
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
  if (buffer.byteLength > maxUploadFileBytes) {
    throw new Error('파일 크기는 10MB 이하만 분석할 수 있습니다.')
  }
  if (isCfbfBinary(buffer)) throw new Error(legacyXlsMessage)
  const decodedText = decodeSpreadsheetText(buffer)
  if (file instanceof File && file.name.toLowerCase().endsWith('.csv')) {
    assertCsvLimits(decodedText)
    return {
      sheets: [parseCsvSheet(decodedText, file.name)],
      autoRows: [],
      diagnostics: ['CSV 파일을 브라우저 로컬 파서로 읽었습니다.'],
    }
  }

  if (isPowerPlannerHtmlExport(decodedText)) {
    assertPowerPlannerHtmlLimits(decodedText)
    const powerPlannerSheet = parsePowerPlannerHtmlSheet(decodedText)
    if (!powerPlannerSheet) throw new Error(legacyXlsMessage)
    assertWorkbookRowsWithinLimit([powerPlannerSheet])
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

  if (file instanceof File && file.name.toLowerCase().endsWith('.xls')) {
    throw new Error(legacyXlsMessage)
  }

  const zipEntries = inspectXlsxArchive(buffer)
  assertXlsxInflatedBytesWithinLimit(buffer, zipEntries)
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    throw new Error(legacyXlsMessage)
  }
  assertLoadedWorkbookLimits(workbook)
  const sheets = workbook.worksheets.map((sheet) =>
    matrixToParsedSheet(sheet.name, workbookSheetToMatrix(sheet)),
  )
  assertWorkbookRowsWithinLimit(sheets)
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
      const year = parseStrictYear(row[mapping.year]) ?? 0
      const month = asMonth(row[mapping.month])
      const usageKwh = asNumber(row[mapping.usageKwh])
      const totalBillWon = asNumber(row[mapping.totalBillWon])
      if (
        !validateBillRequiredValues({
          year,
          month,
          usageKwh,
          totalBillWon,
        }).valid
      ) {
        return null
      }

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
    .filter(
      (bill): bill is MonthlyBill =>
        Boolean(bill) && (!context || isValidMonthlyBill(bill)),
    )
