import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, CalendarDays, ClipboardCheck } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { TopNotice } from './components/layout/TopNotice'
import { AutoDiagnosis } from './components/diagnosis/AutoDiagnosis'
import { RatePlanSettings } from './components/settings/RatePlanSettings'
import { defaultRatePlans } from './data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from './data/sampleBills'
import type {
  DataProvenance,
  MonthlyBill,
  PeakScenario,
  RatePlan,
  SchoolProfile,
  ViewKey,
} from './types'
import type { PowerPlannerDataSource } from './types'
import { sortBillsChronologically } from './lib/calculations'
import { buildAutoDiagnosis } from './lib/diagnosis'
import { buildPeakOperationPlan } from './lib/peakOperations'
import {
  dataProvenanceStorageKey,
  isCommittedStorageSession,
  isStoredMonthlyBillCollection,
  legacyDataModeStorageKey,
  loadDataProvenance,
  loadForSession,
  powerPlannerStorageKey,
  purgeInvalidCurrentStorageSession,
  purgeStorageSession,
  readStorageSession,
  restorePowerPlannerState,
  restoreStorageSession,
  saveForSession,
  startNewStorageSession,
  storageCommitKey,
  storageSessionKey,
  type StorageEntry,
  type StorageSession,
} from './lib/storage'

const billsKey = 'el-bill:bills'
const profileKey = 'el-bill:profile'
const scenarioKey = 'el-bill:scenario'
const ratePlansKey = 'el-bill:rate-plans'
const storageKeys = [
  billsKey,
  profileKey,
  scenarioKey,
  ratePlansKey,
  powerPlannerStorageKey,
  dataProvenanceStorageKey,
  legacyDataModeStorageKey,
]
const storageSnapshotKeys = [
  billsKey,
  profileKey,
  scenarioKey,
  ratePlansKey,
  powerPlannerStorageKey,
  dataProvenanceStorageKey,
]
const maxBrowserTimeoutMs = 2_147_483_647
const crossTabSessionGraceMs = 50

const Dashboard = lazy(() =>
  import('./components/dashboard/Dashboard').then((module) => ({
    default: module.Dashboard,
  })),
)
const RateSimulator = lazy(() =>
  import('./components/rates/RateSimulator').then((module) => ({
    default: module.RateSimulator,
  })),
)
const BillUpload = lazy(() =>
  import('./components/bills/BillUpload').then((module) => ({
    default: module.BillUpload,
  })),
)
const PowerPlannerUpload = lazy(() =>
  import('./components/powerPlanner/PowerPlannerUpload').then((module) => ({
    default: module.PowerPlannerUpload,
  })),
)
const PeakManager = lazy(() =>
  import('./components/peak/PeakManager').then((module) => ({
    default: module.PeakManager,
  })),
)
const DocumentGenerator = lazy(() =>
  import('./components/docs/DocumentGenerator').then((module) => ({
    default: module.DocumentGenerator,
  })),
)

function ViewLoadingFallback() {
  return (
    <div className="view-loading" role="status">
      화면을 불러오는 중입니다.
    </div>
  )
}

