import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Gauge, Target } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PeakScenario, PowerPlannerDataSource } from '../../types'
import {
  getPeakRatio,
  getPeakRiskLevel,
  getPeakRiskTone,
  peakGuideItems,
  summerPeakBlocks,
  winterPeakBlocks,
} from '../../lib/peak'
import {
  getHourlyUsageRecords,
  getPowerPlannerSummary,
} from '../../lib/powerPlanner'
import type { PeakOperationPlan } from '../../lib/peakOperations'

interface PeakManagerProps {
  scenario: PeakScenario
  onScenarioChange: (scenario: PeakScenario) => void
  powerPlannerDataSource?: PowerPlannerDataSource | null
  peakOperationPlan: PeakOperationPlan
}

const isMaximumLoadHour = (hour: number) =>
  hour === 11 ||
  (hour >= 13 && hour < 17) ||
  (hour >= 10 && hour < 12) ||
  (hour >= 17 && hour < 20) ||
  hour === 22

export function PeakManager({
  scenario,
  onScenarioChange,
  powerPlannerDataSource,
  peakOperationPlan,
}: PeakManagerProps) {
  const ratio = getPeakRatio(scenario.targetPeakKw, scenario.expectedPeakKw)
  const level = getPeakRiskLevel(scenario.targetPeakKw, scenario.expectedPeakKw)
  const tone = getPeakRiskTone(level)
  const percent = Math.round(ratio * 100)
  const guideItems = useMemo(() => peakGuideItems, [])
  const hourlyRecords = useMemo(
    () => getHourlyUsageRecords(powerPlannerDataSource),
    [powerPlannerDataSource],
  )
  const powerPlannerSummary = useMemo(
    () => getPowerPlannerSummary(powerPlannerDataSource),
    [powerPlannerDataSource],
  )
  const hourlyChartData = hourlyRecords.map((record) => ({
    hour: `${record.hour}시`,
    rawHour: record.hour ?? 0,
    usageKwh: record.usageKwh ?? 0,
    isPeakLoad: isMaximumLoadHour(record.hour ?? -1),
  }))
  const maxLoadRecord = hourlyChartData.reduce<
    (typeof hourlyChartData)[number] | undefined
  >(
    (max, record) =>
      !max || record.usageKwh > max.usageKwh ? record : max,
    undefined,
  )
  const detailedDemandKw =
    powerPlannerSummary.maxDemand?.maxDemandKw ?? scenario.expectedPeakKw
  const detailedRiskLevel = getPeakRiskLevel(
    scenario.targetPeakKw,
    detailedDemandKw,
  )

  const update = (key: keyof PeakScenario, value: string | boolean) => {
    onScenarioChange({
      ...scenario,
      [key]:
        key === 'memo' ||
        key === 'cafeteriaHighPowerTime' ||
        key === 'specialRoomTime' ||
        key === 'exemptSpaces'
          ? value
          : key === 'auditoriumCooling'
            ? Boolean(value)
          : Number.isFinite(Number(value))
            ? Number(value)
            : 0,
    })
  }

  return (
    <div className="view-stack">
      <section className="peak-summary-grid">
        <article className="peak-metric">
          <Target size={28} />
          <span>목표 피크</span>
          <label>
            <input
              type="number"
              value={scenario.targetPeakKw}
              onChange={(event) => update('targetPeakKw', event.target.value)}
            />
            kW
          </label>
        </article>
        <article className="peak-metric">
          <Gauge size={28} />
          <span>예상 피크</span>
          <label>
            <input
              type="number"
              value={scenario.expectedPeakKw}
              onChange={(event) => update('expectedPeakKw', event.target.value)}
            />
            kW
          </label>
        </article>
        <article className={`risk-card ${tone}`}>
          <AlertTriangle size={30} />
          <span>위험도</span>
          <strong>{level}</strong>
        </article>
        <article className="gauge-card">
          <div
            className="gauge-ring"
            style={{ '--gauge': `${Math.min(percent, 120)}%` } as React.CSSProperties}
          >
            <strong>{percent}%</strong>
            <span>목표 대비</span>
          </div>
        </article>
      </section>

      <section className="peak-grid">
        <article className="panel">
          <div className="panel-title">
            <h2>하계 피크 관리 타임라인</h2>
            <span>예시</span>
          </div>
          <div className="time-blocks">
            <div className="time-card safe">예냉 10:30</div>
            {summerPeakBlocks.map((block) => (
              <div className="time-card danger" key={block}>
                최대부하 {block}
              </div>
            ))}
          </div>
          <div className="timeline">
            {['09:00', '10:30', '11:00', '12:00', '13:00', '17:00', '18:00'].map(
              (time) => (
                <span key={time}>{time}</span>
              ),
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h2>동계 최대부하 시간대</h2>
            <span>순차 기동 권장</span>
          </div>
          <div className="load-window-list">
            {winterPeakBlocks.map((block) => (
              <span key={block}>{block}</span>
            ))}
          </div>
          <textarea
            value={scenario.memo}
            onChange={(event) => update('memo', event.target.value)}
            aria-label="피크관리 메모"
          />
        </article>

        <article className="panel guide-panel">
          <div className="panel-title">
            <h2>운영 가이드 체크리스트</h2>
            <span>장비 제어 없음</span>
          </div>
          <ul className="check-list">
            {guideItems.map((item) => (
              <li key={item}>
                <CheckCircle2 size={17} />
                {item}
              </li>
            ))}
          </ul>
          <p className="future-note">
            향후 BEMS, 스마트미터, 냉난방 제어기 연계 가능. 본 MVP는 운영 가이드만 제공합니다.
          </p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>피크관리 자동 운영안 입력</h2>
          <span>학교 설비 운영 조건</span>
        </div>
        <div className="peak-operation-form">
          <label>
            본관 EHP 그룹 수
            <input
              type="number"
              value={scenario.mainBuildingEhpGroups ?? 5}
              onChange={(event) => update('mainBuildingEhpGroups', event.target.value)}
            />
          </label>
          <label>
            별관 EHP 그룹 수
            <input
              type="number"
              value={scenario.annexEhpGroups ?? 2}
              onChange={(event) => update('annexEhpGroups', event.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={Boolean(scenario.auditoriumCooling)}
              onChange={(event) => update('auditoriumCooling', event.target.checked)}
            />
            강당 냉난방 사용
          </label>
          <label>
            급식실 고전력 기기 사용 시간
            <input
              value={scenario.cafeteriaHighPowerTime ?? '11:00~13:00'}
              onChange={(event) => update('cafeteriaHighPowerTime', event.target.value)}
            />
          </label>
          <label>
            특별실 사용 시간
            <input
              value={scenario.specialRoomTime ?? '14:00~16:00'}
              onChange={(event) => update('specialRoomTime', event.target.value)}
            />
          </label>
          <label className="wide-field">
            제외 공간
            <input
              value={scenario.exemptSpaces ?? '보건실, 서버실, 특수학급'}
              onChange={(event) => update('exemptSpaces', event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>자동 생성 운영안</h2>
          <span>수업환경 유지 조건 포함</span>
        </div>
        <div className="operation-plan-grid">
          <article>
            <span>오늘의 피크관리 운영안</span>
            <p>{peakOperationPlan.todayPlan}</p>
          </article>
          <article>
            <span>하계 운영안</span>
            <p>{peakOperationPlan.summerPlan}</p>
          </article>
          <article>
            <span>동계 운영안</span>
            <p>{peakOperationPlan.winterPlan}</p>
          </article>
          <article>
            <span>예냉/예열 시간</span>
            <p>{peakOperationPlan.preCoolingHeating}</p>
          </article>
        </div>
        <div className="operation-list-grid">
          <div>
            <h3>순차 가동 순서</h3>
            <ol>
              {peakOperationPlan.sequentialOrder.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3>동시에 켜면 안 되는 설비 조합</h3>
            <ul>
              {peakOperationPlan.avoidCombinations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>학생 수업환경 예외 조건</h3>
            <ul>
              {peakOperationPlan.exceptionConditions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>파워플래너 시간대별 사용량 상세</h2>
          <span>
            {hourlyChartData.length
              ? `${hourlyChartData.length.toLocaleString('ko-KR')}개 시간대 분석`
              : '자료 없음'}
          </span>
        </div>
        {hourlyChartData.length ? (
          <div className="power-peak-grid">
            <div className="chart-box power-hourly-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyChartData}>
                  <CartesianGrid stroke="#edf2f7" vertical={false} />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(value) => [
                      `${Number(value).toLocaleString('ko-KR')}kWh`,
                      '사용량',
                    ]}
                  />
                  <Bar dataKey="usageKwh" name="시간대별 사용량" radius={[5, 5, 0, 0]}>
                    {hourlyChartData.map((entry) => (
                      <Cell
                        key={entry.hour}
                        fill={entry.isPeakLoad ? '#f26b3a' : '#12b6cb'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="power-risk-stack">
              <article className="power-risk-card">
                <span>최대 사용 시간대</span>
                <strong>
                  {maxLoadRecord
                    ? `${maxLoadRecord.hour} · ${maxLoadRecord.usageKwh.toLocaleString('ko-KR')}kWh`
                    : '자료 없음'}
                </strong>
                <p>
                  주황색 막대는 하계/동계 최대부하 관리 시간대입니다.
                </p>
              </article>
              <article className="power-risk-card danger">
                <span>최대부하 시간대 위험도</span>
                <strong>{detailedRiskLevel}</strong>
                <p>
                  파워플래너 최대수요전력 자료가 있으면 해당 값을 우선 사용하고, 없으면 입력된 예상 피크를 사용합니다.
                </p>
              </article>
            </div>
          </div>
        ) : (
          <p className="empty-state">
            파워플래너 자료가 없으므로 기존 한전 고지서 월별 데이터와 예상 피크 입력값으로 진단합니다.
            시간대별 사용량 또는 최대수요전력 CSV/엑셀을 업로드하면 이 영역에 상세 그래프와 최대부하 시간대 위험도가 표시됩니다.
          </p>
        )}
      </section>
    </div>
  )
}
