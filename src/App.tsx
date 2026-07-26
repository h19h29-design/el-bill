import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, CalendarDays, ClipboardCheck } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { TopNotice } from './components/layout/TopNotice'
import { ViewErrorBoundary } from './components/layout/ViewErrorBoundary'
import { AutoDiagnosis } from './components/diagnosis/AutoDiagnosis'
import { RatePlanSettings } from './components/settings/RatePlanSettings'
import { defaultRatePlans } from './data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from './data/sampleBills'
import type {
  CalculationSettings,
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
import { defaultCalculationSettings } from './lib/calculationSettings'
import {
  cleanupExpiredStorageSnapshots,
  getNextStorageSnapshotExpiry,
  getNextStorageExpiry,
  getPendingStorageCleanupKeys,
  initializeStorageAfterMount,
  isSessionSnapshotStorageKey,
  readStorageSnapshot,
  readStorageActivePointer,
  removeStorageSnapshot,
  startNewStorageSnapshot,
  storageActivePointerKey,
  storageSnapshotKeyFor,
  updateStorageSnapshot,
  usesSameTabStorageLockFallback,
  type StorageSnapshot,
  type StorageSnapshotData,
  type StorageSnapshotWriteResult,
  type StorageSession,
} from './lib/storage'

const maxBrowserTimeoutMs = 2_147_483_647
const orphanCleanupRetryDelaysMs = [60_000, 5 * 60_000, 15 * 60_000] as const
const storageFailureMessage =
  '브라우저 저장소에 자료를 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요.'
const storageLockFailureMessage =
  '안전한 저장 잠금을 확보하지 못했습니다. 다른 탭을 닫고 다시 시도해 주세요.'
const storageLockFallbackMessage =
  '이 브라우저에서는 여러 탭 동시 편집을 안전하게 조정할 수 없습니다. 다른 탭을 닫고 한 탭에서만 사용하세요.'
const storageOrphanCleanupMessage =
  '시연 샘플로 전환했지만 남은 브라우저 데이터 정리가 지연되고 있습니다. 잠시 후 자동으로 다시 정리합니다.'

const defaultStorageData = (): StorageSnapshotData => ({
  bills: sampleBills,
  profile: defaultSchoolProfile,
  scenario: defaultScenario,
  ratePlans: defaultRatePlans,
  calculationSettings: defaultCalculationSettings,
  powerPlanner: null,
  provenance: { bills: 'sample', powerPlanner: 'none' },
})

const initializeAppStorage = () => {
  const snapshot = readStorageSnapshot()
  return {
    snapshot,
    data: snapshot?.data ?? defaultStorageData(),
  }
}

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
  const [initialStorage] = useState(initializeAppStorage)
  const [activeView, setActiveView] = useState<ViewKey>('dashboard')
  const [bills, setBills] = useState<MonthlyBill[]>(initialStorage.data.bills)
  const [profile, setProfile] = useState<SchoolProfile>(
    initialStorage.data.profile,
  )
  const [scenario, setScenario] = useState<PeakScenario>(
    initialStorage.data.scenario,
  )
  const [ratePlans, setRatePlans] = useState<RatePlan[]>(
    initialStorage.data.ratePlans,
  )
  const [calculationSettings, setCalculationSettings] =
    useState<CalculationSettings>(initialStorage.data.calculationSettings)
  const [powerPlannerDataSource, setPowerPlannerDataSource] =
    useState<PowerPlannerDataSource | null>(initialStorage.data.powerPlanner)
  const [dataProvenance, setDataProvenance] = useState<DataProvenance>(
    initialStorage.data.provenance,
  )
  const [storageSession, setStorageSession] = useState<StorageSession | null>(
    initialStorage.snapshot?.session ?? null,
  )
  const [expiryMessage, setExpiryMessage] = useState('')
  const [storageCleanupRetryAttempt, setStorageCleanupRetryAttempt] = useState<
    number | null
  >(null)

  const applySnapshot = useCallback((snapshot: StorageSnapshot) => {
    setStorageSession(snapshot.session)
    setBills(snapshot.data.bills)
    setProfile(snapshot.data.profile)
    setScenario(snapshot.data.scenario)
    setRatePlans(snapshot.data.ratePlans)
    setCalculationSettings(snapshot.data.calculationSettings)
    setPowerPlannerDataSource(snapshot.data.powerPlanner)
    setDataProvenance(snapshot.data.provenance)
    setExpiryMessage('')
  }, [])

  const resetInMemoryToSamples = useCallback((message = '') => {
    const defaults = defaultStorageData()
    setStorageSession(null)
    setBills(defaults.bills)
    setProfile(defaults.profile)
    setScenario(defaults.scenario)
    setRatePlans(defaults.ratePlans)
    setCalculationSettings(defaults.calculationSettings)
    setPowerPlannerDataSource(defaults.powerPlanner)
    setDataProvenance(defaults.provenance)
    setActiveView('dashboard')
    setExpiryMessage(message)
  }, [])

  useEffect(() => {
    let cancelled = false
    void initializeStorageAfterMount(defaultStorageData())
      .then((initialized) => {
        if (cancelled) return
        if (getPendingStorageCleanupKeys().length) {
          setStorageCleanupRetryAttempt(0)
        }
        if (initialized) {
          applySnapshot(initialized)
          return
        }
        if (initialStorage.snapshot) {
          resetInMemoryToSamples(
            '저장 데이터가 만료되었거나 손상되어 시연 샘플로 전환했습니다.',
          )
        }
      })
      .catch(() => {
        if (!cancelled) setExpiryMessage(storageFailureMessage)
      })
    return () => {
      cancelled = true
    }
  }, [
    applySnapshot,
    initialStorage.snapshot,
    resetInMemoryToSamples,
  ])

  useEffect(() => {
    let timeoutId: number | undefined
    const expireStoredData = async () => {
      try {
        await cleanupExpiredStorageSnapshots()
        const latest = readStorageSnapshot()
        if (latest) {
          applySnapshot(latest)
        } else if (storageSession) {
          resetInMemoryToSamples('24시간이 지나 시연 데이터가 삭제되었습니다.')
        }
      } catch {
        setExpiryMessage(storageFailureMessage)
      }
    }
    const scheduleExpiry = () => {
      const nextExpiry = getNextStorageExpiry()
      if (nextExpiry === null) return
      const remainingMs = nextExpiry - Date.now()
      if (remainingMs <= 0) {
        timeoutId = window.setTimeout(() => {
          void expireStoredData().then(scheduleExpiry)
        }, orphanCleanupRetryDelaysMs[0])
        return
      }
      timeoutId = window.setTimeout(
        () => {
          void expireStoredData().then(scheduleExpiry)
        },
        Math.min(remainingMs, maxBrowserTimeoutMs),
      )
    }

    scheduleExpiry()
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [applySnapshot, resetInMemoryToSamples, storageSession])

  useEffect(() => {
    if (storageCleanupRetryAttempt === null) return
    const delay =
      orphanCleanupRetryDelaysMs[
        Math.min(
          storageCleanupRetryAttempt,
          orphanCleanupRetryDelaysMs.length - 1,
        )
      ]
    const timeoutId = window.setTimeout(() => {
      void cleanupExpiredStorageSnapshots()
        .then(() => {
          if (!getPendingStorageCleanupKeys().length) {
            setStorageCleanupRetryAttempt(null)
            return
          }
          setStorageCleanupRetryAttempt((attempt) =>
            attempt === null ? 0 : attempt + 1,
          )
        })
        .catch(() => {
          setStorageCleanupRetryAttempt((attempt) =>
            attempt === null ? 0 : attempt + 1,
          )
          setExpiryMessage(storageFailureMessage)
        })
    }, delay)
    return () => window.clearTimeout(timeoutId)
  }, [storageCleanupRetryAttempt])

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | undefined
    const schedulePhysicalExpiry = () => {
      const nextExpiry = getNextStorageSnapshotExpiry()
      if (nextExpiry === null) return
      const remainingMs = nextExpiry - Date.now()
      timeoutId = window.setTimeout(
        () => {
          void cleanupExpiredStorageSnapshots()
            .then(() => {
              if (cancelled) return
              if (getPendingStorageCleanupKeys().length) {
                setStorageCleanupRetryAttempt((attempt) => attempt ?? 0)
                return
              }
              schedulePhysicalExpiry()
            })
            .catch(() => {
              if (cancelled) return
              setStorageCleanupRetryAttempt((attempt) => attempt ?? 0)
              setExpiryMessage(storageFailureMessage)
            })
        },
        Math.min(
          remainingMs <= 0
            ? orphanCleanupRetryDelaysMs[0]
            : remainingMs,
          maxBrowserTimeoutMs,
        ),
      )
    }
    schedulePhysicalExpiry()
    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [storageSession])

  useEffect(() => {
    const adoptCurrentSnapshot = (missingMessage: string) => {
      const latest = readStorageSnapshot()
      if (latest) {
        applySnapshot(latest)
        return
      }
      if (storageSession) resetInMemoryToSamples(missingMessage)
    }

    const handleStorageSessionChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return
      if (event.key === storageActivePointerKey) {
        adoptCurrentSnapshot(
          '다른 탭에서 저장 데이터가 삭제되어 시연 샘플로 전환했습니다.',
        )
        return
      }
      if (!isSessionSnapshotStorageKey(event.key)) return
      const activeSessionId = readStorageActivePointer()?.sessionId
      if (
        !activeSessionId ||
        event.key !== storageSnapshotKeyFor(activeSessionId)
      ) {
        return
      }
      adoptCurrentSnapshot(
        '다른 탭에서 저장 데이터가 삭제되어 시연 샘플로 전환했습니다.',
      )
    }
    const handleFocus = () => {
      void cleanupExpiredStorageSnapshots()
        .then(() => {
          setStorageCleanupRetryAttempt(
            getPendingStorageCleanupKeys().length ? 0 : null,
          )
          adoptCurrentSnapshot(
            Date.parse(storageSession?.expiresAt ?? '') <= Date.now()
              ? '24시간이 지나 시연 데이터가 삭제되었습니다.'
              : '다른 탭에서 저장 데이터가 삭제되어 시연 샘플로 전환했습니다.',
          )
        })
        .catch(() => setExpiryMessage(storageFailureMessage))
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleFocus()
    }
    window.addEventListener('storage', handleStorageSessionChange)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('storage', handleStorageSessionChange)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [applySnapshot, resetInMemoryToSamples, storageSession])

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
        calculationSettings,
      }),
    [
      bills,
      profile,
      ratePlans,
      scenario,
      powerPlannerDataSource,
      dataProvenance.bills,
      calculationSettings,
    ],
  )
  const currentPlan = diagnosis.currentPlan
  const candidatePlan = diagnosis.recommendedPlan
  const comparison = diagnosis.comparison
  const peakOperationPlan = useMemo(
    () => buildPeakOperationPlan(scenario),
    [scenario],
  )

  const resetSample = async () => {
    if (storageSession) {
      const sessionId = storageSession.sessionId
      const removal = await removeStorageSnapshot(sessionId)
      if (removal.ok && removal.outcome === 'active-deactivated') {
        if (!removal.snapshotRemoved) {
          setStorageCleanupRetryAttempt(0)
          resetInMemoryToSamples(storageOrphanCleanupMessage)
        } else {
          resetInMemoryToSamples()
        }
        return
      }

      if (!removal.ok && removal.outcome === 'orphan-retained') {
        setStorageCleanupRetryAttempt(0)
      }
      const latest = readStorageSnapshot()
      if (latest) {
        applySnapshot(latest)
      } else {
        if (!removal.ok && removal.outcome === 'orphan-retained') {
          resetInMemoryToSamples(storageOrphanCleanupMessage)
          return
        }
        resetInMemoryToSamples()
      }
      if (!removal.ok) {
        if (removal.reason === 'lock-error') {
          setExpiryMessage(storageLockFailureMessage)
        } else {
          setExpiryMessage(storageFailureMessage)
        }
      }
      return
    }
    resetInMemoryToSamples()
  }

  const handleStorageWriteFailure = useCallback((
    result: Exclude<StorageSnapshotWriteResult, { ok: true }>,
  ) => {
    if (
      result.reason === 'storage-error' ||
      result.reason === 'invalid-data'
    ) {
      setExpiryMessage(storageFailureMessage)
      return
    }
    if (result.reason === 'lock-error') {
      setExpiryMessage(storageLockFailureMessage)
      return
    }
    const latest = readStorageSnapshot()
    if (latest) {
      applySnapshot(latest)
      return
    }
    resetInMemoryToSamples(
      result.reason === 'expired'
        ? '24시간이 지나 시연 데이터가 삭제되었습니다.'
        : '다른 탭에서 저장 데이터가 변경되어 시연 샘플로 전환했습니다.',
    )
  }, [applySnapshot, resetInMemoryToSamples])

  const persistControlledPatch = useCallback(async (
    patch: Partial<StorageSnapshotData>,
  ) => {
    if (!storageSession) return true
    const result = await updateStorageSnapshot(storageSession.sessionId, patch)
    if (!result.ok) {
      handleStorageWriteFailure(result)
      return false
    }
    applySnapshot(result.snapshot)
    return true
  }, [applySnapshot, handleStorageWriteFailure, storageSession])

  const changeProfile = async (nextProfile: SchoolProfile) => {
    if (!storageSession) {
      setProfile(nextProfile)
      return true
    }
    return persistControlledPatch({ profile: nextProfile })
  }

  const changeScenario = async (nextScenario: PeakScenario) => {
    if (!storageSession) {
      setScenario(nextScenario)
      return true
    }
    return persistControlledPatch({ scenario: nextScenario })
  }

  const changeRatePlans = async (nextRatePlans: RatePlan[]) => {
    if (!storageSession) {
      setRatePlans(nextRatePlans)
      return true
    }
    return persistControlledPatch({ ratePlans: nextRatePlans })
  }

  const changeCalculationSettings = async (
    nextCalculationSettings: CalculationSettings,
  ) => {
    if (!storageSession) {
      setCalculationSettings(nextCalculationSettings)
      return true
    }
    return persistControlledPatch({
      calculationSettings: nextCalculationSettings,
    })
  }

  const startUploadSession = async (
    nextBills: MonthlyBill[],
    nextPowerPlannerDataSource: PowerPlannerDataSource | null,
    nextProvenance: DataProvenance,
  ) => {
    const result = await startNewStorageSnapshot({
      bills: nextBills,
      profile,
      scenario,
      ratePlans,
      calculationSettings,
      powerPlanner: nextPowerPlannerDataSource,
      provenance: nextProvenance,
    })
    if (!result.ok) {
      handleStorageWriteFailure(result)
      return false
    }
    if (result.cleanupPendingSessionIds?.length) {
      setStorageCleanupRetryAttempt(0)
    }
    applySnapshot(result.snapshot)
    setExpiryMessage('')
    return true
  }

  const applyBillsAndOpenDiagnosis = async (nextBills: MonthlyBill[]) => {
    const nextProvenance: DataProvenance = {
      ...dataProvenance,
      bills: 'uploaded',
    }
    if (!(await startUploadSession(
      nextBills,
      powerPlannerDataSource,
      nextProvenance,
    ))) {
      return false
    }
    setActiveView('diagnosis')
    return true
  }

  const applyPowerPlannerAndOpenDiagnosis = async (
    nextDataSource: PowerPlannerDataSource | null,
    origin: DataProvenance['powerPlanner'],
  ) => {
    const nextProvenance: DataProvenance = {
      ...dataProvenance,
      powerPlanner: origin,
    }
    if (nextDataSource && origin === 'uploaded') {
      if (!(await startUploadSession(bills, nextDataSource, nextProvenance))) {
        return false
      }
    } else {
      if (storageSession) {
        if (!(await persistControlledPatch({
          powerPlanner: nextDataSource,
          provenance: nextProvenance,
        }))) {
          return false
        }
      } else {
        setPowerPlannerDataSource(nextDataSource)
        setDataProvenance(nextProvenance)
      }
    }
    if (nextDataSource) {
      setActiveView('diagnosis')
    }
    return true
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
            onReset={() => {
              void resetSample()
            }}
            expiryMessage={
              expiryMessage ||
              (usesSameTabStorageLockFallback()
                ? storageLockFallbackMessage
                : '')
            }
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

          <ViewErrorBoundary>
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
                  onProfileChange={changeProfile}
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
                    currentPlan={currentPlan}
                    candidatePlan={candidatePlan}
                    candidates={diagnosis.topCandidates}
                    comparison={comparison}
                    calculationSettings={calculationSettings}
                    scenario={scenario}
                    onScenarioChange={changeScenario}
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
                  onScenarioChange={changeScenario}
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
          </ViewErrorBoundary>
          {activeView === 'settings' && (
            <RatePlanSettings
              plans={ratePlans}
              onPlansChange={changeRatePlans}
              calculationSettings={calculationSettings}
              onCalculationSettingsChange={changeCalculationSettings}
            />
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
  onProfileChange: (profile: SchoolProfile) => Promise<boolean>
}

function SchoolProfilePanel({
  profile,
  ratePlans,
  onProfileChange,
}: SchoolProfilePanelProps) {
  const update = (key: keyof SchoolProfile, value: string) => {
    void onProfileChange({
      ...profile,
      [key]: ['contractPowerKw', 'appliedPowerKw'].includes(key)
        ? Number(value)
        : value,
    }).catch(() => undefined)
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
    void onProfileChange({
      ...profile,
      contractType,
      voltageType,
      currentPlan: nextPlan?.planName ?? '',
    }).catch(() => undefined)
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
