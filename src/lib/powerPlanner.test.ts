import { describe, expect, it } from 'vitest'
import {
  createPowerPlannerDataSource,
  getHourlyUsageRecords,
  getPowerPlannerSummary,
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
