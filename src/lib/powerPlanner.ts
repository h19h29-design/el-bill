import type {
  ParsedSheet,
} from './excel'
import type {
  PowerPlannerDataSource,
  PowerPlannerDataType,
  PowerPlannerRecord,
} from '../types'
import {
  parseStrictCalendarValue,
  parseStrictMonth,
  parseStrictYear,
  type CalendarParts,
} from './calendar'

export const powerPlannerDataTypeLabels: Record<PowerPlannerDataType, string> = {
  monthlyUsage: '월별 사용량',
  dailyUsage: '일별 사용량',
  hourlyUsage: '시간대별 사용량',
  maxDemand: '최대수요전력',
  estimatedBill: '예상요금',
  patternAnalysis: '소비패턴 분석 결과',
}

export const powerPlannerUploadNotice =
  '파워플래너 사용 가능 여부는 한전 파워플래너에서 고객번호로 확인하세요. 고객번호는 한전 전기요금 청구서의 10자리 숫자입니다.'

export const powerPlannerMvpGuardrail =
  'MVP에서는 한전 계정 자동 로그인, 크롤링, 비공식 API 호출을 하지 않습니다. 사용자가 내려받거나 정리한 엑셀/CSV만 업로드합니다.'

export const POWER_PLANNER_AGGREGATE_RECORD_LIMIT = 10_000

const normalize = (value: unknown) => String(value ?? '').trim()

const asNumber = (value: unknown) => {
  if (typeof value === 'number') return value
  const cleaned = normalize(value).replace(/,/g, '')
  if (!cleaned) return undefined
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

const inferYearMonthDay = (value: unknown): Partial<CalendarParts> => {
  return parseStrictCalendarValue(value) ?? {}
}

const asDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const raw = normalize(value)
  if (!raw) return undefined
  const inferred = inferYearMonthDay(raw)
  if (!inferred.year || !inferred.month) return raw
  const month = String(inferred.month).padStart(2, '0')
  if (!inferred.day) return `${inferred.year}-${month}`
  return `${inferred.year}-${month}-${String(inferred.day).padStart(2, '0')}`
}

const inferHour = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 23
      ? value
      : undefined
  }
  const match = normalize(value).match(/^([01]?\d|2[0-3])(?:\s*시|:00)?$/)
  if (!match) return undefined
  const hour = Number(match[1])
  return hour
}

export const powerPlannerMappingFields = [
  ['date', '연월/일자/검침일'],
  ['year', '연도'],
  ['month', '월'],
  ['day', '일'],
  ['hour', '시간대'],
  ['usageKwh', '사용량(kWh)'],
  ['maxDemandKw', '최대수요전력(kW)'],
  ['estimatedBillWon', '예상/청구요금(원)'],
  ['contractPowerKw', '계약전력(kW)'],
  ['appliedPowerKw', '요금적용전력(kW)'],
  ['usageDays', '사용일수(일)'],
  ['laggingPowerFactorPercent', '지상역률(%)'],
  ['leadingPowerFactorPercent', '진상역률(%)'],
  ['loadType', '부하구분'],
  ['patternLabel', '패턴명'],
  ['patternSummary', '분석결과'],
] as const

export const requiredPowerPlannerMapping = (
  dataType: PowerPlannerDataType,
): string[] => {
  if (dataType === 'monthlyUsage') return ['date', 'usageKwh']
  if (dataType === 'dailyUsage') return ['date', 'usageKwh']
  if (dataType === 'hourlyUsage') return ['date', 'hour', 'usageKwh']
  if (dataType === 'maxDemand') return ['maxDemandKw']
  if (dataType === 'estimatedBill') return ['estimatedBillWon']
  return ['patternSummary']
}

export const getMissingPowerPlannerMappings = (
  dataType: PowerPlannerDataType,
  mapping: Record<string, string>,
) => {
  const has = (key: string) => Boolean(mapping[key])
  if (dataType === 'monthlyUsage') {
    return [
      ...(!has('date') && (!has('year') || !has('month')) ? ['date'] : []),
      ...(!has('usageKwh') ? ['usageKwh'] : []),
    ]
  }
  return requiredPowerPlannerMapping(dataType).filter((field) => !has(field))
}

