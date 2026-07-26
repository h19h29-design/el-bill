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
  isValidPowerPlannerRecord,
  mapRowsToPowerPlannerRecords,
  normalizePowerPlannerRecords,
  POWER_PLANNER_AGGREGATE_RECORD_LIMIT,
  mergePowerPlannerRecords,
  powerPlannerMvpGuardrail,
  powerPlannerUploadNotice,
} from './powerPlanner'

describe('power planner data source harness', () => {
  const record = (
    patch: Partial<PowerPlannerRecord>,
  ): PowerPlannerRecord => ({
    id: 'record',
    dataType: 'hourlyUsage',
    date: '2026-06-01',
    hour: 13,
    usageKwh: 100,
    sourceRowIndex: 0,
    ...patch,
  })

  it.each([
    ['hourly without date', record({ date: undefined })],
    ['hourly with invalid date', record({ date: '2026-02-30' })],
    ['hourly with negative usage', record({ usageKwh: -1 })],
    ['daily with month-only date', record({ dataType: 'dailyUsage', date: '2026-06' })],
    ['monthly without period', record({ dataType: 'monthlyUsage', date: undefined, year: undefined, month: undefined })],
    ['blank pattern', record({ dataType: 'patternAnalysis', date: undefined, hour: undefined, usageKwh: undefined, patternLabel: ' ', patternSummary: '' })],
  ])('rejects semantic record error %s', (_label, value) => {
    expect(isValidPowerPlannerRecord(value)).toBe(false)
  })

  it.each([
    record({}),
    record({ dataType: 'dailyUsage', hour: undefined }),
    record({ dataType: 'monthlyUsage', date: '2026-06', hour: undefined }),
    record({ dataType: 'monthlyUsage', date: undefined, year: 2026, month: 6, hour: undefined }),
    record({ dataType: 'patternAnalysis', date: undefined, hour: undefined, usageKwh: undefined, patternLabel: ' 피크 ' }),
  ])('accepts semantically complete %s record', (value) => {
    expect(isValidPowerPlannerRecord(value)).toBe(true)
  })

  it('normalizes semantic duplicates before applying the record cap', () => {
    const normalized = normalizePowerPlannerRecords([
      record({ id: 'first', date: '2026-06-01' }),
      record({ id: 'second', date: '2026/06/01', sourceRowIndex: 1 }),
    ])

    expect(normalized.records).toHaveLength(1)
    expect(normalized.changed).toBe(true)
  })

  it('deduplicates equivalent monthly date and split period records', () => {
    const normalized = normalizePowerPlannerRecords([
      record({
        id: 'date-period',
        dataType: 'monthlyUsage',
        date: '2026-01',
        hour: undefined,
      }),
      record({
        id: 'split-period',
        dataType: 'monthlyUsage',
        date: undefined,
        year: 2026,
        month: 1,
        hour: undefined,
        sourceRowIndex: 1,
      }),
    ])

    expect(normalized.records).toHaveLength(1)
    expect(normalized.records?.[0]).toMatchObject({
      date: '2026-01',
    })
    expect(normalized.records?.[0].year).toBeUndefined()
    expect(normalized.records?.[0].month).toBeUndefined()
  })

  it('rejects conflicting date and split period values', () => {
    expect(
      isValidPowerPlannerRecord(
        record({
          dataType: 'monthlyUsage',
          date: '2026-01',
          year: 2026,
          month: 2,
          hour: undefined,
        }),
      ),
    ).toBe(false)
  })

  it('accepts matching date and split period values', () => {
    expect(
      isValidPowerPlannerRecord(
        record({
          dataType: 'dailyUsage',
          date: '2026-01-31',
          year: 2026,
          month: 1,
          day: 31,
          hour: undefined,
        }),
      ),
    ).toBe(true)
  })

  it.each([
    'monthlyUsage',
    'dailyUsage',
    'hourlyUsage',
    'maxDemand',
    'estimatedBill',
    'patternAnalysis',
  ] as const)('rejects malformed optional date for %s', (dataType) => {
    const values: Record<string, unknown> = {
      monthlyUsage: { usageKwh: 100, hour: undefined },
      dailyUsage: { usageKwh: 100, hour: undefined },
      hourlyUsage: { usageKwh: 100, hour: 13 },
      maxDemand: { maxDemandKw: 500, hour: undefined, usageKwh: undefined },
      estimatedBill: {
        estimatedBillWon: 5_000_000,
        hour: undefined,
        usageKwh: undefined,
      },
      patternAnalysis: {
        patternSummary: '피크',
        hour: undefined,
        usageKwh: undefined,
      },
    }
    expect(
      isValidPowerPlannerRecord(
        record({
          dataType,
          date: 'x2026-01',
          ...(values[dataType] as Record<string, unknown>),
        }),
      ),
    ).toBe(false)
  })

  it.each([2026, '2026'])('maps strict standalone year %s', (year) => {
    const records = mapRowsToPowerPlannerRecords(
      [{ 연도: year, 월: 1, 사용량: 100 }],
      'monthlyUsage',
      { year: '연도', month: '월', usageKwh: '사용량' },
    )

    expect(records[0]).toMatchObject({ date: '2026-01' })
  })

  it.each([2026.5, '2.026e3', '+2026', '0x7ea', '002026', 'x2026', '2026년'])(
    'rejects malformed standalone PowerPlanner year %s',
    (year) => {
      expect(
        mapRowsToPowerPlannerRecords(
          [{ 연도: year, 월: 1, 사용량: 100 }],
          'monthlyUsage',
          { year: '연도', month: '월', usageKwh: '사용량' },
        ),
      ).toEqual([])
    },
  )

  it.each(['2.026e3', '+2026', '0x7ea', '002026', 'x2026'])(
    'does not hide malformed split year %s behind a valid date',
    (year) => {
      expect(
        mapRowsToPowerPlannerRecords(
          [{ 일자: '2026-01-01', 연도: year, 시간: 13, 사용량: 100 }],
          'hourlyUsage',
          {
            date: '일자',
            year: '연도',
            hour: '시간',
            usageKwh: '사용량',
          },
        ),
      ).toEqual([])
    },
  )

  it.each([0, -1, 1.5, 32, '1e1', '+1', '0x1', '1.5', 'x1'])(
    'rejects explicit malformed day %s instead of falling back to the date',
    (day) => {
      expect(
        mapRowsToPowerPlannerRecords(
          [
            {
              일자: '2026-01-01',
              일: day,
              시간: 13,
              사용량: 100,
            },
          ],
          'hourlyUsage',
          {
            date: '일자',
            day: '일',
            hour: '시간',
            usageKwh: '사용량',
          },
        ),
      ).toEqual([])
    },
  )

  it.each([1, '1', '01'])('accepts strict explicit day %s', (day) => {
    expect(
      mapRowsToPowerPlannerRecords(
        [{ 일자: '2026-01-01', 일: day, 시간: 13, 사용량: 100 }],
        'hourlyUsage',
        {
          date: '일자',
          day: '일',
          hour: '시간',
          usageKwh: '사용량',
        },
      ),
    ).toHaveLength(1)
  })

  it('treats a whitespace-only optional stored date as absent', () => {
    const normalized = normalizePowerPlannerRecords([
      record({
        dataType: 'maxDemand',
        date: '   ',
        hour: undefined,
        usageKwh: undefined,
        maxDemandKw: 500,
      }),
    ])

    expect(normalized.records).toHaveLength(1)
    expect(normalized.records?.[0].date).toBeUndefined()
  })

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
    expect(records[1].usageDays).toBeUndefined()
    expect(records[1].contractPowerKw).toBeUndefined()
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
