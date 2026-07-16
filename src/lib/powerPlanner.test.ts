import { describe, expect, it } from 'vitest'
import {
  createPowerPlannerDataSource,
  getMissingPowerPlannerMappings,
  getHourlyUsageRecords,
  getPowerPlannerSummary,
  guessPowerPlannerDataType,
  guessPowerPlannerMapping,
  mapRowsToPowerPlannerRecords,
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

  it('keeps the MVP guardrails visible as reusable copy', () => {
    expect(powerPlannerMvpGuardrail).toContain('자동 로그인')
    expect(powerPlannerMvpGuardrail).toContain('비공식 API 호출')
    expect(powerPlannerUploadNotice).toContain('고객번호')
    expect(powerPlannerUploadNotice).toContain('10자리 숫자')
  })
})