export const guessPowerPlannerMapping = (
  headers: string[],
): Record<string, string> => {
  const find = (...patterns: string[]) =>
    headers.find((header) => patterns.some((pattern) => header.includes(pattern))) ??
    ''
  const findExact = (...patterns: string[]) =>
    headers.find((header) => patterns.some((pattern) => header === pattern)) ?? ''

  return {
    date: find('연월', '일자', '날짜', '검침일', '사용일'),
    year: findExact('연도', '년도', '년'),
    month: findExact('월', '사용월'),
    day: findExact('일'),
    hour: find('시간', '시각', '시간대'),
    usageKwh: find('사용전력량', '사용량', 'kWh', '전력량'),
    maxDemandKw: find('최대수요', '수요전력', '피크'),
    estimatedBillWon: find('청구요금', '예상요금', '월예상', '총요금', '전기요금'),
    contractPowerKw: find('계약전력'),
    appliedPowerKw: find('요금적용전력'),
    usageDays: find('사용일수'),
    laggingPowerFactorPercent: find('지상역률'),
    leadingPowerFactorPercent: find('진상역률'),
    loadType: find('부하', '경부하', '중간부하', '최대부하'),
    patternLabel: find('패턴', '유형'),
    patternSummary: find('분석', '결과', '내용', '메모'),
  }
}

export const guessPowerPlannerDataType = (
  headers: string[],
): PowerPlannerDataType => {
  const has = (...patterns: string[]) =>
    headers.some((header) =>
      patterns.some((pattern) => header.includes(pattern)),
    )

  if (has('시간', '시간대', '시각') && has('사용전력량', '사용량', 'kWh')) {
    return 'hourlyUsage'
  }
  if (has('연월', '사용월') && has('사용전력량', '사용량', 'kWh')) {
    return 'monthlyUsage'
  }
  if (has('최대수요', '수요전력', '피크')) return 'maxDemand'
  if (has('청구요금', '예상요금', '월예상', '전기요금')) return 'estimatedBill'
  if (has('패턴', '분석결과', '소비패턴')) return 'patternAnalysis'
  return 'hourlyUsage'
}

const powerPlannerDataTypes = new Set<PowerPlannerDataType>([
  'monthlyUsage',
  'dailyUsage',
  'hourlyUsage',
  'maxDemand',
  'estimatedBill',
  'patternAnalysis',
])

const optionalNumberInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
) =>
  value === undefined ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum &&
    (!integer || Number.isInteger(value)))

const canonicalPeriod = (
  record: Record<string, unknown>,
): CalendarParts | null | undefined => {
  const hasDate = record.date !== undefined
  const dateParts = hasDate
    ? parseStrictCalendarValue(record.date)
    : null
  if (hasDate && !dateParts) return null

  const hasSplitPeriod =
    record.year !== undefined ||
    record.month !== undefined ||
    record.day !== undefined
  if (dateParts) {
    if (
      (record.year !== undefined && record.year !== dateParts.year) ||
      (record.month !== undefined && record.month !== dateParts.month) ||
      (record.day !== undefined && record.day !== dateParts.day)
    ) {
      return null
    }
    return dateParts
  }
  if (!hasSplitPeriod) return undefined
  if (
    typeof record.year !== 'number' ||
    typeof record.month !== 'number'
  ) {
    return null
  }
  const candidate = `${record.year}-${String(record.month).padStart(2, '0')}${
    record.day === undefined
      ? ''
      : `-${String(record.day).padStart(2, '0')}`
  }`
  return parseStrictCalendarValue(candidate)
}

export const isValidPowerPlannerRecord = (
  value: unknown,
): value is PowerPlannerRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    !record.id.trim() ||
    !powerPlannerDataTypes.has(record.dataType as PowerPlannerDataType) ||
    !Number.isInteger(record.sourceRowIndex) ||
    Number(record.sourceRowIndex) < 0
  ) {
    return false
  }

  if (
    !optionalNumberInRange(record.year, 2000, 2100, true) ||
    !optionalNumberInRange(record.month, 1, 12, true) ||
    !optionalNumberInRange(record.day, 1, 31, true) ||
    !optionalNumberInRange(record.hour, 0, 23, true) ||
    !optionalNumberInRange(record.usageKwh, 0, 1_000_000_000) ||
    !optionalNumberInRange(record.maxDemandKw, 0, 10_000_000) ||
    !optionalNumberInRange(record.estimatedBillWon, 0, 1_000_000_000_000) ||
    !optionalNumberInRange(record.contractPowerKw, 0, 10_000_000) ||
    !optionalNumberInRange(record.appliedPowerKw, 0, 10_000_000) ||
    !optionalNumberInRange(record.usageDays, 0, 366, true) ||
    !optionalNumberInRange(record.laggingPowerFactorPercent, 0, 100) ||
    !optionalNumberInRange(record.leadingPowerFactorPercent, 0, 100)
  ) {
    return false
  }

  if (
    !['date', 'loadType', 'patternLabel', 'patternSummary'].every(
      (field) =>
        record[field] === undefined || typeof record[field] === 'string',
    )
  ) {
    return false
  }
  const period = canonicalPeriod(record)
  if (period === null) return false

  switch (record.dataType) {
    case 'hourlyUsage':
      return (
        period?.day !== undefined &&
        typeof record.hour === 'number' &&
        typeof record.usageKwh === 'number'
      )
    case 'dailyUsage':
      return (
        period?.day !== undefined &&
        typeof record.usageKwh === 'number'
      )
    case 'monthlyUsage':
      return (
        typeof record.usageKwh === 'number' &&
        period !== undefined
      )
    case 'maxDemand':
      return typeof record.maxDemandKw === 'number'
    case 'estimatedBill':
      return typeof record.estimatedBillWon === 'number'
    case 'patternAnalysis':
      return [record.patternLabel, record.patternSummary].some(
        (field) => typeof field === 'string' && Boolean(field.trim()),
      )
    default:
      return false
  }
}

