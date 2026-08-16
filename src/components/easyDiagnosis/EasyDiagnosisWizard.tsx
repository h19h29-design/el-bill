import { useEffect, useMemo, useRef, useState } from 'react'
import type { BillInputCandidate } from '../bills/BillInputPreview'
import type {
  AutoDiagnosisResult,
  DataProvenance,
  RatePlan,
  SchoolProfile,
  ViewKey,
} from '../../types'
import {
  buildEasyDiagnosisReview,
  getEasyDiagnosisProfileIssue,
  prepareEasyDiagnosisCandidate,
  type EasyDiagnosisSource,
  type EasyDiagnosisStep,
} from '../../lib/easyDiagnosis'
import { hasObservedBillField } from '../../types'
import { EasyDiagnosisSourceStep } from './EasyDiagnosisSourceStep'
import { EasyDiagnosisImportStep } from './EasyDiagnosisImportStep'
import { EasyDiagnosisReviewStep } from './EasyDiagnosisReviewStep'
import { EasyDiagnosisProfileStep } from './EasyDiagnosisProfileStep'
import { EasyDiagnosisResultStep } from './EasyDiagnosisResultStep'

export interface EasyDiagnosisApplyInput {
  candidate: BillInputCandidate
  profile: SchoolProfile
}

interface EasyDiagnosisWizardProps {
  profile: SchoolProfile
  ratePlans: RatePlan[]
  diagnosis: AutoDiagnosisResult
  dataProvenance: DataProvenance
  onApply: (input: EasyDiagnosisApplyInput) => Promise<boolean>
  onNavigate: (view: ViewKey) => void
}

const steps: Array<{ id: EasyDiagnosisStep; label: string }> = [
  { id: 'source', label: '자료 선택' },
  { id: 'import', label: '자료 넣기' },
  { id: 'review', label: '12개월 확인' },
  { id: 'profile', label: '계약정보' },
  { id: 'result', label: '진단 결과' },
]

const stepTitleIds: Record<EasyDiagnosisStep, string> = {
  source: 'easy-source-title',
  import: 'easy-import-title',
  review: 'easy-review-title',
  profile: 'easy-profile-title',
  result: 'easy-result-title',
}

export function EasyDiagnosisWizard({
  profile,
  ratePlans,
  diagnosis,
  dataProvenance,
  onApply,
  onNavigate,
}: EasyDiagnosisWizardProps) {
  const [step, setStep] = useState<EasyDiagnosisStep>('source')
  const [source, setSource] = useState<EasyDiagnosisSource>('pdf')
  const [candidate, setCandidate] = useState<BillInputCandidate | null>(null)
  const [profileDraft, setProfileDraft] = useState(profile)
  const [saving, setSaving] = useState(false)
  const [applyMessage, setApplyMessage] = useState('')
  const didMount = useRef(false)
  const review = useMemo(() => buildEasyDiagnosisReview(candidate), [candidate])
  const profileIssue = useMemo(
    () => getEasyDiagnosisProfileIssue(profileDraft, ratePlans),
    [profileDraft, ratePlans],
  )
  const currentStepIndex = steps.findIndex((item) => item.id === step)

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }
    document.getElementById(stepTitleIds[step])?.focus({ preventScroll: true })
  }, [step])

  const selectSource = (nextSource: EasyDiagnosisSource) => {
    setSource(nextSource)
    setCandidate(null)
    setStep('import')
  }

  const goToProfile = () => {
    const observedAppliedPower = review.bills
      .filter((bill) => hasObservedBillField(bill, 'appliedPowerKw') && bill.appliedPowerKw > 0)
      .at(-1)?.appliedPowerKw
    if (observedAppliedPower) {
      setProfileDraft((current) => ({ ...current, appliedPowerKw: observedAppliedPower }))
    }
    setStep('profile')
  }

  const analyze = async () => {
    if (!candidate || profileIssue) return
    const preparedCandidate = prepareEasyDiagnosisCandidate(candidate, profileDraft)
    if (!preparedCandidate) {
      setApplyMessage('연속 12개월 자료를 다시 확인해 주세요.')
      setStep('review')
      return
    }
    setSaving(true)
    setApplyMessage('')
    try {
      const applied = await onApply({ candidate: preparedCandidate, profile: profileDraft })
      if (applied) setStep('result')
      else setApplyMessage('자료를 적용하지 못했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.')
    } catch {
      setApplyMessage('자료를 적용하지 못했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  const restart = () => {
    setStep('source')
    setCandidate(null)
    setProfileDraft(profile)
    setApplyMessage('')
  }

  return (
    <div className="easy-diagnosis-shell">
      <nav className="easy-diagnosis-progress" aria-label="쉬운 진단 단계">
        {steps.map((item, index) => (
          <div
            key={item.id}
            className={index < currentStepIndex ? 'complete' : index === currentStepIndex ? 'current' : ''}
            aria-current={index === currentStepIndex ? 'step' : undefined}
            aria-label={`${item.label} ${index < currentStepIndex ? '완료' : index === currentStepIndex ? '진행 중' : '대기'}`}
          >
            <strong>{index + 1}</strong>
            <span>{item.label}</span>
            <small>{index < currentStepIndex ? '완료' : index === currentStepIndex ? '진행 중' : '대기'}</small>
          </div>
        ))}
      </nav>

      {step === 'source' && <EasyDiagnosisSourceStep onSelect={selectSource} />}
      {step === 'import' && (
        <EasyDiagnosisImportStep
          source={source}
          profile={profileDraft}
          ratePlans={ratePlans}
          candidate={candidate}
          onCandidateChange={setCandidate}
          onSourceChange={selectSource}
          onBack={() => setStep('source')}
          onContinue={() => setStep('review')}
        />
      )}
      {step === 'review' && (
        <EasyDiagnosisReviewStep
          review={review}
          onBack={() => setStep('import')}
          onContinue={goToProfile}
        />
      )}
      {step === 'profile' && (
        <EasyDiagnosisProfileStep
          profile={profileDraft}
          ratePlans={ratePlans}
          issue={profileIssue}
          saving={saving}
          onChange={setProfileDraft}
          onBack={() => setStep('review')}
          onAnalyze={() => void analyze()}
        />
      )}
      {step === 'profile' && applyMessage && <p className="empty-state" role="status">{applyMessage}</p>}
      {step === 'result' && (
        <EasyDiagnosisResultStep
          diagnosis={diagnosis}
          dataProvenance={dataProvenance}
          onNavigate={onNavigate}
          onReviseData={() => {
            setApplyMessage('')
            setStep('import')
          }}
          onRestart={restart}
        />
      )}
    </div>
  )
}
