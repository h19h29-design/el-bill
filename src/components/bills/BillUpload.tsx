import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ClipboardPaste, FileUp, PenLine } from 'lucide-react'
import { findExactRatePlan } from '../../lib/diagnosis'
import type { BillDataOrigin, MonthlyBill, RatePlan, SchoolProfile } from '../../types'
import { BillInputPreview, type BillInputCandidate } from './BillInputPreview'
import { FileBillInput } from './FileBillInput'

export type BillInputMode = 'file' | 'paste' | 'manual'
export type { BillInputCandidate } from './BillInputPreview'

interface BillUploadProps {
  bills: MonthlyBill[]
  profile: SchoolProfile
  ratePlans: RatePlan[]
  onBillsChange: (
    bills: MonthlyBill[],
    origin: Exclude<BillDataOrigin, 'sample'>,
  ) => Promise<boolean>
  onOpenGuide: (sectionId: string) => void
}

const modes: Array<{ id: BillInputMode; label: string; Icon: typeof FileUp }> = [
  { id: 'file', label: '파일 업로드', Icon: FileUp },
  { id: 'paste', label: '표 붙여넣기', Icon: ClipboardPaste },
  { id: 'manual', label: '직접 입력', Icon: PenLine },
]

const storageFailureMessage =
  '브라우저 저장소에 자료를 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요.'

export function BillUpload({
  bills,
  profile,
  ratePlans,
  onBillsChange,
}: BillUploadProps) {
  const [activeMode, setActiveMode] = useState<BillInputMode>('file')
  const [candidate, setCandidate] = useState<BillInputCandidate | null>(null)
  const [message, setMessage] = useState('')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const hasExactRatePlan = useMemo(
    () => Boolean(findExactRatePlan(profile, ratePlans)),
    [profile, ratePlans],
  )

  const selectMode = (mode: BillInputMode, focus = false) => {
    setActiveMode(mode)
    if (focus) tabRefs.current[modes.findIndex((item) => item.id === mode)]?.focus()
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = (index + modes.length - 1) % modes.length
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % modes.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = modes.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    selectMode(modes[nextIndex].id, true)
  }

  const handleCandidateChange = useCallback((nextCandidate: BillInputCandidate | null) => {
    setCandidate(nextCandidate)
    setMessage('')
  }, [])

  const handleConfirm = async (nextCandidate: BillInputCandidate) => {
    let saved = false
    try {
      saved = await onBillsChange(nextCandidate.bills, nextCandidate.origin)
    } catch {
      saved = false
    }
    if (!saved) setMessage(storageFailureMessage)
  }

  return (
    <div className="view-stack">
      <section className="form-grid four">
        <label>학교명<input value={profile.displaySchoolName} readOnly /></label>
        <label>계약종별<input value={profile.contractType} readOnly /></label>
        <label>수전전압<input value={profile.voltageType} readOnly /></label>
        <label>현재 요금제<input value={profile.currentPlan} readOnly /></label>
      </section>

      <div className="bill-input-tabs" role="tablist" aria-label="고지서 입력 방식">
        {modes.map(({ id, label, Icon }, index) => (
          <button
            key={id}
            ref={(element) => { tabRefs.current[index] = element }}
            id={`bill-input-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeMode === id}
            aria-controls={`bill-input-panel-${id}`}
            tabIndex={activeMode === id ? 0 : -1}
            className={activeMode === id ? 'active' : ''}
            onClick={() => selectMode(id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <section
        id="bill-input-panel-file"
        role="tabpanel"
        aria-labelledby="bill-input-tab-file"
        aria-label="파일 업로드"
        hidden={activeMode !== 'file'}
      >
        <FileBillInput
          profile={profile}
          ratePlans={ratePlans}
          onCandidateChange={handleCandidateChange}
          onApplyCandidate={handleConfirm}
        />
      </section>
      <section
        id="bill-input-panel-paste"
        role="tabpanel"
        aria-labelledby="bill-input-tab-paste"
        aria-label="표 붙여넣기"
        hidden={activeMode !== 'paste'}
      >
        <section className="panel input-mode-shell">
          <h2>표 붙여넣기</h2>
        </section>
      </section>
      <section
        id="bill-input-panel-manual"
        role="tabpanel"
        aria-labelledby="bill-input-tab-manual"
        aria-label="직접 입력"
        hidden={activeMode !== 'manual'}
      >
        <section className="panel input-mode-shell">
          <h2>직접 입력</h2>
        </section>
      </section>

      <BillInputPreview
        candidate={candidate}
        currentBills={bills}
        hasExactRatePlan={hasExactRatePlan}
        onConfirm={handleConfirm}
        message={message}
      />
    </div>
  )
}
