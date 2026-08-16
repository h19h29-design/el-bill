import { ArrowLeft, SearchCheck } from 'lucide-react'
import type { RatePlan, SchoolProfile } from '../../types'

interface EasyDiagnosisProfileStepProps {
  profile: SchoolProfile
  ratePlans: RatePlan[]
  issue: string | null
  saving: boolean
  onChange: (profile: SchoolProfile) => void
  onBack: () => void
  onAnalyze: () => void
}

const unique = (values: string[]) => [...new Set(values)]

export function EasyDiagnosisProfileStep({
  profile,
  ratePlans,
  issue,
  saving,
  onChange,
  onBack,
  onAnalyze,
}: EasyDiagnosisProfileStepProps) {
  const contractTypes = unique(ratePlans.map((plan) => plan.contractType))
  const voltages = unique(
    ratePlans
      .filter((plan) => plan.contractType === profile.contractType)
      .map((plan) => plan.voltageType),
  )
  const plans = unique(
    ratePlans
      .filter(
        (plan) =>
          plan.contractType === profile.contractType &&
          plan.voltageType === profile.voltageType,
      )
      .map((plan) => plan.planName),
  )

  const changeContractType = (contractType: string) => {
    const matchingPlans = ratePlans.filter((plan) => plan.contractType === contractType)
    const first = matchingPlans[0]
    onChange({
      ...profile,
      contractType,
      voltageType: first?.voltageType ?? '',
      currentPlan: first?.planName ?? '',
    })
  }

  const changeVoltage = (voltageType: string) => {
    const first = ratePlans.find(
      (plan) => plan.contractType === profile.contractType && plan.voltageType === voltageType,
    )
    onChange({
      ...profile,
      voltageType,
      currentPlan: first?.planName ?? '',
    })
  }

  return (
    <section className="easy-diagnosis-page" aria-labelledby="easy-profile-title">
      <div className="easy-diagnosis-page-heading">
        <span>4단계</span>
        <h2 id="easy-profile-title">계약정보를 확인해 주세요</h2>
        <p>한전 고지서의 계약종별, 수전전압, 현재 요금제, 요금적용전력을 그대로 선택하세요.</p>
      </div>
      <div className="easy-profile-grid">
        <label>
          계약종별
          <select value={profile.contractType} onChange={(event) => changeContractType(event.target.value)}>
            {contractTypes.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          수전전압
          <select value={profile.voltageType} onChange={(event) => changeVoltage(event.target.value)}>
            {voltages.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          현재 요금제
          <select value={profile.currentPlan} onChange={(event) => onChange({ ...profile, currentPlan: event.target.value })}>
            {plans.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          요금적용전력(kW)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={profile.appliedPowerKw || ''}
            onChange={(event) => onChange({ ...profile, appliedPowerKw: Number(event.target.value) })}
          />
        </label>
      </div>
      <p className="easy-profile-help">모르면 고지서의 계약사항 또는 요금내역에서 확인하세요.</p>
      {issue && <p className="empty-state" role="status">{issue}</p>}
      <div className="easy-page-actions">
        <button type="button" className="outline-action" onClick={onBack}>
          <ArrowLeft size={17} /> 월별 자료 다시 확인
        </button>
        <button type="button" className="primary-button" disabled={Boolean(issue) || saving} onClick={onAnalyze}>
          <SearchCheck size={18} /> {saving ? '분석 준비 중' : '자동 분석 시작'}
        </button>
      </div>
    </section>
  )
}
