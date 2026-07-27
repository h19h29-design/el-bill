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

const requiredMappingFields = ['year', 'month', 'usageKwh', 'totalBillWon'] as const
type RequiredMappingField = typeof requiredMappingFields[number]

const automaticRequiredSynonyms: Record<RequiredMappingField, readonly string[]> = {
  year: ['연도', '년도', '청구연도', '청구년도'],
  month: ['월', '월분', '청구월', '청구월분'],
  usageKwh: ['사용량', '사용량kwh', '전력사용량', '전력사용량kwh'],
  totalBillWon: [
    '총전기요금',
    '총전기요금원',
    '전기요금',
    '전기요금원',
    '청구금액',
    '청구금액원',
    '납부금액',
    '납부금액원',
    '청구요금',
    '청구요금원',
    '납부요금',
    '납부요금원',
  ],
}

const normalizeRequiredHeader = (header: string) =>
  header.toLocaleLowerCase('ko-KR').replace(/[\s()[\]{}_-]/g, '')

const buildAutomaticRequiredMapping = (headers: string[]) =>
  Object.fromEntries(
    requiredMappingFields.map((field) => {
      const matches = headers.filter((header) =>
        automaticRequiredSynonyms[field].includes(normalizeRequiredHeader(header)),
      )
      return [field, matches.length === 1 ? matches[0] : '']
    }),
  ) as Record<RequiredMappingField, string>

const getRequiredMappingCollisions = (mapping: Record<string, string>) => {
  const fieldsByHeader = new Map<string, string[]>()
  requiredMappingFields.forEach((field) => {
    const header = mapping[field]
    if (!header) return
    fieldsByHeader.set(header, [...(fieldsByHeader.get(header) ?? []), field])
  })
  return [...fieldsByHeader.values()].filter((fields) => fields.length > 1)
}

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

  const requiredMappingCollisions = useMemo(
    () => getRequiredMappingCollisions(mapping),
    [mapping],
  )
  const missingRequiredMapping = requiredMappingFields.some((field) => !mapping[field])
  const hasRequiredMapping =
    !missingRequiredMapping &&
    requiredMappingCollisions.length === 0
  const mappingMessage = sheet?.rows.length
    ? requiredMappingCollisions.length > 0
      ? '필수 항목은 서로 다른 컬럼으로 지정해 주세요.'
      : missingRequiredMapping
        ? '필수 컬럼을 지정해 주세요.'
        : ''
    : ''
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
      const nextMapping = {
        ...buildBillColumnMapping(parsed.headers),
        ...buildAutomaticRequiredMapping(parsed.headers),
      }
      const missingRequired = requiredMappingFields.some((field) => !nextMapping[field])
      const hasRequiredCollision = getRequiredMappingCollisions(nextMapping).length > 0
      setSheet(parsed)
      setMapping(nextMapping)
      setShowMapping(missingRequired || hasRequiredCollision)
      setMessage(
        parsed.rows.length
          ? ''
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
        {(message || mappingMessage) && <p className="empty-state" role="status">{message || mappingMessage}</p>}
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
          <div className="paste-sample-scroll">
            <table className="paste-sample-table" aria-label="붙여넣기 행 미리보기">
              <caption>인식한 행 미리보기 (처음 {Math.min(sheet.rows.length, 5)}행)</caption>
              <thead>
                <tr>
                  {sheet.headers.slice(0, 12).map((header) => <th key={header} scope="col">{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, 5).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {sheet.headers.slice(0, 12).map((header) => <td key={header}>{String(row[header] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
