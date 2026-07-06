import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWorkbook } from './excel'

const attachedWorkbook = '/Users/mac-mini/Downloads/0. 전기요금-등촌고.xlsx'
const attachedPowerPlannerWorkbook = '/Users/mac-mini/Desktop/월별청구요금.xls'

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
          <td title="700" aria-describedby="grid_JOJ_IKW">700</td>
          <td title="493" aria-describedby="grid_JOJ_KW">493</td>
          <td title="48,365" aria-describedby="grid_F_AP_QT">48,365</td>
          <td title="31" aria-describedby="grid_JOJ_ILSU">31</td>
          <td title="97" aria-describedby="grid_JOJ_JI_PF">97</td>
          <td title="89" aria-describedby="grid_JOJ_JN_PF">89</td>
          <td title="7,138,790" aria-describedby="grid_TOT_REQ_AMT">7,138,790</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`

describe('attached workbook parser harness', () => {
  it.runIf(existsSync(attachedWorkbook))(
    'auto-merges the provided yearly electricity sheets',
    async () => {
      const buffer = readFileSync(attachedWorkbook)
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      )
      const result = await parseWorkbook(arrayBuffer)
      const may2025 = result.autoRows.find(
        (bill) => bill.year === 2025 && bill.month === 5,
      )

      expect(result.autoRows.length).toBeGreaterThanOrEqual(60)
      expect(may2025?.usageKwh).toBe(29232)
      expect(may2025?.totalBillWon).toBe(4897870)
    },
  )

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
      '사용전력량(kWh)': '48,365',
      '청구요금(원)': '7,138,790',
    })
    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 6,
      usageKwh: 48365,
      totalBillWon: 7138790,
      appliedPowerKw: 493,
      note: '파워플래너 월별청구요금 업로드',
    })
  })

  it('keeps Korean headers intact when reading a UTF-8 Power Planner CSV', async () => {
    const csv = [
      '연월,사용전력량(kWh),청구요금(원),요금적용전력(kW)',
      '2026년 06월,48365,7138790,493',
      '2026년 07월,50120,7421000,498',
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
      '사용전력량(kWh)': '48365',
      '청구요금(원)': '7138790',
      '요금적용전력(kW)': '493',
    })
  })

  it.runIf(existsSync(attachedPowerPlannerWorkbook))(
    'reads the provided Power Planner monthly bill export',
    async () => {
      const buffer = readFileSync(attachedPowerPlannerWorkbook)
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      )
      const result = await parseWorkbook(arrayBuffer)

      expect(result.sheets[0].headers).toContain('연월')
      expect(result.sheets[0].headers).toContain('사용전력량(kWh)')
      expect(result.sheets[0].headers).toContain('청구요금(원)')
      expect(result.autoRows.length).toBeGreaterThanOrEqual(11)
      expect(result.autoRows[0]).toMatchObject({
        year: 2026,
        month: 6,
        usageKwh: 48365,
        totalBillWon: 7138790,
      })
    },
  )
})
