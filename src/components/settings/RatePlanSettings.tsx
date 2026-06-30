import type { RatePlan, Season } from '../../types'

interface RatePlanSettingsProps {
  plans: RatePlan[]
  onPlansChange: (plans: RatePlan[]) => void
}

const seasonLabels: Record<Season, string> = {
  springAutumn: '봄·가을',
  summer: '여름',
  winter: '겨울',
}

export function RatePlanSettings({
  plans,
  onPlansChange,
}: RatePlanSettingsProps) {
  const updatePlan = (
    planId: string,
    updater: (plan: RatePlan) => RatePlan,
  ) => {
    onPlansChange(plans.map((plan) => (plan.id === planId ? updater(plan) : plan)))
  }

  const addPlan = () => {
    const base = plans[0]
    onPlansChange([
      ...plans,
      {
        ...base,
        id: `custom-${Date.now()}`,
        planName: '사용자 요금제',
        memo: '설정 화면에서 추가',
      },
    ])
  }

  return (
    <div className="view-stack">
      <section className="panel muted-panel">
        <strong>요금표 관리</strong>
        <p>
          단가는 코드 고정값이 아니라 설정 데이터로 관리합니다. 실제 계약·제출 전에는 최신 한전 고시 단가를 확인해야 합니다.
        </p>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>학교용 요금제</h2>
          <button type="button" className="primary-button small" onClick={addPlan}>
            요금제 추가
          </button>
        </div>
        <div className="rate-settings-list">
          {plans.map((plan) => (
            <article key={plan.id} className="rate-setting-row">
              <div className="rate-setting-main">
                <input
                  value={plan.contractType}
                  aria-label="계약종별"
                  onChange={(event) =>
                    updatePlan(plan.id, (current) => ({
                      ...current,
                      contractType: event.target.value,
                    }))
                  }
                />
                <input
                  value={plan.voltageType}
                  aria-label="수전전압"
                  onChange={(event) =>
                    updatePlan(plan.id, (current) => ({
                      ...current,
                      voltageType: event.target.value,
                    }))
                  }
                />
                <input
                  value={plan.planName}
                  aria-label="요금제명"
                  onChange={(event) =>
                    updatePlan(plan.id, (current) => ({
                      ...current,
                      planName: event.target.value,
                    }))
                  }
                />
                <label>
                  기본요금
                  <input
                    type="number"
                    value={plan.baseRateWonPerKw}
                    onChange={(event) =>
                      updatePlan(plan.id, (current) => ({
                        ...current,
                        baseRateWonPerKw: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <div className="season-rate-grid">
                {(Object.keys(seasonLabels) as Season[]).map((season) => (
                  <label key={season}>
                    {seasonLabels[season]}
                    <input
                      type="number"
                      step="0.1"
                      value={plan.seasonRates[season]}
                      onChange={(event) =>
                        updatePlan(plan.id, (current) => ({
                          ...current,
                          seasonRates: {
                            ...current.seasonRates,
                            [season]: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                ))}
                <label>
                  적용일
                  <input
                    type="date"
                    value={plan.effectiveFrom}
                    onChange={(event) =>
                      updatePlan(plan.id, (current) => ({
                        ...current,
                        effectiveFrom: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <textarea
                value={plan.memo}
                aria-label="요금제 메모"
                onChange={(event) =>
                  updatePlan(plan.id, (current) => ({
                    ...current,
                    memo: event.target.value,
                  }))
                }
              />
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