const canonicalCalendarValue = (value: string | undefined) => {
  const parsed = parseStrictCalendarValue(value)
  if (!parsed) return value
  const month = String(parsed.month).padStart(2, '0')
  return parsed.day === undefined
    ? `${parsed.year}-${month}`
    : `${parsed.year}-${month}-${String(parsed.day).padStart(2, '0')}`
}

const normalizePowerPlannerRecord = (
  record: PowerPlannerRecord,
): PowerPlannerRecord => {
  const period = canonicalPeriod(record as unknown as Record<string, unknown>)
  const date =
    period && period !== null
      ? canonicalCalendarValue(
          `${period.year}-${String(period.month).padStart(2, '0')}${
            period.day === undefined
              ? ''
              : `-${String(period.day).padStart(2, '0')}`
          }`,
        )
      : undefined
  return {
    ...record,
    id: record.id.trim(),
    date,
    year: undefined,
    month: undefined,
    day: undefined,
    loadType: record.loadType?.trim() || undefined,
    patternLabel: record.patternLabel?.trim() || undefined,
    patternSummary: record.patternSummary?.trim() || undefined,
  }
}

export const mapRowsToPowerPlannerRecords = (
  rows: Record<string, unknown>[],
  dataType: PowerPlannerDataType,
  mapping: Record<string, string>,
): PowerPlannerRecord[] => {
  return rows
    .map((row, index) => {
      const dateValue = row[mapping.date]
      const dateParts = inferYearMonthDay(dateValue)
      const yearValue = row[mapping.year]
      const monthValue = row[mapping.month]
      const hasYearValue = Boolean(mapping.year && normalize(yearValue))
      const hasMonthValue = Boolean(mapping.month && normalize(monthValue))
      const parsedYear = hasYearValue
        ? parseStrictYear(yearValue)
        : dateParts.year
      const parsedMonth = hasMonthValue
        ? parseStrictMonth(monthValue)
        : dateParts.month
      if (
        (hasYearValue && parsedYear === null) ||
        (hasMonthValue && parsedMonth === null)
      ) {
        return null
      }
      const record: PowerPlannerRecord = {
        id: `pp-${dataType}-${index}-${Date.now()}`,
        dataType,
        date: asDate(dateValue),
        year: parsedYear ?? undefined,
        month: parsedMonth ?? undefined,
        day: asNumber(row[mapping.day]) ?? dateParts.day,
        hour: inferHour(row[mapping.hour]),
        usageKwh: asNumber(row[mapping.usageKwh]),
        maxDemandKw: asNumber(row[mapping.maxDemandKw]),
        estimatedBillWon: asNumber(row[mapping.estimatedBillWon]),
        contractPowerKw: asNumber(row[mapping.contractPowerKw]),
        appliedPowerKw: asNumber(row[mapping.appliedPowerKw]),
        usageDays: asNumber(row[mapping.usageDays]),
        laggingPowerFactorPercent: asNumber(
          row[mapping.laggingPowerFactorPercent],
        ),
        leadingPowerFactorPercent: asNumber(
          row[mapping.leadingPowerFactorPercent],
        ),
        loadType: normalize(row[mapping.loadType]) || undefined,
        patternLabel: normalize(row[mapping.patternLabel]) || undefined,
        patternSummary: normalize(row[mapping.patternSummary]) || undefined,
        sourceRowIndex: index,
      }

      return isValidPowerPlannerRecord(record)
        ? normalizePowerPlannerRecord(record)
        : null
    })
    .filter((record): record is PowerPlannerRecord => Boolean(record))
}

const powerPlannerFingerprintFields = [
  'dataType',
  'date',
  'year',
  'month',
  'day',
  'hour',
  'usageKwh',
  'maxDemandKw',
  'estimatedBillWon',
  'contractPowerKw',
  'appliedPowerKw',
  'usageDays',
  'laggingPowerFactorPercent',
  'leadingPowerFactorPercent',
  'loadType',
  'patternLabel',
  'patternSummary',
] as const

export const getPowerPlannerRecordFingerprint = (record: PowerPlannerRecord) =>
  JSON.stringify(
    powerPlannerFingerprintFields.map(
      (field) => normalizePowerPlannerRecord(record)[field] ?? null,
    ),
  )

