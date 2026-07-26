import { describe, expect, it } from 'vitest'
import type { PowerPlannerRecord } from '../types'
import {
  createPowerPlannerDataSource,
  getMissingPowerPlannerMappings,
  getHourlyUsageRecords,
  getPowerPlannerRecordFingerprint,
  getPowerPlannerSummary,
  guessPowerPlannerDataType,
  guessPowerPlannerMapping,
  mapRowsToPowerPlannerRecords,
  POWER_PLANNER_AGGREGATE_RECORD_LIMIT,
  mergePowerPlannerRecords,
  powerPlannerMvpGuardrail,
  powerPlannerUploadNotice,
} from './powerPlanner'

describe('power planner data source harness', () => {
  it('maps hourly usage rows from a user-uploaded table', () => {
    const rows = [
      { 일자: '2026-06-01', 시간대: '10시', 사용량: '120' },
      { 일자: '2026-06-01', 시간대: '11시', 사용량: '186' },
      { 일자: '2026-06-01', 시간대: '13시', 사용량: '210' },
    ]
    const records = mapRowsToPowerPlannerRecords(rows, 'hourlyUsage', {
      date: '일자',
      hour: '시간대',
      usageKwh: '사용량',
    })

    expect(records).toHaveLength(3)
    expect(records[1]).toMatchObject({
      date: '2026-06-01',
      hour: 11,
      usageKwh: 186,
      dataType: 'hourlyUsage',
    })
  })

  it('maps Power Planner monthly bill rows that use a combined year-month column', () => {
    const rows = [
      {
        연월: '2026년 06월',
        '계약전력(kW)': '700',
        '요금적용전력(kW)': '493',
        '사용전력량(kWh)': '48,365',
        '사용일수(일)': '31',
        '지상역률(%)': '97',
        '진상역률(%)': '89',
        '청구요금(원)': '7,138,790',
      },
    ]
    const mapping = guessPowerPlannerMapping(Object.keys(rows[0]))
    const records = mapRowsToPowerPlannerRecords(rows, 'monthlyUsage', mapping)

    expect(guessPowerPlannerDataType(Object.keys(rows[0]))).toBe('monthlyUsage')
    expect(getMissingPowerPlannerMappings('monthlyUsage', mapping)).toHaveLength(0)
    expect(records[0]).toMatchObject({
      dataType: 'monthlyUsage',
      date: '2026-06',
      year: 2026,
      month: 6,
      usageKwh: 48365,
      estimatedBillWon: 7138790,
      contractPowerKw: 700,
      appliedPowerKw: 493,
      usageDays: 31,
      laggingPowerFactorPercent: 97,
      leadingPowerFactorPercent: 89,
    })
  })

  it('does not reuse combined month or usage-day columns as separate date fields', () => {
    const mapping = guessPowerPlannerMapping([
      '연월',
      '사용일수(일)',
      '사용전력량(kWh)',
      '청구요금(원)',
    ])

    expect(mapping.date).toBe('연월')
    expect(mapping.year).toBe('')
    expect(mapping.month).toBe('')
    expect(mapping.day).toBe('')
    expect(mapping.usageDays).toBe('사용일수(일)')
  })

  it('summarizes hourly and max-demand records through the data source interface', () => {
    const hourlyRecords = mapRowsToPowerPlannerRecords(
      [
        { 일자: '2026-06-01', 시간대: '11시', 사용량: 186 },
        { 일자: '2026-06-01', 시간대: '14시', 사용량: 245 },
      ],
      'hourlyUsage',
      { date: '일자', hour: '시간대', usageKwh: '사용량' },
    )
    const demandRecords = mapRowsToPowerPlannerRecords(
      [{ 일자: '2026-06-01', 최대수요전력: 512 }],
      'maxDemand',
      { date: '일자', maxDemandKw: '최대수요전력' },
    )
    const source = createPowerPlannerDataSource(
      [...hourlyRecords, ...demandRecords],
      'power-planner.csv',
      '테스트',
    )
    const summary = getPowerPlannerSummary(source)

    expect(getHourlyUsageRecords(source)).toHaveLength(2)
    expect(summary.maxHourly?.hour).toBe(14)
    expect(summary.maxDemand?.maxDemandKw).toBe(512)
  })

  it('deduplicates repeated uploads using semantic record fields', () => {
    const rows = [
      { 일자: '2026-06-01', 시간대: '13', 사용량: '210' },
      { 일자: '2026-06-01', 시간대: '14', 사용량: '230' },
    ]
    const mapping = { date: '일자', hour: '시간대', usageKwh: '사용량' }
    const firstUpload = mapRowsToPowerPlannerRecords(rows, 'hourlyUsage', mapping)
    const repeatedUpload = mapRowsToPowerPlannerRecords(rows, 'hourlyUsage', mapping)

    const merged = mergePowerPlannerRecords(firstUpload, repeatedUpload)

    expect(merged.accepted).toBe(true)
    expect(merged.records).toHaveLength(2)
    expect(merged.duplicateCount).toBe(2)
  })

  it('rejects a cumulative upload over the aggregate record cap without changing records', () => {
    const existing = Array.from({ length: POWER_PLANNER_AGGREGATE_RECORD_LIMIT }, (_, index) => ({
      id: `existing-${index}`,
      dataType: 'hourlyUsage' as const,
      date: `2026-06-${String((index % 28) + 1).padStart(2, '0')}`,
      hour: index % 24,
      usageKwh: index,
      sourceRowIndex: index,
    }))
    const incoming = [
      {
        id: 'incoming',
        dataType: 'hourlyUsage' as const,
        date: '2026-07-01',
        hour: 0,
        usageKwh: 1,
        sourceRowIndex: 0,
      },
    ]

    const merged = mergePowerPlannerRecords(existing, incoming)

    expect(merged.accepted).toBe(false)
    expect(merged.records).toBe(existing)
    expect(merged.message).toContain('10,000건')
  })

  it('normalizes legacy duplicate records before evaluating the aggregate cap', () => {
    const unique = Array.from({ length: POWER_PLANNER_AGGREGATE_RECORD_LIMIT }, (_, index) => ({
      id: `existing-${index}`,
      dataType: 'hourlyUsage' as const,
      date: `2026-06-${String((index % 28) + 1).padStart(2, '0')}`,
      hour: index % 24,
      usageKwh: index,
      sourceRowIndex: index,
    }))
    const duplicatedExisting = [
      ...unique,
      { ...unique[0], id: 'legacy-duplicate', sourceRowIndex: 99_999 },
    ]

    const merged = mergePowerPlannerRecords(duplicatedExisting, [
      { ...unique[0], id: 'incoming-duplicate', sourceRowIndex: 0 },
    ])

    expect(merged.accepted).toBe(true)
    expect(merged.records).toHaveLength(POWER_PLANNER_AGGREGATE_RECORD_LIMIT)
    expect(merged.records[0].id).toBe('existing-0')
    expect(merged.duplicateCount).toBe(2)
  })

  it.each([
    ['monthlyUsage', { date: '2026-07', usageKwh: 100, appliedPowerKw: 500 }, 'appliedPowerKw', 501],
    ['dailyUsage', { date: '2026-07-01', usageKwh: 100, loadType: '급식실' }, 'loadType', '강당'],
    ['hourlyUsage', { date: '2026-07-01', hour: 13, usageKwh: 100, patternLabel: '피크' }, 'patternLabel', '절감'],
    ['maxDemand', { date: '2026-07-01', maxDemandKw: 500, contractPowerKw: 700 }, 'contractPowerKw', 701],
    ['estimatedBill', { estimatedBillWon: 1_000_000, usageDays: 30 }, 'usageDays', 31],
    ['patternAnalysis', { patternSummary: '오후 피크', leadingPowerFactorPercent: 98 }, 'leadingPowerFactorPercent', 97],
  ] as const)(
    'uses semantic optional fields in %s fingerprints while ignoring generated metadata',
    (dataType, values, changedField, changedValue) => {
      const record: PowerPlannerRecord = {
        id: 'first-id',
        dataType,
        sourceRowIndex: 1,
        ...values,
      }

      expect(getPowerPlannerRecordFingerprint(record)).toBe(
        getPowerPlannerRecordFingerprint({ ...record, id: 'second-id', sourceRowIndex: 999 }),
      )
      expect(getPowerPlannerRecordFingerprint(record)).not.toBe(
        getPowerPlannerRecordFingerprint({ ...record, [changedField]: changedValue }),
      )
    },
  )

  it('keeps the MVP guardrails visible as reusable copy', () => {
    expect(powerPlannerMvpGuardrail).toContain('자동 로그인')
    expect(powerPlannerMvpGuardrail).toContain('비공식 API 호출')
    expect(powerPlannerUploadNotice).toContain('고객번호')
    expect(powerPlannerUploadNotice).toContain('10자리 숫자')
  })
})
