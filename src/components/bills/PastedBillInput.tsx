import { useEffect, useMemo, useState } from 'react'
import type { BillImportContext } from '../../types'
import { mapRowsToBills } from '../../lib/excel'
import {
  buildBillColumnMapping,
  parsePastedBillSheet,
} from '../../lib/billInput'
import { validateBillPeriods } from '../../lib/billPeriods'
import type { BillInputCandidate } from './BillInputPreview'

export interface PersonalBillInputProps {
  importContext?: BillImportContext
  onCandidateChange: (candidate: BillInputCandidate | null) => void
  onOpenGuide: (sectionId: string) => void
}

const maximumPasteCharacters = 200_000

const mappingFields = [
  ['year', '연도', true],
  ['month', '월', true],
  ['usageKwh', '사용량', true],
  ['totalBillWon', '총 전기요금', true],
  ['appliedPowerKw', '요금적용전력', false],
  ['maxDemandKw', '최대수요전력', false],
  ['baseChargeWon', '기본요금', false],
  ['energyChargeWon', '전력량요금', false],
  ['powerFactorChargeWon', '역률요금', false],
  ['climateChargeWon', '기후환경요금', false],
  ['fuelAdjustmentWon', '연료비조정액', false],
  ['vatWon', '부가세', false],
  ['fundWon', '전력산업기반기금', false],
  ['note', '메모', false],
] as const

const requiredMappingFields = ['year', 'month', 'usageKwh', 'totalBillWon']

export function PastedBillInput({
  importContext,
  onCandidateChange,
  onOpenGuide,
}: PersonalBillInputProps) {
  const [text, setText] = useState('')
  const [sheet, setSheet] = useState<ReturnType<typeof parsePastedBillSheet> | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [showMapping, setShowMapping] = useState(false)

  const hasRequiredMapping = requiredMappingFields.every((field) => mapping[field])
  const pendingBills = useMemo(
    () => sheet && hasRequiredMapping
      ? mapRowsToBills(sheet.rows, mapping, importContext)
      : [],
    [hasRequiredMapping, importContext, mapping, sheet],
  )
  const periodValidation = useMemo(
    () => validateBillPeriods(pendingBills),
    [pendingBills],
  )
  const isValidCandidate = Boolean(
    sheet &&
      sheet.rows.length > 0 &&
      hasRequiredMapping &&
      pendingBills.length === sheet.rows.length &&
      periodValidation.issues.length === 0,
  )

  useEffect(() => {
    onCandidateChange(
      isValidCandidate
        ? {
            origin: 'pasted',
            bills: periodValidation.normalizedBills,
            sourceLabel: '붙여넣은 표',
          }
        : null,
    )
  }, [isValidCandidate, onCandidateChange, periodValidation.normalizedBills])

  const inspectPaste = () => {
    if (text.length > maximumPasteCharacters) {
      setSheet(null)
      setMapping({})
      setShowMapping(false)
      setMessage('붙여넣기 내용은 200,000자 이하로 입력해 주세요.')
      return
    }

    try {
      const parsed = parsePastedBillSheet(text)
      const nextMapping = buildBillColumnMapping(parsed.headers)
      const missingRequired = requiredMappingFields.some((field) => !nextMapping[field])
      setSheet(parsed)
      setMapping(nextMapping)
      setShowMapping(missingRequired)
      setMessage(
        parsed.rows.length
          ? missingRequired
            ? '필수 컬럼을 지정해 주세요.'
            : ''
          : '헤더 다음에 인식할 고지서 행을 입력해 주세요.',
      )
    } catch (error) {
      setSheet(null)
      setMapping({})
      setShowMapping(false)
      setMessage(
        error instanceof Error
          ? error.message
          : '붙여넣은 표를 읽지 못했습니다. 열 구분과 내용을 확인해 주세요.',
      )
    }
  }

  const changeText = (value: string) => {
    setText(value)
    if (!sheet) return
    setSheet(null)
    setMapping({})
    setShowMapping(false)
    setMessage('')
  }

  return (
    <div className="input-mode-shell">
      <section className="panel pasted-bill-panel">
        <div className="panel-title">
          <div>
            <h2>표 붙여넣기</h2>
            <p>Excel, Numbers, Google Sheets 표 또는 CSV를 바로 붙여넣을 수 있습니다.</p>
          </div>
          <button type="button" className="text-action" onClick={() => onOpenGuide('paste-input')}>
            입력 안내
          </button>
        </div>
        <label className="wide-field">
          붙여넣을 표
          <textarea
            value={text}
            onChange={(event) => changeText(event.target.value)}
            placeholder={'연도\t월\t사용량(kWh)\t총 전기요금(원)'}
            aria-describedby="paste-input-limit"
          />
        </label>
        <p id="paste-input-limit" className="field-hint">최대 200,000자, 최대 36행까지 확인합니다.</p>
        <div className="manual-grid-actions">
          <button type="button" className="primary-button" onClick={inspectPaste}>붙여넣은 표 확인</button>
          <button
            type="button"
            className="outline-action"
            onClick={() => {
              setText('')
              setSheet(null)
              setMapping({})
              setShowMapping(false)
              setMessage('')
            }}
          >
            내용 지우기
          </button>
        </div>
        {isValidCandidate && <p className="status-line">{pendingBills.length}개월을 인식했습니다.</p>}
        {message && <p className="empty-state" role="status">{message}</p>}
        {sheet && !isValidCandidate && hasRequiredMapping && pendingBills.length !== sheet.rows.length && (
          <p className="empty-state" role="status">필수 값이 비어 있거나 올바르지 않은 행이 있습니다. 모든 행을 보완해 주세요.</p>
        )}
        {sheet && periodValidation.issues.length > 0 && (
          <ul className="diagnostics-list">
            {periodValidation.issues.map((issue) => <li key={`${issue.code}-${issue.period}`}>{issue.message}</li>)}
          </ul>
        )}
      </section>

      {sheet && (
        <section className="panel paste-recognition-panel">
          <div className="panel-title">
            <h2>붙여넣기 인식 결과</h2>
            <span>{sheet.rows.length}행</span>
          </div>
          <p className="field-hint">인식한 헤더: {sheet.headers.join(', ') || '없음'}</p>
          <button type="button" className="outline-action" onClick={() => setShowMapping((current) => !current)}>
            컬럼 매핑 {showMapping ? '접기' : '수정'}
          </button>
        </section>
      )}

      {sheet && showMapping && (
        <section className="panel">
          <div className="panel-title"><h2>컬럼 매핑</h2><span>필수 항목을 직접 지정할 수 있습니다.</span></div>
          <div className="mapping-grid">
            {mappingFields.map(([field, label, required]) => (
              <label key={field}>
                {label}{required && <span className="required-dot">필수</span>}
                <select
                  aria-label={label}
                  value={mapping[field] ?? ''}
                  onChange={(event) => setMapping((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))}
                >
                  <option value="">미사용</option>
                  {sheet.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
