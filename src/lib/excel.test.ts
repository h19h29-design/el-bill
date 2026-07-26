import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  getWorkbookLimitMessage,
  mapRowsToBills,
  parseWorkbook,
  validateUploadFile,
} from './excel'

const currentPlan = {
  id: 'current',
  contractType: '교육용(갑)',
  voltageType: '고압A',
  planName: '선택요금Ⅱ',
  baseRateWonPerKw: 7100,
  seasonRates: {
    springAutumn: 77.7,
    summer: 111.1,
    winter: 99.9,
  },
  effectiveFrom: '2026-01-01',
  memo: '테스트 요금제',
}

const toArrayBuffer = (buffer: ArrayBuffer | Uint8Array) =>
  buffer instanceof ArrayBuffer
    ? buffer
    : buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer

const createSyntheticWorkbook = async () => {
  const workbook = new ExcelJS.Workbook()
  const yearlyRows: Array<{ year: number; rows: number[][] }> = [
    { year: 2025, rows: [[11, 31_200, 5_180_000], [12, 47_600, 7_890_000]] },
    { year: 2026, rows: [[1, 49_200, 8_160_000], [2, 45_400, 7_530_000]] },
  ]

  for (const { year, rows } of yearlyRows) {
    const sheet = workbook.addWorksheet(`${year} 시연`)
    sheet.addRows([
      ['월분', '사용량(kWh)', `${year}학년도`],
      ...rows,
    ])
  }

  return toArrayBuffer(await workbook.xlsx.writeBuffer())
}

const createFormulaWorkbook = async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('2026 시연')
  sheet.addRow(['월분', '사용량(kWh)', '2026학년도'])
  sheet.addRow([6, 42_000, { formula: '4200000+2220000', result: 6_420_000 }])
  return toArrayBuffer(await workbook.xlsx.writeBuffer())
}

const createWorkbookWithShape = async (rows: number, columns: number) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('2026 시연')
  sheet.addRow(Array.from({ length: columns }, (_, index) => `열${index + 1}`))
  for (let index = 1; index < rows; index += 1) {
    sheet.addRow(Array.from({ length: columns }, () => index))
  }
  return toArrayBuffer(await workbook.xlsx.writeBuffer())
}