export const normalizePowerPlannerRecords = (
  value: unknown,
): { records: PowerPlannerRecord[] | null; changed: boolean } => {
  if (!Array.isArray(value) || value.length === 0) {
    return { records: null, changed: true }
  }

  const fingerprints = new Set<string>()
  const records: PowerPlannerRecord[] = []
  let changed = false
  for (const rawRecord of value) {
    if (!isValidPowerPlannerRecord(rawRecord)) {
      return { records: null, changed: true }
    }
    const record = normalizePowerPlannerRecord(rawRecord)
    const fingerprint = getPowerPlannerRecordFingerprint(record)
    if (fingerprints.has(fingerprint)) {
      changed = true
      continue
    }
    fingerprints.add(fingerprint)
    records.push(record)
    changed ||= JSON.stringify(record) !== JSON.stringify(rawRecord)
    if (records.length > POWER_PLANNER_AGGREGATE_RECORD_LIMIT) {
      return { records: null, changed: true }
    }
  }

  return { records, changed }
}

export interface PowerPlannerMergeResult {
  accepted: boolean
  records: PowerPlannerRecord[]
  duplicateCount: number
  message?: string
}

export const mergePowerPlannerRecords = (
  existing: PowerPlannerRecord[],
  incoming: PowerPlannerRecord[],
): PowerPlannerMergeResult => {
  const deduplicate = (records: PowerPlannerRecord[]) => {
    const fingerprints = new Set<string>()
    const uniqueRecords: PowerPlannerRecord[] = []
    let duplicates = 0

    for (const record of records) {
      const fingerprint = getPowerPlannerRecordFingerprint(record)
      if (fingerprints.has(fingerprint)) {
        duplicates += 1
        continue
      }
      fingerprints.add(fingerprint)
      uniqueRecords.push(record)
    }

    return { fingerprints, uniqueRecords, duplicates }
  }

  const normalizedExisting = deduplicate(existing)
  const fingerprints = normalizedExisting.fingerprints
  const uniqueIncoming: PowerPlannerRecord[] = []
  let duplicateCount = normalizedExisting.duplicates

  for (const record of incoming) {
    const fingerprint = getPowerPlannerRecordFingerprint(record)
    if (fingerprints.has(fingerprint)) {
      duplicateCount += 1
      continue
    }
    fingerprints.add(fingerprint)
    uniqueIncoming.push(record)
  }

  if (
    normalizedExisting.uniqueRecords.length + uniqueIncoming.length >
    POWER_PLANNER_AGGREGATE_RECORD_LIMIT
  ) {
    return {
      accepted: false,
      records: existing,
      duplicateCount,
      message: `파워플래너 누적 자료는 최대 ${POWER_PLANNER_AGGREGATE_RECORD_LIMIT.toLocaleString('ko-KR')}건까지 반영할 수 있습니다. 기존 자료는 변경되지 않았습니다.`,
    }
  }

  return {
    accepted: true,
    records: [...normalizedExisting.uniqueRecords, ...uniqueIncoming],
    duplicateCount,
  }
}

export const createPowerPlannerDataSource = (
  records: PowerPlannerRecord[],
  sourceName: string,
  memo: string,
): PowerPlannerDataSource => ({
  id: `kepco-power-planner-${Date.now()}`,
  provider: 'kepco-power-planner',
  sourceName,
  sourceLabel: '한전 파워플래너 사용자 업로드',
  importedAt: new Date().toISOString(),
  records,
  memo,
})

export const getPowerPlannerSheetLabel = (sheet?: ParsedSheet) =>
  sheet ? `${sheet.name} (${sheet.rows.length.toLocaleString('ko-KR')}행)` : '시트 없음'

export const getHourlyUsageRecords = (source?: PowerPlannerDataSource | null) =>
  (source?.records ?? [])
    .filter(
      (record) =>
        record.dataType === 'hourlyUsage' &&
        record.hour !== undefined &&
        record.usageKwh !== undefined,
    )
    .sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0))

export const getPowerPlannerSummary = (
  source?: PowerPlannerDataSource | null,
) => {
  const records = source?.records ?? []
  const hourly = getHourlyUsageRecords(source)
  const maxHourly = hourly.reduce<PowerPlannerRecord | undefined>(
    (max, record) =>
      !max || (record.usageKwh ?? 0) > (max.usageKwh ?? 0) ? record : max,
    undefined,
  )
  const maxDemand = records.reduce<PowerPlannerRecord | undefined>(
    (max, record) =>
      (record.maxDemandKw ?? 0) > (max?.maxDemandKw ?? 0) ? record : max,
    undefined,
  )

  return {
    totalRecords: records.length,
    hourlyCount: hourly.length,
    maxHourly,
    maxDemand,
    dataTypes: Array.from(new Set(records.map((record) => record.dataType))),
  }
}
