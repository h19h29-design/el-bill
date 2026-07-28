import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { defaultRatePlans } from '../data/ratePlans'
import { defaultSchoolProfile } from '../data/sampleBills'
import { getObservedBillFields } from '../types'
import {
  extractBillPdfTextPages,
  groupBillPdfTextItems,
  parseBillPdfFiles,
  parseBillPdfTextPages,
  parseBillPdfTextSources,
  validateBillPdfFile,
  type BillPdfTextPage,
} from './billPdf'

const currentPlan = defaultRatePlans.find(
  (plan) =>
    plan.contractType === defaultSchoolProfile.contractType &&
    plan.voltageType === defaultSchoolProfile.voltageType &&
    plan.planName === defaultSchoolProfile.currentPlan,
)

if (!currentPlan) throw new Error('test rate plan missing')

const importContext = {
  appliedPowerKw: defaultSchoolProfile.appliedPowerKw,
  currentPlan,
}

const officialBillPage = (
  patch: Partial<BillPdfTextPage> = {},
): BillPdfTextPage => ({
  pageNumber: 1,
  lines: [
    '한국전력공사 A고등학교 고객님의 2026년 06월 전기요금청구 및 영수증',
    '청구내역',
    '기본요금 3,165,890',
    '전력량요금 2,399,947',
    '역률요금 -15,000',
    '기후환경요금 410,000',
    '연료비조정액 -120,000',
    '부가가치세 580,000',
    '전력기금 180,000',
    '청구금액 6,420,000원',
    '고객번호 1234567890',
    '고객전용 지정계좌 110-123-456789',
    '요금적용전력 497kW',
    '최대수요전력 510kW',
    '계량기지침비교',
    '사용량 42,000kWh',
    '사용량비교 당월 42,000kWh 전월 40,000kWh 전년동월 39,000kWh',
  ],
  ...patch,
})