const createZipCentralDirectory = ({
  entries,
  uncompressedBytes,
}: {
  entries: number
  uncompressedBytes: number
}) => {
  const entrySize = 47
  const centralDirectorySize = entries * entrySize
  const output = new Uint8Array(centralDirectorySize + 22)
  const view = new DataView(output.buffer)

  for (let index = 0; index < entries; index += 1) {
    const offset = index * entrySize
    view.setUint32(offset, 0x02014b50, true)
    view.setUint32(offset + 20, 1, true)
    view.setUint32(offset + 24, uncompressedBytes, true)
    view.setUint16(offset + 28, 1, true)
    output[offset + 46] = 97
  }

  const eocdOffset = centralDirectorySize
  view.setUint32(eocdOffset, 0x06054b50, true)
  view.setUint16(eocdOffset + 8, entries, true)
  view.setUint16(eocdOffset + 10, entries, true)
  view.setUint32(eocdOffset + 12, centralDirectorySize, true)
  return output.buffer
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
  it('parses the checked-in synthetic XLSX fixture', async () => {
    const buffer = await readFile('e2e/fixtures/monthly-bills.xlsx')
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer

    const result = await parseWorkbook(arrayBuffer, {
      appliedPowerKw: 620,
      currentPlan,
    })

    expect(result.autoRows).toHaveLength(12)
    expect(result.autoRows[0]?.observedFields).toContain('totalBillWon')
  })

  it('rejects legacy binary XLS files with a conversion instruction', async () => {
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'legacy.xls')

    await expect(parseWorkbook(file)).rejects.toThrow(
      '이 형식은 지원하지 않습니다. 한전/Excel에서 XLSX 또는 CSV로 다시 저장해 주세요.',
    )
  })

  it('rejects a CFBF binary renamed as XLSX', async () => {
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'renamed.xlsx')

    await expect(parseWorkbook(file)).rejects.toThrow(
      '이 형식은 지원하지 않습니다. 한전/Excel에서 XLSX 또는 CSV로 다시 저장해 주세요.',
    )
  })

  it('wraps malformed XLSX errors in a conversion instruction', async () => {
    const file = new File(['not a zip file'], 'broken.xlsx')

    await expect(parseWorkbook(file)).rejects.toThrow(
      '이 형식은 지원하지 않습니다. 한전/Excel에서 XLSX 또는 CSV로 다시 저장해 주세요.',
    )
  })

  it('rejects XLSX metadata with excessive uncompressed bytes before loading', async () => {
    await expect(
      parseWorkbook(createZipCentralDirectory({ entries: 1, uncompressedBytes: 50 * 1024 * 1024 + 1 })),
    ).rejects.toThrow('압축 해제 예상 크기가 50MB를 초과')
  })

  it('rejects XLSX metadata with too many ZIP entries before loading', async () => {
    await expect(
      parseWorkbook(createZipCentralDirectory({ entries: 201, uncompressedBytes: 1 })),
    ).rejects.toThrow('XLSX 내부 파일 수가 200개를 초과')
  })

  it('rejects an oversized browser upload before parsing', () => {
    const message = validateUploadFile({
      name: 'oversized.xlsx',
      size: 10 * 1024 * 1024 + 1,
    })

    expect(message).toContain('10MB')
  })

  it('rejects a compressed XLSX upload larger than 10MB before parsing', async () => {
    const file = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      'large-compressed.xlsx',
    )

    await expect(parseWorkbook(file)).rejects.toThrow(
      '파일 크기는 10MB 이하만 분석할 수 있습니다.',
    )
  })

  it('rejects an oversized ArrayBuffer before parsing', async () => {
    await expect(
      parseWorkbook(new ArrayBuffer(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow('파일 크기는 10MB 이하만 분석할 수 있습니다.')
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

  it('rejects an XLSX with more than 10,000 actual rows before cell extraction', async () => {
    await expect(parseWorkbook(await createWorkbookWithShape(10_001, 1))).rejects.toThrow(
      '전체 데이터가 10,000행을 초과',
    )
  })

  it('rejects an XLSX with more than 256 columns before cell extraction', async () => {
    await expect(parseWorkbook(await createWorkbookWithShape(1, 257))).rejects.toThrow(
      '시트 열 수가 256개를 초과',
    )
  })

  it('rejects CSV rows over the 10,000-row limit with quoted newlines', async () => {
    const rows = Array.from(
      { length: 10_001 },
      (_, index) => `2026,${index + 1},"42,000\ncontinued",6420000`,
    )
    const file = new File(
      [['연도,월,사용량,총 전기요금', ...rows].join('\n')],
      'large.csv',
    )

    await expect(parseWorkbook(file)).rejects.toThrow('전체 데이터가 10,000행을 초과')
  })

  it('rejects PowerPlanner HTML rows over the 10,000-row limit', async () => {
    const rows = Array.from(
      { length: 10_001 },
      () => '<tr><td aria-describedby="grid_YEAR_ROW">2026년 6월</td></tr>',
    ).join('')
    const file = new File(
      [`<table class="ui-jqgrid"><tbody>${rows}</tbody></table>`],
      'large-power-planner.xls',
    )

    await expect(parseWorkbook(file)).rejects.toThrow('전체 데이터가 10,000행을 초과')
  })

  it('auto-merges a deterministic in-memory yearly workbook', async () => {
    const result = await parseWorkbook(await createSyntheticWorkbook())

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

  it('keeps yearly and Power Planner charge fallbacks distinct from observed fields', async () => {
    const context = { appliedPowerKw: 620, currentPlan }
    const yearly = await parseWorkbook(await createSyntheticWorkbook(), context)
    const yearlyBill = yearly.autoRows[0]

    expect(yearlyBill).toMatchObject({
      appliedPowerKw: 620,
      maxDemandKw: 0,
      baseChargeWon: 620 * currentPlan.baseRateWonPerKw,
      energyChargeWon: Math.round(31_200 * currentPlan.seasonRates.springAutumn),
    })
    expect(yearlyBill?.observedFields).not.toContain('appliedPowerKw')
    expect(yearlyBill?.observedFields).not.toContain('baseChargeWon')
    expect(yearlyBill?.observedFields).not.toContain('energyChargeWon')
    expect(yearlyBill?.observedFields).not.toContain('maxDemandKw')

    const powerPlanner = await parseWorkbook(
      new TextEncoder().encode(powerPlannerHtmlFixture).buffer,
      context,
    )
    const powerPlannerBill = powerPlanner.autoRows[0]

    expect(powerPlannerBill).toMatchObject({
      appliedPowerKw: 450,
      maxDemandKw: 0,
      baseChargeWon: 450 * currentPlan.baseRateWonPerKw,
      energyChargeWon: Math.round(42_000 * currentPlan.seasonRates.summer),
    })
    expect(powerPlannerBill?.observedFields).toContain('appliedPowerKw')
    expect(powerPlannerBill?.observedFields).not.toContain('baseChargeWon')
    expect(powerPlannerBill?.observedFields).not.toContain('energyChargeWon')
    expect(powerPlannerBill?.observedFields).not.toContain('maxDemandKw')
  })

  it('uses a formula cached result without evaluating the formula', async () => {
    const result = await parseWorkbook(await createFormulaWorkbook())

    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 6,
      usageKwh: 42_000,
      totalBillWon: 6_420_000,
    })
  })

  it('treats blank Power Planner applied power as an inferred profile fallback', async () => {
    const blankAppliedPowerFixture = powerPlannerHtmlFixture.replace(
      'title="450" aria-describedby="grid_JOJ_KW">450',
      'title="" aria-describedby="grid_JOJ_KW"></td>',
    )
    const result = await parseWorkbook(
      new TextEncoder().encode(blankAppliedPowerFixture).buffer,
      { appliedPowerKw: 620, currentPlan },
    )

    expect(result.autoRows[0]).toMatchObject({
      appliedPowerKw: 620,
      maxDemandKw: 0,
    })
    expect(result.autoRows[0]?.observedFields).not.toContain('appliedPowerKw')
    expect(result.autoRows[0]?.observedFields).not.toContain('maxDemandKw')
  })

  it('normalizes a KEPCO Power Planner HTML xls export', async () => {
    const result = await parseWorkbook(
      new File([powerPlannerHtmlFixture], 'power-planner-monthly.xls', {
        type: 'application/vnd.ms-excel',
      }),
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
    expect(result.autoRows[0]?.maxDemandKw).toBe(0)
  })

  it('uses profile defaults without pretending they were observed', () => {
    const [bill] = mapRowsToBills(
      [
        {
          연도: 2026,
          월: 6,
          사용량: 42_000,
          '총 전기요금': 6_420_000,
        },
      ],
      {
        year: '연도',
        month: '월',
        usageKwh: '사용량',
        totalBillWon: '총 전기요금',
      },
      { appliedPowerKw: 620, currentPlan },
    )

    expect(bill?.appliedPowerKw).toBe(620)
    expect(bill?.maxDemandKw).toBe(0)
    expect(bill?.observedFields).toContain('year')
    expect(bill?.observedFields).toContain('totalBillWon')
    expect(bill?.observedFields).not.toContain('appliedPowerKw')
    expect(bill?.observedFields).not.toContain('maxDemandKw')
    expect(bill?.baseChargeWon).toBe(620 * currentPlan.baseRateWonPerKw)
    expect(bill?.energyChargeWon).toBe(Math.round(42_000 * currentPlan.seasonRates.summer))
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
