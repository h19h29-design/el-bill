import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  CircleDollarSign,
  TrendingDown,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MonthlyBill, PeakScenario, RatePlan } from '../../types'
import {
  formatWon,
  getDashboardSummary,
  groupBillsForCharts,
} from '../../lib/calculations'
import { getPeakRiskLevel } from '../../lib/peak'

interface DashboardProps {
  bills: MonthlyBill[]
  currentPlan: RatePlan
  candidatePlan: RatePlan
  scenario: PeakScenario
}

const chartCurrency = (value: number) =>
  `${Math.round(value / 10000).toLocaleString('ko-KR')}만`

export function Dashboard({
  bills,
  currentPlan,
  candidatePlan,
  scenario,
}: DashboardProps) {
  const summary = getDashboardSummary(bills, currentPlan, candidatePlan, scenario)
  const chartData = groupBillsForCharts(bills)
  const latest = summary.latest
  const peakLevel = getPeakRiskLevel(
    scenario.targetPeakKw,
    scenario.expectedPeakKw,
  )
  const pieData = latest
    ? [
        { name: '기본요금', value: latest.baseChargeWon, color: '#0b72e7' },
        { name: '전력량요금', value: latest.energyChargeWon, color: '#12b6cb' },
        { name: '부가/기금', value: latest.vatWon + latest.fundWon, color: '#7c69e8' },
        { name: '기후·조정', value: Math.max(0, latest.climateChargeWon), color: '#59c66f' },
      ]
    : []

  return (
    <div className="view-stack">
      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-icon blue">
            <CircleDollarSign size={22} />
          </div>
          <span>올해 누적 전기요금</span>
          <strong>{formatWon(summary.currentYearTotal)}</strong>
          <small>{summary.latestYear}학년도 입력 기준</small>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon green">
            <TrendingDown size={22} />
          </div>
          <span>전년 대비</span>
          <strong className={summary.yoyRate <= 0 ? 'positive' : 'danger-text'}>
            {(summary.yoyRate * 100).toFixed(1)}%
          </strong>
          <small>동일 월 기준 비교</small>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon teal">
            <BarChart3 size={22} />
          </div>
          <span>예상 연간 절감액</span>
          <strong>{formatWon(summary.comparison.savingWon)}</strong>
          <small>요금제 변경 시뮬레이션</small>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon orange">
            <AlertTriangle size={22} />
          </div>
          <span>현재 피크 위험도</span>
          <strong className="danger-text">{peakLevel}</strong>
          <small>목표 대비 {(summary.peakRisk * 100).toFixed(0)}%</small>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon purple">
            <BadgeCheck size={22} />
          </div>
          <span>추천 요금제</span>
          <strong>{candidatePlan.planName}</strong>
          <small>{summary.comparison.recommendation}</small>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-title">
            <h2>월별 전기요금</h2>
            <span>{chartData.priorYear} / {chartData.latestYear}</span>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData.byMonth}>
                <CartesianGrid stroke="#edf2f7" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={chartCurrency} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => formatWon(Number(value))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="priorBill"
                  name={`${chartData.priorYear}년`}
                  stroke="#93c5fd"
                  strokeWidth={3}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="currentBill"
                  name={`${chartData.latestYear}년`}
                  stroke="#0b72e7"
                  strokeWidth={3}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h2>월별 사용량</h2>
            <span>kWh</span>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.byMonth}>
                <CartesianGrid stroke="#edf2f7" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="priorUsage" name={`${chartData.priorYear}년`} fill="#8fd0ff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="currentUsage" name={`${chartData.latestYear}년`} fill="#12b6cb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h2>최대수요전력</h2>
            <span>kW</span>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData.byMonth}>
                <CartesianGrid stroke="#edf2f7" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Line dataKey="priorDemand" name={`${chartData.priorYear}년`} stroke="#93c5fd" strokeWidth={3} dot={false} connectNulls />
                <Line dataKey="currentDemand" name={`${chartData.latestYear}년`} stroke="#0b72e7" strokeWidth={3} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h2>요금 구성</h2>
            <span>{latest ? `${latest.year}.${latest.month}` : '-'}</span>
          </div>
          <div className="donut-layout">
            <div className="fee-donut">
              <strong>
                {latest ? latest.totalBillWon.toLocaleString('ko-KR') : '-'}
              </strong>
              <span>원</span>
            </div>
            <div className="donut-legend">
              {pieData.map((entry) => (
                <div key={entry.name}>
                  <span style={{ backgroundColor: entry.color }} />
                  <p>{entry.name}</p>
                  <strong>{formatWon(entry.value)}</strong>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}
