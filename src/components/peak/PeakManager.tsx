import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Gauge, Target } from 'lucide-react'
import type { PeakScenario } from '../../types'
import {
  getPeakRatio,
  getPeakRiskLevel,
  getPeakRiskTone,
  peakGuideItems,
  summerPeakBlocks,
  winterPeakBlocks,
} from '../../lib/peak'

interface PeakManagerProps {
  scenario: PeakScenario
  onScenarioChange: (scenario: PeakScenario) => void
}

export function PeakManager({ scenario, onScenarioChange }: PeakManagerProps) {
  const ratio = getPeakRatio(scenario.targetPeakKw, scenario.expectedPeakKw)
  const level = getPeakRiskLevel(scenario.targetPeakKw, scenario.expectedPeakKw)
  const tone = getPeakRiskTone(level)
  const percent = Math.round(ratio * 100)
  const guideItems = useMemo(() => peakGuideItems, [])

  const update = (key: keyof PeakScenario, value: string) => {
    onScenarioChange({
      ...scenario,
      [key]:
        key === 'memo'
          ? value
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
    </div>
  )
}
