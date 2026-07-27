import { describe, expect, it } from 'vitest'
import { defaultRatePlans } from '../data/ratePlans'
import type { BillImportContext } from '../types'
import {
  createManualBillRows,
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

  it('does not mark empty optional fields as observed', () => {
    const result = validateManualBillRows(
      [makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' })],
      importContext,
    )
    expect(result.bills[0].observedFields).not.toContain('maxDemandKw')
  })
})
