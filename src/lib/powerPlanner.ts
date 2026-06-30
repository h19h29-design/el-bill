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

const asDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const raw = normalize(value)
  if (!raw) return undefined
  const normalized = raw.replace(/[./]/g, '-')
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return raw
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

const inferHour = (value: unknown) => {
  const match = normalize(value).match(/(\d{1,2})/)
  if (!match) return undefined
  const hour = Number(match[1])
  return hour >= 0 && hour <= 23 ? hour : undefined
}

export const powerPlannerMappingFields = [
  ['date', '일자/검침일'],
  ['year', '연도'],
  ['month', '월'],
  ['day', '일'],
  ['hour', '시간대'],
  ['usageKwh', '사용량(kWh)'],
  ['maxDemandKw', '최대수요전력(kW)'],
  ['estimatedBillWon', '예상요금(원)'],
  ['loadType', '부하구분'],
  ['patternLabel', '패턴명'],
  ['patternSummary', '분석결과'],
] as const

export const requiredPowerPlannerMapping = (
  dataType: PowerPlannerDataType,
): string[] => {
  if (dataType === 'monthlyUsage') return ['year', 'month', 'usageKwh']
  if (dataType === 'dailyUsage') return ['date', 'usageKwh']
  if (dataType === 'hourlyUsage') return ['date', 'hour', 'usageKwh']
  if (dataType === 'maxDemand') return ['maxDemandKw']
  if (dataType === 'estimatedBill') return ['estimatedBillWon']
  return ['patternSummary']
}

export const guessPowerPlannerMapping = (
  headers: string[],
): Record<string, string> => {
  const find = (...patterns: string[]) =>
    headers.find((header) => patterns.some((pattern) => header.includes(pattern))) ??
    ''

  return {
    date: find('일자', '날짜', '검침일', '사용일'),
    year: find('연도', '년'),
    month: find('월'),
    day: find('일'),
    hour: find('시간', '시각', '시간대'),
    usageKwh: find('사용량', 'kWh', '전력량'),
    maxDemandKw: find('최대수요', '수요전력', '피크'),
    estimatedBillWon: find('예상요금', '월예상', '요금'),
    loadType: find('부하', '경부하', '중간부하', '최대부하'),
    patternLabel: find('패턴', '유형'),
    patternSummary: find('분석', '결과', '내용', '메모'),
  }
}

export const mapRowsToPowerPlannerRecords = (
  rows: Record<string, unknown>[],
  dataType: PowerPlannerDataType,
  mapping: Record<string, string>,
): PowerPlannerRecord[] => {
  const required = requiredPowerPlannerMapping(dataType)

  return rows
    .map((row, index) => {
      const record: PowerPlannerRecord = {
        id: `pp-${dataType}-${index}-${Date.now()}`,
        dataType,
        date: asDate(row[mapping.date]),
        year: asNumber(row[mapping.year]),
        month: asNumber(row[mapping.month]),
        day: asNumber(row[mapping.day]),
        hour: inferHour(row[mapping.hour]),
        usageKwh: asNumber(row[mapping.usageKwh]),
        maxDemandKw: asNumber(row[mapping.maxDemandKw]),
        estimatedBillWon: asNumber(row[mapping.estimatedBillWon]),
        loadType: normalize(row[mapping.loadType]) || undefined,
        patternLabel: normalize(row[mapping.patternLabel]) || undefined,
        patternSummary: normalize(row[mapping.patternSummary]) || undefined,
        sourceRowIndex: index,
      }

      const hasRequired = required.every((field) => {
        const value = record[field as keyof PowerPlannerRecord]
        return value !== undefined && value !== ''
      })

      return hasRequired ? record : null
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