function App() {
  const initialStorageSession = restoreStorageSession(
    storageKeys,
    storageSessionKey,
    storageSnapshotKeys,
  )

  const loadedBillsPayload = initialStorageSession
    ? loadForSession<unknown>(billsKey, initialStorageSession)
    : null
  const loadedBills = isStoredMonthlyBillCollection(loadedBillsPayload?.data)
    ? { ...loadedBillsPayload, data: loadedBillsPayload.data }
    : null
  if (loadedBillsPayload && !loadedBills) localStorage.removeItem(billsKey)
  const loadedProfile = initialStorageSession
    ? loadForSession<SchoolProfile>(profileKey, initialStorageSession)
    : null
  const loadedScenario = initialStorageSession
    ? loadForSession<PeakScenario>(scenarioKey, initialStorageSession)
    : null
  const loadedPlans = initialStorageSession
    ? loadForSession<RatePlan[]>(ratePlansKey, initialStorageSession)
    : null
  const [restoredPowerPlanner] = useState(() =>
    restorePowerPlannerState(
      loadDataProvenance(loadedBills?.data, initialStorageSession),
      initialStorageSession,
    ),
  )

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
    useState<PowerPlannerDataSource | null>(restoredPowerPlanner.powerPlannerData)
  const [dataProvenance, setDataProvenance] = useState<DataProvenance>(
    restoredPowerPlanner.provenance,
  )
  const [storageSession, setStorageSession] = useState<StorageSession | null>(
    initialStorageSession,
  )
  const [expiryMessage, setExpiryMessage] = useState('')

  useEffect(() => {
    if (storageSession) saveForSession(billsKey, bills, storageSession)
  }, [bills, storageSession])

  useEffect(() => {
    if (storageSession) saveForSession(profileKey, profile, storageSession)
  }, [profile, storageSession])

  useEffect(() => {
    if (storageSession) saveForSession(scenarioKey, scenario, storageSession)
  }, [scenario, storageSession])

  useEffect(() => {
    if (storageSession) saveForSession(ratePlansKey, ratePlans, storageSession)
  }, [ratePlans, storageSession])

  useEffect(() => {
    if (!storageSession) return
    saveForSession(powerPlannerStorageKey, powerPlannerDataSource, storageSession)
  }, [powerPlannerDataSource, storageSession])

  useEffect(() => {
    if (storageSession) {
      saveForSession(dataProvenanceStorageKey, dataProvenance, storageSession)
    }
  }, [dataProvenance, storageSession])

  useEffect(() => {
    if (!storageSession) return

    const expireSession = () => {
      if (!purgeStorageSession(storageKeys, storageSession, storageSessionKey)) return
      setStorageSession(null)
      setBills(sampleBills)
      setProfile(defaultSchoolProfile)
      setScenario(defaultScenario)
      setRatePlans(defaultRatePlans)
      setPowerPlannerDataSource(null)
      setDataProvenance({ bills: 'sample', powerPlanner: 'none' })
      setActiveView('dashboard')
      setExpiryMessage('24시간이 지나 시연 데이터가 삭제되었습니다.')
    }

    let timeoutId: number | undefined
    const scheduleExpiry = () => {
      if (!isCommittedStorageSession(storageSession)) {
        expireSession()
        return
      }
      const remainingMs = Date.parse(storageSession.expiresAt) - Date.now()
      if (remainingMs <= 0) {
        expireSession()
        return
      }
      timeoutId = window.setTimeout(
        scheduleExpiry,
        Math.min(remainingMs, maxBrowserTimeoutMs),
      )
    }

    scheduleExpiry()
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [storageSession])

  useEffect(() => {
    if (!storageSession) return
    const resetToSample = (message: string) => {
      setStorageSession(null)
      setBills(sampleBills)
      setProfile(defaultSchoolProfile)
      setScenario(defaultScenario)
      setRatePlans(defaultRatePlans)
      setPowerPlannerDataSource(null)
      setDataProvenance({ bills: 'sample', powerPlanner: 'none' })
      setActiveView('dashboard')
      setExpiryMessage(message)
    }

    const adoptOrPurgeCurrentSession = () => {
      const nextSession = readStorageSession(storageSessionKey)
      if (!nextSession) {
        purgeInvalidCurrentStorageSession(
          storageKeys,
          storageSnapshotKeys,
          storageSessionKey,
        )
        resetToSample('다른 탭의 저장이 완료되지 않아 시연 샘플로 전환했습니다.')
        return
      }

      const nextBillsPayload = loadForSession<unknown>(billsKey, nextSession)
      const nextProfilePayload = loadForSession<SchoolProfile>(profileKey, nextSession)
      const nextScenarioPayload = loadForSession<PeakScenario>(scenarioKey, nextSession)
      const nextPlansPayload = loadForSession<RatePlan[]>(ratePlansKey, nextSession)
      if (
        !isStoredMonthlyBillCollection(nextBillsPayload?.data) ||
        !nextProfilePayload?.data ||
        !nextScenarioPayload?.data ||
        !Array.isArray(nextPlansPayload?.data)
      ) {
        purgeInvalidCurrentStorageSession(
          storageKeys,
          storageSnapshotKeys,
          storageSessionKey,
        )
        resetToSample('다른 탭의 저장이 완료되지 않아 시연 샘플로 전환했습니다.')
        return
      }

      const nextProvenance = loadDataProvenance(nextBillsPayload.data, nextSession)
      const nextPowerPlanner = restorePowerPlannerState(nextProvenance, nextSession)
      setStorageSession(nextSession)
      setBills(nextBillsPayload.data)
      setProfile(nextProfilePayload.data)
      setScenario(nextScenarioPayload.data)
      setRatePlans(nextPlansPayload.data)
      setPowerPlannerDataSource(nextPowerPlanner.powerPlannerData)
      setDataProvenance(nextPowerPlanner.provenance)
      setExpiryMessage('')
    }

    let deferredRecheckId: number | undefined
    const scheduleCrossTabRecheck = () => {
      if (deferredRecheckId !== undefined) window.clearTimeout(deferredRecheckId)
      deferredRecheckId = window.setTimeout(() => {
        deferredRecheckId = undefined
        adoptOrPurgeCurrentSession()
      }, crossTabSessionGraceMs)
    }

    const recheckOwnedSession = () => {
      if (isCommittedStorageSession(storageSession)) return
      const expired = Date.parse(storageSession.expiresAt) <= Date.now()
      if (expired && purgeStorageSession(storageKeys, storageSession, storageSessionKey)) {
        resetToSample('24시간이 지나 시연 데이터가 삭제되었습니다.')
        return
      }
      scheduleCrossTabRecheck()
    }

    const handleStorageSessionChange = (event: StorageEvent) => {
      if (
        event.storageArea !== localStorage ||
        (event.key !== storageSessionKey && event.key !== storageCommitKey)
      ) return
      scheduleCrossTabRecheck()
    }
    const handleFocus = () => recheckOwnedSession()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') recheckOwnedSession()
    }
    window.addEventListener('storage', handleStorageSessionChange)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('storage', handleStorageSessionChange)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (deferredRecheckId !== undefined) window.clearTimeout(deferredRecheckId)
    }
  }, [storageSession])

  const sortedBills = useMemo(() => sortBillsChronologically(bills), [bills])
  const latestBill = sortedBills.at(-1)
  const diagnosis = useMemo(
    () =>
      buildAutoDiagnosis({
        bills,
        profile,
        ratePlans,
        scenario,
        powerPlannerDataSource,
        billsAreUserUploaded: dataProvenance.bills === 'uploaded',
      }),
    [bills, profile, ratePlans, scenario, powerPlannerDataSource, dataProvenance.bills],
  )
  const currentPlan = diagnosis.currentPlan
  const candidatePlan = diagnosis.recommendedPlan
  const comparison = diagnosis.comparison
  const peakOperationPlan = useMemo(
    () => buildPeakOperationPlan(scenario),
    [scenario],
  )

  const resetSample = () => {
    storageKeys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(storageSessionKey)
    localStorage.removeItem(storageCommitKey)
    setStorageSession(null)
    setBills(sampleBills)
    setProfile(defaultSchoolProfile)
    setScenario(defaultScenario)
    setRatePlans(defaultRatePlans)
    setPowerPlannerDataSource(null)
    setDataProvenance({ bills: 'sample', powerPlanner: 'none' })
    setExpiryMessage('')
  }

  const startUploadSession = (
    nextBills: MonthlyBill[],
    nextPowerPlannerDataSource: PowerPlannerDataSource | null,
    nextProvenance: DataProvenance,
  ) => {
    const entries: StorageEntry[] = [
      [billsKey, nextBills],
      [profileKey, profile],
      [scenarioKey, scenario],
      [ratePlansKey, ratePlans],
      [powerPlannerStorageKey, nextPowerPlannerDataSource],
      [dataProvenanceStorageKey, nextProvenance],
    ]
    const nextSession = startNewStorageSession(
      entries,
      Date.now(),
      undefined,
      storageSnapshotKeys,
    )
    setStorageSession(nextSession)
    setExpiryMessage('')
  }

  const applyBillsAndOpenDiagnosis = (nextBills: MonthlyBill[]) => {
    const nextProvenance: DataProvenance = {
      ...dataProvenance,
      bills: 'uploaded',
    }
    startUploadSession(nextBills, powerPlannerDataSource, nextProvenance)
    setBills(nextBills)
    setDataProvenance(nextProvenance)
    setActiveView('diagnosis')
  }

  const applyPowerPlannerAndOpenDiagnosis = (
    nextDataSource: PowerPlannerDataSource | null,
    origin: DataProvenance['powerPlanner'],
  ) => {
    const nextProvenance: DataProvenance = {
      ...dataProvenance,
      powerPlanner: origin,
    }
    if (nextDataSource && origin === 'uploaded') {
      startUploadSession(bills, nextDataSource, nextProvenance)
    }
    setPowerPlannerDataSource(nextDataSource)
    setDataProvenance(nextProvenance)
    if (nextDataSource) {
      setActiveView('diagnosis')
    }
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
          <TopNotice
            expiresAt={storageSession?.expiresAt}
            dataProvenance={dataProvenance}
            onReset={resetSample}
            expiryMessage={expiryMessage}
          />
        </header>

        <section className="view-frame">
          <div className="view-heading">
            <span className="step-badge">{viewMeta[activeView].step}</span>
            <div>
              <h2>{viewMeta[activeView].title}</h2>
              <p>{viewMeta[activeView].description}</p>
            </div>
          </div>

          <Suspense fallback={<ViewLoadingFallback />}>
            {activeView === 'dashboard' && (
              <Dashboard
                bills={bills}
                currentPlan={currentPlan}
                candidatePlan={candidatePlan}
                scenario={scenario}
                diagnosis={diagnosis}
                dataProvenance={dataProvenance}
                onStartDiagnosis={() => setActiveView('diagnosis')}
              />
            )}
            {activeView === 'diagnosis' && (
              <AutoDiagnosis
                diagnosis={diagnosis}
                dataProvenance={dataProvenance}
                onNavigate={setActiveView}
              />
            )}
            {activeView === 'school' && (
              <SchoolProfilePanel
                profile={profile}
                ratePlans={ratePlans}
                onProfileChange={setProfile}
              />
            )}
            {activeView === 'bills' && (
              <BillUpload
                bills={bills}
                profile={profile}
                ratePlans={ratePlans}
                onBillsChange={applyBillsAndOpenDiagnosis}
              />
            )}
            {activeView === 'powerPlanner' && (
              <PowerPlannerUpload
                dataSource={powerPlannerDataSource}
                dataOrigin={dataProvenance.powerPlanner}
                onDataSourceChange={applyPowerPlannerAndOpenDiagnosis}
              />
            )}
            {activeView === 'rates' && (
              currentPlan && candidatePlan ? (
                <RateSimulator
                  bills={bills}
                  currentPlan={currentPlan}
                  candidatePlan={candidatePlan}
                  candidates={diagnosis.topCandidates}
                  scenario={scenario}
                  onScenarioChange={setScenario}
                />
              ) : (
                <section className="document-block-notice" role="status">
                  <AlertCircle size={22} />
                  <div>
                    <strong>요금제 비교 보류</strong>
                    <p>{diagnosis.judgementBasis}</p>
                  </div>
                </section>
              )
            )}
            {activeView === 'peak' && (
              <PeakManager
                scenario={scenario}
                onScenarioChange={setScenario}
                powerPlannerDataSource={powerPlannerDataSource}
                peakOperationPlan={peakOperationPlan}
              />
            )}
            {activeView === 'docs' && (
              <DocumentGenerator
                profile={profile}
                latestBill={latestBill}
                comparison={comparison}
                scenario={scenario}
                diagnosis={diagnosis}
                peakOperationPlan={peakOperationPlan}
              />
            )}
          </Suspense>
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
  diagnosis: {
    step: '02',
    title: '자동진단',
    description: '자료 업로드부터 추천, 피크관리, 변경신청 패키지까지 한 흐름으로 안내합니다.',
  },
  school: {
    step: '03',
    title: '학교정보',
    description: '문서와 계산에 들어가는 학교 프로필을 익명 샘플 기준으로 관리합니다.',
  },
  bills: {
    step: '04',
    title: '월별 한전고지서 입력',
    description: '엑셀·CSV 업로드와 컬럼 매핑으로 월별 고지서 데이터를 반영합니다.',
  },
  rates: {
    step: '06',
    title: '요금제 비교 시뮬레이션',
    description: '최근 12개월, 최근 3년, 피크 시나리오 기준으로 변경 효과를 추정합니다.',
  },
  peak: {
    step: '07',
    title: '전력피크 관리',
    description: '목표 피크 대비 위험도를 판정하고 운영 가이드를 자동 구성합니다.',
  },
  docs: {
    step: '08',
    title: '변경신청 패키지 자동 생성',
    description: '계획안, 한전 공문, 변경신청서, 계산 근거, 검토 항목을 생성합니다.',
  },
  settings: {
    step: '09',
    title: '설정',
    description: '학교용 요금제 단가와 적용일을 수정해 시나리오를 확장합니다.',
  },
  powerPlanner: {
    step: '05',
    title: '파워플래너 자료 가져오기',
    description: '한전 파워플래너에서 내려받거나 정리한 엑셀/CSV를 업로드해 보조 분석합니다.',
  },
}