describe('bill PDF text recognition', () => {
  it('reconstructs readable lines from positioned PDF text items', () => {
    expect(
      groupBillPdfTextItems([
        { str: '42,000kWh', x: 180, y: 700, height: 10 },
        { str: '사용량', x: 40, y: 700.5, height: 10 },
        { str: '6,420,000원', x: 180, y: 680, height: 10 },
        { str: '청구금액', x: 40, y: 680, height: 10 },
      ]),
    ).toEqual([
      '사용량 42,000kWh',
      '청구금액 6,420,000원',
    ])
  })

  it('validates PDF extension, size, and selection count', () => {
    expect(validateBillPdfFile({ name: 'bill.pdf', size: 1_000 })).toBeNull()
    expect(validateBillPdfFile({ name: 'bill.png', size: 1_000 })).toMatch(
      /PDF/,
    )
    expect(
      validateBillPdfFile({ name: 'bill.pdf', size: 10 * 1024 * 1024 + 1 }),
    ).toMatch(/10MB/)
  })

  it('extracts text from a real PDF and converts it through the normal result', async () => {
    const document = new jsPDF()
    document.text('BILLING MONTH 2026-07', 20, 20)
    document.text('USAGE 43000 kWh', 20, 30)
    document.text('TOTAL AMOUNT 6500000 KRW', 20, 40)
    const file = new File(
      [new Uint8Array(document.output('arraybuffer'))],
      'official-bill.pdf',
      { type: 'application/pdf' },
    )

    const pages = await extractBillPdfTextPages(file)
    expect(pages).toHaveLength(1)
    expect(pages[0].lines.join(' ')).toContain('BILLING MONTH 2026-07')

    const result = await parseBillPdfFiles([file], importContext)
    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 7,
      usageKwh: 43_000,
      totalBillWon: 6_500_000,
    })
  })

  it('keeps valid monthly PDFs when another selected file cannot be parsed', async () => {
    const document = new jsPDF()
    document.text('BILLING MONTH 2026-07', 20, 20)
    document.text('USAGE 43000 kWh', 20, 30)
    document.text('TOTAL AMOUNT 6500000 KRW', 20, 40)
    const valid = new File(
      [new Uint8Array(document.output('arraybuffer'))],
      '2026-07.pdf',
      { type: 'application/pdf' },
    )
    const unreadable = new File(
      ['%PDF-1.7\nnot a complete PDF'],
      '2026-08-unreadable.pdf',
      { type: 'application/pdf' },
    )

    const result = await parseBillPdfFiles([valid, unreadable], importContext)

    expect(result.autoRows).toHaveLength(1)
    expect(result.diagnostics.join(' ')).toContain('2026-08-unreadable.pdf')
    expect(result.diagnostics.join(' ')).toContain('읽지 못했습니다')
  })

  it('rejects files whose content is not a PDF', async () => {
    const file = new File(['not-a-pdf'], 'fake.pdf', {
      type: 'application/pdf',
    })

    await expect(extractBillPdfTextPages(file)).rejects.toThrow(
      /올바른 PDF 파일이 아닙니다/,
    )
  })

  it('converts official KEPCO bill labels into one normalized monthly bill', () => {
    const result = parseBillPdfTextPages(
      [officialBillPage()],
      importContext,
      '2026-06-bill.pdf',
    )

    expect(result.autoRows).toHaveLength(1)
    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 6,
      usageKwh: 42_000,
      totalBillWon: 6_420_000,
      appliedPowerKw: 497,
      maxDemandKw: 510,
      baseChargeWon: 3_165_890,
      energyChargeWon: 2_399_947,
      powerFactorChargeWon: -15_000,
      climateChargeWon: 410_000,
      fuelAdjustmentWon: -120_000,
      vatWon: 580_000,
      fundWon: 180_000,
      note: '한전 고지서 PDF 자동 인식',
    })
    expect(getObservedBillFields(result.autoRows[0])).toEqual(
      expect.arrayContaining([
        'appliedPowerKw',
        'maxDemandKw',
        'baseChargeWon',
        'energyChargeWon',
        'powerFactorChargeWon',
        'climateChargeWon',
        'fuelAdjustmentWon',
        'vatWon',
        'fundWon',
      ]),
    )
    expect(JSON.stringify(result)).not.toContain('1234567890')
    expect(JSON.stringify(result)).not.toContain('110-123-456789')
  })

  it('keeps valid pages and reports pages whose required values are missing', () => {
    const result = parseBillPdfTextPages(
      [
        officialBillPage(),
        {
          pageNumber: 2,
          lines: [
            '한국전력공사 2026년 07월 전기요금청구',
            '청구금액 6,500,000원',
          ],
        },
      ],
      importContext,
      'two-pages.pdf',
    )

    expect(result.autoRows).toHaveLength(1)
    expect(result.diagnostics.join(' ')).toContain('2쪽')
    expect(result.diagnostics.join(' ')).toContain('사용량')
  })

  it('combines several monthly PDF sources without retaining their private text', () => {
    const july = officialBillPage({
      lines: [
        '2026년 07월 전기요금청구',
        '사용량 43,000kWh',
        '청구금액 6,500,000원',
        '고객번호 9999888877',
      ],
    })
    const result = parseBillPdfTextSources(
      [
        { sourceLabel: 'june.pdf', pages: [officialBillPage()] },
        { sourceLabel: 'july.pdf', pages: [july] },
      ],
      importContext,
    )

    expect(result.autoRows.map(({ year, month }) => `${year}-${month}`)).toEqual(
      ['2026-6', '2026-7'],
    )
    expect(result.sheets.map(({ name }) => name)).toEqual([
      'june.pdf',
      'july.pdf',
    ])
    expect(JSON.stringify(result)).not.toContain('9999888877')
  })

  it('rejects a multi-file selection that exceeds the total PDF page limit', () => {
    expect(() =>
      parseBillPdfTextSources(
        [{
          sourceLabel: 'too-many-pages.pdf',
          pages: Array.from({ length: 73 }, (_, index) =>
            officialBillPage({ pageNumber: index + 1 }),
          ),
        }],
        importContext,
      ),
    ).toThrow(/최대 72쪽/)
  })

  it('uses the billed amount and current usage instead of comparison values', () => {
    const result = parseBillPdfTextPages(
      [
        officialBillPage({
          lines: [
            '2026년 08월 전기요금청구',
            '전기요금계 5,200,000',
            '당월요금계 5,850,000',
            '청구금액 6,100,000원',
            '사용량비교 전월 88,000kWh 전년동월 91,000kWh',
            '당월 사용량 47,500kWh',
          ],
        }),
      ],
      importContext,
      'priority.pdf',
    )

    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 8,
      usageKwh: 47_500,
      totalBillWon: 6_100_000,
    })
  })

  it('recognizes labels split by PDF text spacing and values on the following line', () => {
    const result = parseBillPdfTextPages(
      [{
        pageNumber: 1,
        lines: [
          '청 구 년 월 2026년 9월',
          '사 용 량',
          '48,250 kWh',
          '청 구 금 액',
          '7,210,000 원',
        ],
      }],
      importContext,
      'spaced-labels.pdf',
    )

    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 9,
      usageKwh: 48_250,
      totalBillWon: 7_210_000,
    })
  })

  it('combines a multi-page internet bill and prefers the billed maximum demand', () => {
    const result = parseBillPdfTextPages(
      [
        {
          pageNumber: 1,
          lines: [
            '2026년 07월분 전기요금 청구서 및 영수증',
            '기본요금 789,880',
            '전력량요금 1,218,412',
            '지상역률요금 -7,898(97.0)',
            '진상역률요금 30,015(76.0)',
            '당월요금계 2,450,080',
            '청구금액 2,450,080 원',
            '당월지침 470.43 kWh',
            '당월 10,256 kWh',
          ],
        },
        {
          pageNumber: 2,
          lines: [
            '요금적용전력 124',
            '2026년 07월 최대전력수요 : 44 kw',
          ],
        },
        {
          pageNumber: 3,
          lines: [
            '최대수요전력(주간) 2.574',
            '사용량 10,256',
            '지상역률요금 -7,898 기본요금 X (0.0%)',
            '진상역률요금 30,015 기본요금 X (3.8%)',
          ],
        },
      ],
      importContext,
      'internet-bill.pdf',
    )

    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 7,
      usageKwh: 10_256,
      totalBillWon: 2_450_080,
      appliedPowerKw: 124,
      maxDemandKw: 44,
      powerFactorChargeWon: 22_117,
    })
    expect(result.diagnostics.join(' ')).toContain('3쪽 전체')
  })

  it('recognizes the first whole-number kWh value in a legacy email bill', () => {
    const result = parseBillPdfTextPages(
      [{
        pageNumber: 1,
        lines: [
          '고객님의 2026년 02월',
          '계약종별 교육용(갑)고압A 339.77 25,020 kWh',
          '정기검침일 매월 15 일 270.27 24,192 kWh',
          '전기요금계 3,765,416',
          '당월요금계 4,243,610',
        ],
      }],
      importContext,
      'legacy-email-bill.pdf',
    )

    expect(result.autoRows[0]).toMatchObject({
      year: 2026,
      month: 2,
      usageKwh: 25_020,
      totalBillWon: 4_243_610,
    })
  })

  it('rejects image-only or incomplete PDFs with a conversion-path message', () => {
    expect(() =>
      parseBillPdfTextPages(
        [{ pageNumber: 1, lines: [] }],
        importContext,
        'scan.pdf',
      ),
    ).toThrow(/텍스트를 읽지 못했습니다.*무료 AI 변환/)

    expect(() =>
      parseBillPdfTextPages(
        [{
          pageNumber: 1,
          lines: ['2026년 06월 전기요금청구', '고객번호 1234567890'],
        }],
        importContext,
        'incomplete.pdf',
      ),
    ).toThrow(/사용량과 청구금액.*무료 AI 변환/)
  })
})
