import type { BillImportContext } from '../types'
import {
  mapRowsToBills,
  type WorkbookParseResult,
} from './excel'

export interface BillPdfTextPage {
  pageNumber: number
  lines: string[]
}

export interface BillPdfTextItem {
  str: string
  x: number
  y: number
  height: number
}

export interface BillPdfTextSource {
  sourceLabel: string
  pages: BillPdfTextPage[]
}

const maxPdfFileBytes = 10 * 1024 * 1024
const maxPdfSelectionBytes = 50 * 1024 * 1024
const maxPdfFiles = 36
const maxPdfPages = 72
const maxPdfTextCharacters = 500_000

export const validateBillPdfFile = (
  file: Pick<File, 'name' | 'size'>,
): string | null => {
  if (!/\.pdf$/i.test(file.name)) {
    return '한전 고지서 PDF(.pdf) 파일만 선택해 주세요.'
  }
  if (file.size > maxPdfFileBytes) {
    return 'PDF 파일은 한 개당 10MB 이하만 분석할 수 있습니다.'
  }
  return null
}

export const groupBillPdfTextItems = (
  items: BillPdfTextItem[],
): string[] => {
  const lineGroups: Array<{
    y: number
    height: number
    items: BillPdfTextItem[]
  }> = []
  const sorted = [...items]
    .filter((item) => normalizeLine(item.str))
    .sort((left, right) => right.y - left.y || left.x - right.x)

  for (const item of sorted) {
    const line = lineGroups.find(
      (candidate) =>
        Math.abs(candidate.y - item.y) <=
        Math.max(2, candidate.height * 0.45, item.height * 0.45),
    )
    if (line) {
      line.items.push(item)
      continue
    }
    lineGroups.push({
      y: item.y,
      height: item.height,
      items: [item],
    })
  }

  return lineGroups
    .sort((left, right) => right.y - left.y)
    .map((line) =>
      line.items
        .sort((left, right) => left.x - right.x)
        .map((item) => normalizeLine(item.str))
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
}

const pdfHeaders = [
  '연도',
  '월',
  '사용량',
  '총 전기요금',
  '요금적용전력',
  '최대수요전력',
  '기본요금',
  '전력량요금',
  '역률요금',
  '기후환경요금',
  '연료비조정액',
  '부가세',
  '전력산업기반기금',
  '메모',
] as const

const pdfMapping = {
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

const normalizeLine = (line: string) =>
  line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

const compactForRecognition = (line: string) =>
  normalizeLine(line).replace(/\s+/g, '')

const parseNumber = (value: string | undefined) => {
  if (!value) return undefined
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

const findLabeledNumber = (
  lines: string[],
  labels: RegExp[],
): number | undefined => {
  const normalized = lines.map(normalizeLine)
  const sameLineCandidates = normalized.flatMap((line) => [
    line,
    compactForRecognition(line),
  ])
  const adjacentLineCandidates = normalized.flatMap((line, index) => {
    const next = normalized[index + 1]
    if (/\d/.test(line) || !next || !/^[\s:：]*[+-]?\d/.test(next)) return []
    const joined = `${line} ${next}`
    return [joined, compactForRecognition(joined)]
  })

  for (const label of labels) {
    for (const line of [...sameLineCandidates, ...adjacentLineCandidates]) {
      const match = line.match(
        new RegExp(
          `${label.source}\\s*[:：]?\\s*([+-]?\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:kwh|kw|원)?`,
          'i',
        ),
      )
      const value = parseNumber(match?.[1])
      if (value !== undefined) return value
    }
  }
  return undefined
}

const findBillingPeriod = (lines: string[]) => {
  const normalized = lines.map(normalizeLine)
  const compact = normalized.map(compactForRecognition)
  const searchable = normalized.flatMap((line, index) => [line, compact[index]])
  const prioritized = searchable.filter((line) =>
    /청구년월|월\s*분|전기요금\s*청구|전기요금청구|billing\s*(?:month|period)/i.test(
      line,
    ),
  )
  const candidates = [...prioritized, ...searchable]

  for (const line of candidates) {
    const korean = line.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월(?:분)?/)
    const delimited = line.match(
      /(20\d{2})\s*[./-]\s*(\d{1,2})(?:\s*월(?:분)?)?/,
    )
    const english = line.match(
      /billing\s*(?:month|period)\s*[:：]?\s*(20\d{2})\s*[./-]\s*(\d{1,2})/i,
    )
    const match = korean ?? english ?? delimited
    if (!match) continue
    const year = Number(match[1])
    const month = Number(match[2])
    if (month >= 1 && month <= 12) return { year, month }
  }

  return null
}

const recognizePage = (page: BillPdfTextPage) => {
  const lines = page.lines.map(normalizeLine).filter(Boolean)
  const period = findBillingPeriod(lines)
  const usageKwh = findLabeledNumber(lines, [
    /당월\s*사용량/,
    /사용전력량/,
    /(?:^|\s)사용량/,
    /(?:^|\s)usage/,
  ])
  const totalBillWon = findLabeledNumber(lines, [
    /청구금액/,
    /납부금액/,
    /당월요금계/,
    /total\s*amount/,
  ])
  const missing = [
    !period ? '청구년월' : '',
    usageKwh === undefined || usageKwh <= 0 ? '사용량' : '',
    totalBillWon === undefined || totalBillWon <= 0 ? '청구금액' : '',
  ].filter(Boolean)

  if (missing.length || !period || !usageKwh || !totalBillWon) {
    return { row: null, missing }
  }

  const optionalValues = {
    요금적용전력: findLabeledNumber(lines, [/요금적용전력/]),
    최대수요전력: findLabeledNumber(lines, [/최대수요전력/]),
    기본요금: findLabeledNumber(lines, [/기본요금/]),
    전력량요금: findLabeledNumber(lines, [/전력량요금/]),
    역률요금: findLabeledNumber(lines, [/역률요금/]),
    기후환경요금: findLabeledNumber(lines, [/기후환경요금/]),
    연료비조정액: findLabeledNumber(lines, [/연료비조정액/]),
    부가세: findLabeledNumber(lines, [/부가가치세/, /부가세/]),
    전력산업기반기금: findLabeledNumber(lines, [
      /전력산업기반기금/,
      /전력기금/,
    ]),
  }

  return {
    missing: [],
    row: {
      연도: period.year,
      월: period.month,
      사용량: usageKwh,
      '총 전기요금': totalBillWon,
      ...Object.fromEntries(
        Object.entries(optionalValues).filter(([, value]) => value !== undefined),
      ),
      메모: '한전 고지서 PDF 자동 인식',
    },
  }
}

export const parseBillPdfTextPages = (
  pages: BillPdfTextPage[],
  context: BillImportContext | undefined,
  sourceLabel: string,
): WorkbookParseResult => {
  const hasText = pages.some((page) =>
    page.lines.some((line) => normalizeLine(line)),
  )
  if (!hasText) {
    throw new Error(
      'PDF에서 텍스트를 읽지 못했습니다. 이미지형 또는 스캔 고지서는 아래 무료 AI 변환 도우미를 사용해 주세요.',
    )
  }

  const recognized = pages.map((page) => ({
    page,
    ...recognizePage(page),
  }))
  const rows = recognized.flatMap(({ row }) => row ? [row] : [])
  if (!rows.length) {
    throw new Error(
      'PDF에서 청구년월, 사용량과 청구금액을 모두 찾지 못했습니다. 아래 무료 AI 변환 도우미를 사용하거나 표준 CSV로 변환해 주세요.',
    )
  }

  const autoRows = mapRowsToBills(rows, pdfMapping, context)
  if (!autoRows.length) {
    throw new Error(
      'PDF에서 읽은 고지서 값이 올바르지 않습니다. 아래 무료 AI 변환 도우미를 사용하거나 표준 CSV로 변환해 주세요.',
    )
  }

  return {
    sheets: [{
      name: sourceLabel,
      headers: [...pdfHeaders],
      rows,
    }],
    autoRows,
    diagnostics: [
      `${sourceLabel}: PDF 텍스트를 브라우저에서 읽었습니다.`,
      ...recognized.flatMap(({ page, missing }) =>
        missing.length
          ? [`${page.pageNumber}쪽: ${missing.join(', ')} 항목을 찾지 못해 제외했습니다.`]
          : [],
      ),
    ],
  }
}

const assertPdfTextSourceLimits = (sources: BillPdfTextSource[]) => {
  const totalPages = sources.reduce(
    (sum, source) => sum + source.pages.length,
    0,
  )
  if (totalPages > maxPdfPages) {
    throw new Error(
      `선택한 PDF는 합계 최대 ${maxPdfPages}쪽까지만 분석할 수 있습니다. 파일 수를 줄여 다시 선택해 주세요.`,
    )
  }
  const totalTextCharacters = sources.reduce(
    (sum, source) =>
      sum +
      source.pages.reduce(
        (pageSum, page) =>
          pageSum + page.lines.reduce((lineSum, line) => lineSum + line.length, 0),
        0,
      ),
    0,
  )
  if (totalTextCharacters > maxPdfTextCharacters) {
    throw new Error(
      '선택한 PDF 텍스트가 합계 500,000자를 초과했습니다. 필요한 고지서만 나눠 선택해 주세요.',
    )
  }
}

export const parseBillPdfTextSources = (
  sources: BillPdfTextSource[],
  context?: BillImportContext,
): WorkbookParseResult => {
  assertPdfTextSourceLimits(sources)

  const parsed: WorkbookParseResult[] = []
  const diagnostics: string[] = []

  for (const source of sources) {
    try {
      parsed.push(
        parseBillPdfTextPages(source.pages, context, source.sourceLabel),
      )
    } catch (error) {
      diagnostics.push(
        `${source.sourceLabel}: ${
          error instanceof Error
            ? error.message
            : 'PDF 고지서를 읽지 못했습니다.'
        }`,
      )
    }
  }

  if (!parsed.length) {
    throw new Error(
      diagnostics.join(' ') ||
        '선택한 PDF에서 고지서 데이터를 읽지 못했습니다. 아래 무료 AI 변환 도우미를 사용해 주세요.',
    )
  }

  return {
    sheets: parsed.flatMap((result) => result.sheets),
    autoRows: parsed
      .flatMap((result) => result.autoRows)
      .sort((left, right) =>
        left.year * 12 + left.month - (right.year * 12 + right.month),
      ),
    diagnostics: [
      ...parsed.flatMap((result) => result.diagnostics),
      ...diagnostics,
    ],
  }
}

const hasPdfSignature = (buffer: ArrayBuffer) => {
  const header = new TextDecoder('latin1').decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1_024)),
  )
  return header.includes('%PDF-')
}

