import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, CalendarDays, ClipboardCheck } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { TopNotice } from './components/layout/TopNotice'
import { Dashboard } from './components/dashboard/Dashboard'
import { BillUpload } from './components/bills/BillUpload'
import { PowerPlannerUpload } from './components/powerPlanner/PowerPlannerUpload'
import { RateSimulator } from './components/rates/RateSimulator'
import { PeakManager } from './components/peak/PeakManager'
import { DocumentGenerator } from './components/docs/DocumentGenerator'
import { RatePlanSettings } from './components/settings/RatePlanSettings'
import { defaultRatePlans, currentPlanId, recommendedPlanId } from './data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from './data/sampleBills'
import type { MonthlyBill, PeakScenario, RatePlan, SchoolProfile, ViewKey } from './types'
import type { PowerPlannerDataSource } from './types'
import { comparePlans, sortBillsChronologically } from './lib/calculations'
import { createExpiry, loadWithExpiry, purgeExpiredKeys, saveWithExpiry } from './lib/storage'

const billsKey = 'el-bill:bills'
const profileKey = 'el-bill:profile'
const scenarioKey = 'el-bill:scenario'
const ratePlansKey = 'el-bill:rate-plans'
const powerPlannerKey = 'el-bill:power-planner'
const storageKeys = [billsKey, profileKey, scenarioKey, ratePlansKey, powerPlannerKey]

function App() {
  purgeExpiredKeys(storageKeys)

  const loadedBills = loadWithExpiry<MonthlyBill[]>(billsKey)
  const loadedProfile = loadWithExpiry<SchoolProfile>(profileKey)
  const loadedScenario = loadWithExpiry<PeakScenario>(scenarioKey)
  const loadedPlans = loadWithExpiry<RatePlan[]>(ratePlansKey)
  const loadedPowerPlanner = loadWithExpiry<PowerPlannerDataSource>(powerPlannerKey)

  const [activeView, setActiveView] = useState<ViewKey>('dashboard')
  const [bills, setBills] = useState<MonthlyBill[]>(loadedBills?.data ?? sampleBills)
  const [profile, setProfile] = useState<SchoolProfile>(
    loadedProfile?.data ?? defaultSchoolProfile,
  )
  const [scenario, setScenario] = useState<PeakScenario>(
    loadedScenario?.data ?? defaultScenario,
  )
  const [ratePlans, setRatePlans] = useState<RatePlan[]>(
    loadedPlans?.data ?? defaultRatePlans,
  )
  const [powerPlannerDataSource, setPowerPlannerDataSource] =
    useState<PowerPlannerDataSource | null>(loadedPowerPlanner?.data ?? null)
  const [expiresAt, setExpiresAt] = useState(
    loadedBills?.expiresAt ?? createExpiry().expiresAt,
  )

  useEffect(() => {
    const saved = saveWithExpiry(billsKey, bills)
    setExpiresAt(saved.expiresAt)
  }, [bills])

  useEffect(() => {
    saveWithExpiry(profileKey, profile)
  }, [profile])

  useEffect(() => {
    saveWithExpiry(scenarioKey, scenario)
  }, [scenario])

  useEffect(() => {
    saveWithExpiry(ratePlansKey, ratePlans)
  }, [ratePlans])

  useEffect(() => {
    if (powerPlannerDataSource) {
      saveWithExpiry(powerPlannerKey, powerPlannerDataSource)
    } else {
      localStorage.removeItem(powerPlannerKey)
    }
  }, [powerPlannerDataSource])

  const currentPlan =
    ratePlans.find((plan) => plan.id === currentPlanId) ?? ratePlans[0]
  const candidatePlan =
    ratePlans.find((plan) => plan.id === recommendedPlanId) ?? ratePlans[1]
  const sortedBills = useMemo(() => sortBillsChronologically(bills), [bills])
  const latestBill = sortedBills.at(-1)
  const comparison = useMemo(
    () => comparePlans(bills, currentPlan, candidatePlan, scenario),
    [bills, currentPlan, candidatePlan, scenario],
  )

  const resetSample = () => {
    localStorage.removeItem(billsKey)
    localStorage.removeItem(profileKey)
    localStorage.removeItem(scenarioKey)
    localStorage.removeItem(ratePlansKey)
    localStorage.removeItem(powerPlannerKey)
    setBills(sampleBills)
    setProfile(defaultSchoolProfile)
    setScenario(defaultScenario)
    setRatePlans(defaultRatePlans)
    setPowerPlannerDataSource(null)
  }

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onChange={setActiveView} />
      <main className="main-area">
        <header className="app-header">
          <div>
            <h1>서울교육 전기요금 절감 진단·피크관리 플랫폼</h1>
            <p>학교별 한전고지서 분석 · 요금제 비교 · 피크관리 · 한전 변경신청서 PDF 생성</p>
          </div>
          <TopNotice expiresAt={expiresAt} onReset={resetSample} />
        </header>

        <section className="view-frame">
          <div className="view-heading">
            <span className="step-badge">{viewMeta[activeView].step}</span>
            <div>
              <h2>{viewMeta[activeView].title}</h2>
              <p>{viewMeta[activeView].description}</p>
            </div>
          </div>

          {activeView === 'dashboard' && (
            <Dashboard
              bills={bills}
              currentPlan={currentPlan}
              candidatePlan={candidatePlan}
              scenario={scenario}
            />
          )}
          {activeView === 'school' && (
            <SchoolProfilePanel profile={profile} onProfileChange={setProfile} />
          )}
          {activeView === 'bills' && (
            <BillUpload bills={bills} profile={profile} onBillsChange={setBills} />
          )}
          {activeView === 'powerPlanner' && (
            <PowerPlannerUpload
              dataSource={powerPlannerDataSource}
              onDataSourceChange={setPowerPlannerDataSource}
            />
          )}
          {activeView === 'rates' && (
            <RateSimulator
              bills={bills}
              currentPlan={currentPlan}
              candidatePlan={candidatePlan}
              scenario={scenario}
              onScenarioChange={setScenario}
            />
          )}
          {activeView === 'peak' && (
            <PeakManager
              scenario={scenario}
              onScenarioChange={setScenario}
              powerPlannerDataSource={powerPlannerDataSource}
            />
          )}
          {activeView === 'docs' && (
            <DocumentGenerator
              profile={profile}
              latestBill={latestBill}
              comparison={comparison}
              scenario={scenario}
            />
          )}
          {activeView === 'settings' && (
            <RatePlanSettings plans={ratePlans} onPlansChange={setRatePlans} />
          )}
        </section>
      </main>
    </div>
  )
}