interface SchoolProfilePanelProps {
  profile: SchoolProfile
  ratePlans: RatePlan[]
  onProfileChange: (profile: SchoolProfile) => void
}

function SchoolProfilePanel({
  profile,
  ratePlans,
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

  const contractTypes = Array.from(new Set(ratePlans.map((plan) => plan.contractType)))
  const voltageTypes = Array.from(
    new Set(
      ratePlans
        .filter((plan) => plan.contractType === profile.contractType)
        .map((plan) => plan.voltageType),
    ),
  )
  const currentPlanOptions = ratePlans.filter(
    (plan) =>
      plan.contractType === profile.contractType &&
      plan.voltageType === profile.voltageType,
  )
  const matchingCurrentPlans = currentPlanOptions.filter(
    (plan) => plan.planName === profile.currentPlan,
  )
  const hasCurrentPlan = matchingCurrentPlans.length === 1
  const selectedCurrentPlanId = hasCurrentPlan ? matchingCurrentPlans[0].id : ''

  const setTariffProfile = (
    contractType: string,
    voltageType: string,
    currentPlanId?: string,
  ) => {
    const compatiblePlans = ratePlans.filter(
      (plan) =>
        plan.contractType === contractType && plan.voltageType === voltageType,
    )
    const nextPlan = compatiblePlans.find((plan) => plan.id === currentPlanId)
      ?? compatiblePlans[0]
    onProfileChange({
      ...profile,
      contractType,
      voltageType,
      currentPlan: nextPlan?.planName ?? '',
    })
  }

  const updateContractType = (contractType: string) => {
    const compatiblePlans = ratePlans.filter((plan) => plan.contractType === contractType)
    const voltageType = compatiblePlans.some(
      (plan) => plan.voltageType === profile.voltageType,
    )
      ? profile.voltageType
      : compatiblePlans[0]?.voltageType ?? ''
    setTariffProfile(contractType, voltageType)
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
          <label>
            계약종별
            <select value={profile.contractType} onChange={(event) => updateContractType(event.target.value)}>
              <option value="">선택</option>
              {contractTypes.map((contractType) => (
                <option key={contractType} value={contractType}>{contractType}</option>
              ))}
            </select>
          </label>
          <label>
            수전전압
            <select
              value={profile.voltageType}
              onChange={(event) => setTariffProfile(profile.contractType, event.target.value)}
            >
              <option value="">선택</option>
              {voltageTypes.map((voltageType) => (
                <option key={voltageType} value={voltageType}>{voltageType}</option>
              ))}
            </select>
          </label>
          <label>
            현재 요금제
            <select
              value={selectedCurrentPlanId}
              onChange={(event) =>
                setTariffProfile(profile.contractType, profile.voltageType, event.target.value)
              }
            >
              <option value="">선택</option>
              {currentPlanOptions.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.planName}</option>
              ))}
            </select>
          </label>
        </div>
        {!hasCurrentPlan && (
          <p className="status-line" role="status">
            현재 요금제 조합이 없거나 중복됩니다. 계약종별·수전전압·요금제명 조합을 하나만 남긴 뒤 선택해 주세요.
          </p>
        )}
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
