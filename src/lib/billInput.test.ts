import { describe, expect, it } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import type { BillImportContext } from '../types'
import {
  buildBillColumnMapping,
  createManualBillRows,
  createStandardBillCsv,
  parsePastedBillSheet,
  validateManualBillRows,
  type ManualBillDraftRow,
} from './billInput'

const importContext: BillImportContext = {
  appliedPowerKw: 497,
  currentPlan: defaultRatePlans[0],
}

const makeDraft = (
  patch: Partial<ManualBillDraftRow> = {},
): ManualBillDraftRow => ({
  id: 'row-1',
  yearMonth: '',
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
  ...patch,
})

describe('manual bill input normalization', () => {
  it('creates 12 descending periods ending at the selected month', () => {
    const rows = createManualBillRows('2026-07', 12)
    expect(rows.map((row) => row.yearMonth)).toEqual([
      '2026-07', '2026-06', '2026-05', '2026-04',
      '2026-03', '2026-02', '2026-01', '2025-12',
      '2025-11', '2025-10', '2025-09', '2025-08',
    ])
  })

  it('parses tab-separated copied spreadsheet cells', () => {
    const sheet = parsePastedBillSheet(
      '연도\t월\t사용량(kWh)\t총 전기요금(원)\n2026\t7\t48,365 kWh\t7,138,790원',
    )
    expect(sheet.headers).toEqual([
      '연도', '월', '사용량(kWh)', '총 전기요금(원)',
    ])
    expect(sheet.rows[0]['사용량(kWh)']).toBe('48,365 kWh')
  })

  it('retains the first pasted bill row when the user selects no header', () => {
    const sheet = parsePastedBillSheet(
      '2026\t7\t48,365 kWh\t7,138,790원\n2026\t6\t42,000 kWh\t6,500,000원',
      { firstRowIsHeader: false },
    )

    expect(sheet.headers).toEqual(['열 1', '열 2', '열 3', '열 4'])
    expect(sheet.rows).toHaveLength(2)
    expect(sheet.rows[0]).toEqual({
      '열 1': '2026',
      '열 2': '7',
      '열 3': '48,365 kWh',
      '열 4': '7,138,790원',
    })
  })

  it('maps only exact aliases and leaves ambiguous optional aliases unmapped', () => {
    const mapping = buildBillColumnMapping([
      '청구연도',
      '청구월',
      '전력사용량(kWh)',
      '청구금액(원)',
      '기본요금 및 부가세',
      '부가세',
      '부가세(원)',
    ])

    expect(mapping).toMatchObject({
      year: '청구연도',
      month: '청구월',
      usageKwh: '전력사용량(kWh)',
      totalBillWon: '청구금액(원)',
      baseChargeWon: '',
      vatWon: '',
    })
    expect(Object.values(mapping).filter(Boolean)).toHaveLength(
      new Set(Object.values(mapping).filter(Boolean)).size,
    )
  })

  it('rejects pasted data with more than 36 rows without dropping data', () => {
    const rows = Array.from(
      { length: 37 },
      (_, index) => `2026,${index + 1},10,100`,
    )

    expect(() =>
      parsePastedBillSheet([
        '연도,월,사용량(kWh),총 전기요금(원)',
        ...rows,
      ].join('\n')),
    ).toThrow('최대 36행')
  })

  it('rejects more than 36 manual rows without dropping rows', () => {
    const rows = Array.from(
      { length: 37 },
      (_, index) => makeDraft({
        id: `row-${index + 1}`,
        yearMonth: '2026-07',
        usageKwh: '10',
        totalBillWon: '100',
      }),
    )

    const result = validateManualBillRows(rows, importContext)

    expect(result.bills).toEqual([])
    expect(result.issues).toContainEqual({
      rowId: 'row-37',
      field: 'period',
      message: '고지서 입력은 최대 36행까지만 가능합니다.',
    })
  })

  it('blocks every duplicate period instead of selecting one', () => {
    const result = validateManualBillRows(
      [
        makeDraft({ id: 'a', yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
        makeDraft({ id: 'b', yearMonth: '2026-07', usageKwh: '20', totalBillWon: '200' }),
      ],
      importContext,
    )
    expect(result.bills).toEqual([])
    expect(result.issues.filter((issue) => issue.field === 'period')).toHaveLength(2)
  })

  it('reports every duplicate period when a duplicate row has another invalid field', () => {
    const result = validateManualBillRows(
      [
        makeDraft({ id: 'a', yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
        makeDraft({
          id: 'b',
          yearMonth: '2026-07',
          usageKwh: '20',
          totalBillWon: '200',
          maxDemandKw: 'not-a-number',
        }),
      ],
      importContext,
    )

    expect(result.bills).toEqual([])
    expect(result.issues.filter((issue) => issue.field === 'period').map((issue) => issue.rowId))
      .toEqual(['a', 'b'])
  })

  it('keeps shared gap diagnostics when duplicate periods are blocked', () => {
    const result = validateManualBillRows(
      [
        makeDraft({ id: 'june', yearMonth: '2026-06', usageKwh: '10', totalBillWon: '100' }),
        makeDraft({ id: 'july-a', yearMonth: '2026-07', usageKwh: '20', totalBillWon: '200' }),
        makeDraft({ id: 'july-b', yearMonth: '2026-07', usageKwh: '30', totalBillWon: '300' }),
        makeDraft({ id: 'september', yearMonth: '2026-09', usageKwh: '40', totalBillWon: '400' }),
      ],
      importContext,
    )

    expect(result.bills).toEqual([])
    expect(result.issues.filter((issue) => issue.field === 'period').map((issue) => issue.rowId))
      .toContain('july-a')
    expect(result.issues.filter((issue) => issue.field === 'period').map((issue) => issue.rowId))
      .toContain('july-b')
    expect(result.issues).toContainEqual({
      rowId: '',
      field: 'period',
      message: '2026-7 through 2026-8 billing period is missing.',
    })
  })

  it('does not mark empty optional fields as observed', () => {
    const result = validateManualBillRows(
      [makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' })],
      importContext,
    )
    expect(result.bills[0].observedFields).not.toContain('maxDemandKw')
  })

  it('rejects unsupported numeric precision instead of rounding it', () => {
    const result = validateManualBillRows(
      [
        makeDraft({
          yearMonth: '2026-07',
          usageKwh: '123.1234567890123',
          totalBillWon: '100',
        }),
      ],
      importContext,
    )

    expect(result.bills).toEqual([])
    expect(result.issues).toContainEqual({
      rowId: 'row-1',
      field: 'usageKwh',
      message: '소수점 이하는 최대 12자리까지 입력해 주세요.',
    })
  })

  it('rejects unsupported numeric magnitude on the source field', () => {
    const result = validateManualBillRows(
      [
        makeDraft({
          yearMonth: '2026-07',
          usageKwh: '1,000,000,001',
          totalBillWon: '100',
        }),
      ],
      importContext,
    )

    expect(result.bills).toEqual([])
    expect(result.issues).toContainEqual({
      rowId: 'row-1',
      field: 'usageKwh',
      message: '사용량은 1,000,000,000kWh 이하로 입력해 주세요.',
    })
  })

  it('rejects a fractional amount above the magnitude boundary without Number rounding', () => {
    const result = validateManualBillRows(
      [
        makeDraft({
          yearMonth: '2026-07',
          usageKwh: '1000000000.000000000001',
          totalBillWon: '100',
        }),
      ],
      importContext,
    )

    expect(result.bills).toEqual([])
    expect(result.issues).toContainEqual({
      rowId: 'row-1',
      field: 'usageKwh',
      message: '사용량은 1,000,000,000kWh 이하로 입력해 주세요.',
    })
  })

  it.each(['2026-7', '2026-00', '2026-13', '2026-07 '])(
    'rejects the non-canonical billing period %s',
    (yearMonth) => {
      const result = validateManualBillRows(
        [makeDraft({ yearMonth, usageKwh: '10', totalBillWon: '100' })],
        importContext,
      )

      expect(result.bills).toEqual([])
      expect(result.issues).toContainEqual({
        rowId: 'row-1',
        field: 'yearMonth',
        message: '연월은 YYYY-MM 형식으로 입력해 주세요.',
      })
    },
  )

  it('creates the exact BOM CSV header and one empty data row', () => {
    expect(createStandardBillCsv()).toBe(
      '\uFEFF연도,월,사용량(kWh),총 전기요금(원),요금적용전력(kW),최대수요전력(kW),기본요금(원),전력량요금(원),역률요금(원),기후환경요금(원),연료비조정액(원),부가세(원),전력산업기반기금(원),메모\n,,,,,,,,,,,,,\n',
    )
  })
})
