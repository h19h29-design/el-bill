import type {
  ParsedSheet,
} from './excel'
import type {
  PowerPlannerDataSource,
  PowerPlannerDataType,
  PowerPlannerRecord,
} from '../types'

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

const normalize = (value: unknown) => String(value ?? '').trim()

const asNumber = (value: unknown) => {
  if (typeof value === 'number') return value
  const cleaned = normalize(value).replace(/,/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

const inferYearMonthDay = (value: unknown) => {
  if (value instanceof Date) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    }
  }
  const raw = normalize(value)
  if (!raw) return {}
  const normalized = raw.replace(/[./]/g, '-')
  const match = normalized.match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/)
  if (!match) return {}
  const [, year, month, day] = match
  return {
    year: Number(year),
    month: Number(month),
    day: day ? Number(day) : undefined,
  }
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

const asYear = (...values: unknown[]) => {
  for (const value of values) {
    const direct = asNumber(value)
    if (direct && direct >= 2000) return direct
    const inferred = inferYearMonthDay(value).year
    if (inferred) return inferred
  }
  return undefined
}

const asMonthValue = (...values: unknown[]) => {
  for (const value of values) {
    const inferred = inferYearMonthDay(value).month
    if (inferred) return inferred
    const direct = asNumber(value)
    if (direct && direct >= 1 && direct <= 12) return direct
  }
  return undefined
}

const inferHour = (value: unknown) => {
  const match = normalize(value).match(/(\d{1,2})/)
  if (!match) return undefined
  const hour = Number(match[1])
  return hour >= 0 && hour <= 23 ? hour : undefined
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

  return {
    date: find('연월', '일자', '날짜', '검침일', '사용일'),
    year: find('연도', '연월', '년'),
    month: find('월', '연월'),
    day: find('일'),
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

const hasPowerPlannerRequiredValues = (
  record: PowerPlannerRecord,
  dataType: PowerPlannerDataType,
) => {
  if (dataType === 'monthlyUsage') {
    return (
      record.usageKwh !== undefined &&
      (Boolean(record.date) || Boolean(record.year && record.month))
    )
  }
  if (dataType === 'dailyUsage') return Boolean(record.date && record.usageKwh)
  if (dataType === 'hourlyUsage') {
    return Boolean(
      record.date && record.hour !== undefined && record.usageKwh !== undefined,
    )
  }
  if (dataType === 'maxDemand') return record.maxDemandKw !== undefined
  if (dataType === 'estimatedBill') return record.estimatedBillWon !== undefined
  return Boolean(record.patternSummary)
}

export const mapRowsToPowerPlannerRecords = (
  rows: Record<string, unknown>[],
  dataType: PowerPlannerDataType,
  mapping: Record<string, string>,
): PowerPlannerRecord[] => {
  return rows
    .map((row, index) => {
      const dateValue = row[mapping.date]
      const record: PowerPlannerRecord = {
        id: `pp-${dataType}-${index}-${Date.now()}`,
        dataType,
        date: asDate(dateValue),
        year: asYear(row[mapping.year], dateValue),
        month: asMonthValue(row[mapping.month], dateValue),
        day: asNumber(row[mapping.day]) ?? inferYearMonthDay(dateValue).day,
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

      return hasPowerPlannerRequiredValues(record, dataType) ? record : null
    })
    .filter((record): record is PowerPlannerRecord => Boolean(record))
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
