import type { PowerPlannerDataSource, PowerPlannerRecord } from '../types'

const hourlyUsage = [
  118, 104, 96, 92, 90, 98, 126, 188, 236, 284, 330, 412,
  292, 438, 462, 448, 421, 302, 256, 210, 176, 148, 136, 124,
]

const records: PowerPlannerRecord[] = hourlyUsage.map((usageKwh, hour) => ({
  id: `sample-pp-hourly-${hour}`,
  dataType: 'hourlyUsage',
  date: '2026-06-15',
  hour,
  usageKwh,
  loadType: hour === 11 || (hour >= 13 && hour < 17) ? '최대부하' : '일반',
  sourceRowIndex: hour,
}))

records.push({
  id: 'sample-pp-demand-20260615',
  dataType: 'maxDemand',
  date: '2026-06-15',
  maxDemandKw: 512,
  sourceRowIndex: 24,
})

export const samplePowerPlannerDataSource: PowerPlannerDataSource = {
  id: 'sample-kepco-power-planner',
  provider: 'kepco-power-planner',
  sourceName: '시연용 파워플래너 시간대별 사용량',
  sourceLabel: '한전 파워플래너 시연 샘플',
  importedAt: new Date().toISOString(),
  records,
  memo: '자동 로그인/크롤링 없이 앱에 포함된 시연용 자료',
}
