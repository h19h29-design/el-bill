import * as XLSX from 'xlsx'
import type { MonthlyBill } from '../types'

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

const inferYearFromSheetName = (name: string) => {
  const match = name.match(/(\d{2,4})/)
  if (!match) return 0
  const raw = Number(match[1])
  return raw < 100 ? 2000 + raw : raw
}

const makeImportedBill = (
  year: number,
  month: number,
  usageKwh: number,
  totalBillWon: number,
): MonthlyBill => {
  const appliedPowerKw = 497
  const baseChargeWon = appliedPowerKw * 6370
  const energyChargeWon = Math.round(usageKwh * 82.1)
  return {
    id: `import-${year}-${month}-${usageKwh}-${totalBillWon}`,
    year,
    month,
    usageKwh,
    totalBillWon,
    baseChargeWon,
    energyChargeWon,
    appliedPowerKw,
    maxDemandKw: Math.max(385, Math.round(usageKwh / 120 + 40)),
    powerFactorChargeWon: 0,
    climateChargeWon: Math.round(usageKwh * 9),
    fuelAdjustmentWon: Math.round(usageKwh * -5),
    vatWon: Math.round(totalBillWon * 0.09),
    fundWon: Math.round(totalBillWon * 0.037),
    note: '업로드 엑셀 자동 파싱',
  }
}

export const parseKnownSchoolWorkbook = (
  workbook: XLSX.WorkBook,
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
      rows.push(makeImportedBill(year, month, usageKwh, totalBillWon))
    })
  })

  return { rows, diagnostics }
}

export const parseWorkbook = async (
  file: File | ArrayBuffer,
): Promise<WorkbookParseResult> => {
  const buffer = file instanceof File ? await file.arrayBuffer() : file
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    })
    const headers = rows[0] ? Object.keys(rows[0]) : []
    return { name, headers, rows }
  })
  const known = parseKnownSchoolWorkbook(workbook)

  return {
    sheets,
    autoRows: known.rows,
    diagnostics: known.diagnostics,
  }
}

export const mapRowsToBills = (
  rows: Record<string, unknown>[],
  mapping: Record<string, string>,
): MonthlyBill[] =>
  rows
    .map((row, index) => {
      const year = asNumber(row[mapping.year])
      const month = asMonth(row[mapping.month])
      const usageKwh = asNumber(row[mapping.usageKwh])
      const totalBillWon = asNumber(row[mapping.totalBillWon])
      if (!year || !month || !usageKwh || !totalBillWon) return null

      return {
        ...makeImportedBill(year, month, usageKwh, totalBillWon),
        id: `mapped-${year}-${month}-${index}`,
        appliedPowerKw: asNumber(row[mapping.appliedPowerKw]) || 497,
        maxDemandKw: asNumber(row[mapping.maxDemandKw]) || 0,
        baseChargeWon: asNumber(row[mapping.baseChargeWon]) || 0,
        energyChargeWon: asNumber(row[mapping.energyChargeWon]) || 0,
        powerFactorChargeWon: asNumber(row[mapping.powerFactorChargeWon]) || 0,
        climateChargeWon: asNumber(row[mapping.climateChargeWon]) || 0,
        fuelAdjustmentWon: asNumber(row[mapping.fuelAdjustmentWon]) || 0,
        vatWon: asNumber(row[mapping.vatWon]) || 0,
        fundWon: asNumber(row[mapping.fundWon]) || 0,
        note: normalize(row[mapping.note]) || '컬럼 매핑 입력',
      }
    })
    .filter((bill): bill is MonthlyBill => Boolean(bill))