const viewMeta: Record<ViewKey, { step: string; title: string; description: string }> = {
  dashboard: {
    step: '01',
    title: '통합 대시보드',
    description: '전기요금, 사용량, 피크, 추천 요금제를 한 화면에서 점검합니다.',
  },
  school: {
    step: '02',
    title: '학교정보',
    description: '문서와 계산에 들어가는 학교 프로필을 익명 샘플 기준으로 관리합니다.',
  },
  bills: {
    step: '03',
    title: '월별 한전고지서 입력',
    description: '엑셀·CSV 업로드와 컬럼 매핑으로 월별 고지서 데이터를 반영합니다.',
  },
  rates: {
    step: '05',
    title: '요금제 비교 시뮬레이션',
    description: '최근 12개월, 최근 3년, 피크 시나리오 기준으로 변경 효과를 추정합니다.',
  },
  peak: {
    step: '06',
    title: '전력피크 관리',
    description: '목표 피크 대비 위험도를 판정하고 운영 가이드를 자동 구성합니다.',
  },
  docs: {
    step: '07',
    title: '문서 자동 생성',
    description: '내부 계획안, 한전 공문, 변경신청서 미리보기를 생성합니다.',
  },
  settings: {
    step: '08',
    title: '설정',
    description: '학교용 요금제 단가와 적용일을 수정해 시나리오를 확장합니다.',
  },
  powerPlanner: {
    step: '04',
    title: '파워플래너 자료 가져오기',
    description: '한전 파워플래너에서 내려받거나 정리한 엑셀/CSV를 업로드해 보조 분석합니다.',
  },
}

interface SchoolProfilePanelProps {
  profile: SchoolProfile
  onProfileChange: (profile: SchoolProfile) => void
}

function SchoolProfilePanel({
  profile,
  onProfileChange,
}: SchoolProfilePanelProps) {
  const update = (key: keyof SchoolProfile, value: string) => {
    onProfileChange({
      ...profile,
      [key]: ['contractPowerKw', 'appliedPowerKw'].includes(key)
        ? Number(value)
        : value,
    })
  }

  return (
    <div className="view-stack">
      <section className="school-summary">
        <article>
          <Building2 size={28} />
          <span>표시 학교명</span>
          <strong>{profile.displaySchoolName}</strong>
        </article>
        <article>
          <ClipboardCheck size={28} />
          <span>계약종별</span>
          <strong>{profile.contractType} {profile.voltageType}</strong>
        </article>
        <article>
          <CalendarDays size={28} />
          <span>데이터 보존</span>
          <strong>24시간</strong>
        </article>
        <article>
          <AlertCircle size={28} />
          <span>민감정보</span>
          <strong>마스킹</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>학교 프로필</h2>
          <span>실제 학교명·고객번호·연락처는 샘플에서 마스킹</span>
        </div>
        <div className="profile-form">
          {[
            ['displaySchoolName', '화면 표시명'],
            ['customerNumber', '고객번호'],
            ['address', '전기사용장소'],
            ['kepcoBranch', '한전 지사'],
            ['contractType', '계약종별'],
            ['voltageType', '수전전압'],
            ['currentPlan', '현재 요금제'],
            ['contractPowerKw', '계약전력(kW)'],
            ['appliedPowerKw', '요금적용전력(kW)'],
            ['managerName', '담당자명'],
            ['managerPhone', '담당자 연락처'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={String(profile[key as keyof SchoolProfile])}
                onChange={(event) =>
                  update(key as keyof SchoolProfile, event.target.value)
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="panel muted-panel">
        <strong>익명화 정책</strong>
        <p>
          앱 UI, 샘플 데이터, 문서 생성 결과에서는 실제 학교명을 {profile.displaySchoolName}로 표시합니다.
          담당자명, 이메일, 전화번호, 주소, 고객번호는 마스킹 또는 예시값으로만 사용합니다.
        </p>
      </section>
    </div>
  )
}

export default App
