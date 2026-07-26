import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  getWorkbookLimitMessage,
  parseWorkbook,
  validateUploadFile,
} from './excel'

const createSyntheticWorkbook = () => {
  const workbook = XLSX.utils.book_new()
  const yearlyRows: Array<{ year: number; rows: number[][] }> = [
    { year: 2025, rows: [[11, 31_200, 5_180_000], [12, 47_600, 7_890_000]] },
    { year: 2026, rows: [[1, 49_200, 8_160_000], [2, 45_400, 7_530_000]] },
  ]

  for (const { year, rows } of yearlyRows) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['월분', '사용량(kWh)', `${year}학년도`],
      ...rows,
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, `${year} 시연`)
  }

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

const powerPlannerHtmlFixture = `
<html xmlns:x="urn:schemas-microsoft-com:office:excel">
  <body>
    <table class="ui-jqgrid-htable">
      <thead>
        <tr>
          <th id="grid_YEAR_ROW"><div>연월</div></th>
          <th id="grid_JOJ_IKW"><div>계약전력(kW)</div></th>
          <th id="grid_JOJ_KW"><div>요금적용전력(kW)</div></th>
          <th id="grid_F_AP_QT"><div>사용전력량(kWh)</div></th>
          <th id="grid_JOJ_ILSU"><div>사용일수(일)</div></th>
          <th id="grid_JOJ_JI_PF"><div>지상역률(%)</div></th>
          <th id="grid_JOJ_JN_PF"><div>진상역률(%)</div></th>
          <th id="grid_TOT_REQ_AMT"><div>청구요금(원)</div></th>
        </tr>
      </thead>
    </table>
    <table id="grid" class="ui-jqgrid-btable">
      <tbody>
        <tr class="jqgfirstrow"><td></td></tr>
        <tr role="row">
          <td title="2026년 06월" aria-describedby="grid_YEAR_ROW">2026년 06월</td>
          <td title="600" aria-describedby="grid_JOJ_IKW">600</td>
          <td title="450" aria-describedby="grid_JOJ_KW">450</td>
          <td title="42,000" aria-describedby="grid_F_AP_QT">42,000</td>
          <td title="31" aria-describedby="grid_JOJ_ILSU">31</td>
          <td title="97" aria-describedby="grid_JOJ_JI_PF">97</td>
          <td title="89" aria-describedby="grid_JOJ_JN_PF">89</td>
          <td title="6,420,000" aria-describedby="grid_TOT_REQ_AMT">6,420,000</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`

describe('synthetic workbook parser harness', () => {
  it('rejects an oversized browser upload before parsing', () => {
    const message = validateUploadFile({
      name: 'oversized.xlsx',
      size: 10 * 1024 * 1024 + 1,
    })

    expect(message).toContain('10MB')
  })

  it('rejects a workbook whose total rows exceed the analysis limit', () => {
    const message = getWorkbookLimitMessage({
      sheets: [
        {
          name: 'large',
          headers: ['연도'],
          rows: Array.from({ length: 10_001 }, () => ({ 연도: 2026 })),
        },
      ],
      autoRows: [],
      diagnostics: [],
    })

    expect(message).toContain('10,000행')
  })

  it('auto-merges a deterministic in-memory yearly workbook', async () => {
    const result = await parseWorkbook(createSyntheticWorkbook())

    expect(result.autoRows).toHaveLength(4)
    expect(result.autoRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          year: 2025,
          month: 11,
          usageKwh: 31_200,
          totalBillWon: 5_180_000,
        }),
        expect.objectContaining({
          year: 2026,
          month: 2,
          usageKwh: 45_400,
          totalBillWon: 7_530_000,
        }),
      ]),
    )
  })

  it('normalizes a KEPCO Power Planner HTML xls export', async () => {
    const result = await parseWorkbook(
      new TextEncoder().encode(powerPlannerHtmlFixture).buffer,
    )

    expect(result.sheets[0].headers).toEqual([
      '연월',
      '계약전력(kW)',
      '요금적용전력(kW)',
      '사용전력량(kWh)',
      '사용일수(일)',
      '지상역률(%)',
      '진상역률(%)',
      '청구요금(원)',
    ])
    expect(result.sheets[0].rows[0]).toMatchObject({
      연월: '2026년 06월',
      '사용전력량(kWh)': '42,000',
      '청구요금(원)': '6,420,000',
    })
    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 6,
      usageKwh: 42000,
      totalBillWon: 6420000,
      appliedPowerKw: 450,
      note: '파워플래너 월별청구요금 업로드',
    })
  })

  it('keeps Korean headers intact when reading a UTF-8 Power Planner CSV', async () => {
    const csv = [
      '연월,사용전력량(kWh),청구요금(원),요금적용전력(kW)',
      '2026년 06월,42000,6420000,450',
      '2026년 07월,43800,6710000,460',
    ].join('\n')
    const result = await parseWorkbook(
      new File([csv], 'power-planner-monthly.csv', { type: 'text/csv' }),
    )

    expect(result.sheets[0].headers).toEqual([
      '연월',
      '사용전력량(kWh)',
      '청구요금(원)',
      '요금적용전력(kW)',
    ])
    expect(result.sheets[0].rows[0]).toMatchObject({
      연월: '2026년 06월',
      '사용전력량(kWh)': '42000',
      '청구요금(원)': '6420000',
      '요금적용전력(kW)': '450',
    })
  })
})