const pdfErrorMessage = (error: unknown) => {
  if (
    error instanceof Error &&
    /password/i.test(`${error.name} ${error.message}`)
  ) {
    return '암호가 설정된 PDF는 읽을 수 없습니다. 암호를 해제한 사본을 사용해 주세요.'
  }
  return 'PDF 내용을 읽지 못했습니다. 파일이 손상되지 않았는지 확인하거나 아래 무료 AI 변환 도우미를 사용해 주세요.'
}

export const extractBillPdfTextPages = async (
  file: File,
): Promise<BillPdfTextPage[]> => {
  const validationMessage = validateBillPdfFile(file)
  if (validationMessage) throw new Error(validationMessage)

  const buffer = await file.arrayBuffer()
  if (!hasPdfSignature(buffer)) {
    throw new Error('올바른 PDF 파일이 아닙니다. 한전에서 받은 PDF 원본을 선택해 주세요.')
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  let browserWorker: Worker | null = null
  let pdfWorker: InstanceType<typeof pdfjs.PDFWorker> | undefined
  if (typeof window !== 'undefined') {
    const workerModule = await import(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'
    )
    browserWorker = new workerModule.default()
    pdfWorker = pdfjs.PDFWorker.create({ port: browserWorker })
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    stopAtErrors: true,
    useSystemFonts: true,
    ...(pdfWorker ? { worker: pdfWorker } : {}),
  })

  try {
    const document = await loadingTask.promise
    if (document.numPages > maxPdfPages) {
      throw new Error(
        `PDF는 최대 ${maxPdfPages}쪽까지만 분석할 수 있습니다. 파일을 나눠 다시 선택해 주세요.`,
      )
    }

    let textCharacters = 0
    const pages: BillPdfTextPage[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.flatMap((item) => {
        if (!('str' in item) || !item.str.trim()) return []
        const transform = item.transform
        const height =
          item.height || Math.abs(transform[3] ?? 0) || 10
        textCharacters += item.str.length
        if (textCharacters > maxPdfTextCharacters) {
          throw new Error(
            'PDF 텍스트가 500,000자를 초과하여 분석을 중단했습니다. 필요한 고지서 페이지만 나눠 선택해 주세요.',
          )
        }
        return [{
          str: item.str,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          height,
        }]
      })
      pages.push({
        pageNumber,
        lines: groupBillPdfTextItems(items),
      })
      page.cleanup()
    }
    return pages
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message.includes('최대') ||
        error.message.includes('500,000자')
      )
    ) {
      throw error
    }
    throw new Error(pdfErrorMessage(error))
  } finally {
    try {
      await loadingTask.destroy()
    } catch {
      // Parsing has already finished or reported its reader-facing error.
    }
    browserWorker?.terminate()
  }
}

export const parseBillPdfFiles = async (
  files: File[],
  context?: BillImportContext,
): Promise<WorkbookParseResult> => {
  if (!files.length) {
    throw new Error('분석할 한전 고지서 PDF를 선택해 주세요.')
  }
  if (files.length > maxPdfFiles) {
    throw new Error(`PDF 고지서는 한 번에 최대 ${maxPdfFiles}개까지 선택할 수 있습니다.`)
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > maxPdfSelectionBytes) {
    throw new Error('선택한 PDF 전체 크기는 50MB 이하만 분석할 수 있습니다.')
  }
  for (const file of files) {
    const validationMessage = validateBillPdfFile(file)
    if (validationMessage) throw new Error(`${file.name}: ${validationMessage}`)
  }

  const sources: BillPdfTextSource[] = []
  const extractionDiagnostics: string[] = []
  for (const file of files) {
    let pages: BillPdfTextPage[]
    try {
      pages = await extractBillPdfTextPages(file)
    } catch (error) {
      extractionDiagnostics.push(
        `${file.name}: ${
          error instanceof Error
            ? error.message
            : 'PDF 내용을 읽지 못했습니다.'
        }`,
      )
      continue
    }
    const nextSource = { sourceLabel: file.name, pages }
    assertPdfTextSourceLimits([...sources, nextSource])
    sources.push(nextSource)
  }

  if (!sources.length) throw new Error(extractionDiagnostics.join(' '))

  try {
    const result = parseBillPdfTextSources(sources, context)
    return {
      ...result,
      diagnostics: [...result.diagnostics, ...extractionDiagnostics],
    }
  } catch (error) {
    throw new Error(
      [
        error instanceof Error
          ? error.message
          : '선택한 PDF에서 고지서 데이터를 읽지 못했습니다.',
        ...extractionDiagnostics,
      ].join(' '),
    )
  }
}
