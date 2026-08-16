import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, UploadCloud } from 'lucide-react'
import type { BillInputCandidate } from '../bills/BillInputPreview'
import { AiBillConversionHelper } from '../bills/AiBillConversionHelper'
import type {
  BillImportContext,
  RatePlan,
  SchoolProfile,
} from '../../types'
import type { EasyDiagnosisSource } from '../../lib/easyDiagnosis'
import { findExactRatePlan } from '../../lib/diagnosis'
import {
  buildBillColumnMapping,
  createManualBillRows,
  parsePastedBillSheet,
  type ManualBillDraftRow,
  validateManualBillRows,
} from '../../lib/billInput'
import { mapRowsToBills, parseWorkbook, validateUploadFile } from '../../lib/excel'
import { parseBillPdfFiles } from '../../lib/billPdf'

interface EasyDiagnosisImportStepProps {
  source: EasyDiagnosisSource
  profile: SchoolProfile
  ratePlans: RatePlan[]
  candidate: BillInputCandidate | null
  onCandidateChange: (candidate: BillInputCandidate | null) => void
  onSourceChange: (source: EasyDiagnosisSource) => void
  onBack: () => void
  onContinue: () => void
}

const sourceTitles: Record<EasyDiagnosisSource, string> = {
  pdf: '고지서 PDF 12개월분을 선택하세요',
  table: '12개월 요금 정리표를 선택하세요',
  paste: '12개월 표를 붙여넣으세요',
  manual: '12개월 사용량과 요금을 입력하세요',
}

const latestYearMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const updateManualRow = (
  rows: ManualBillDraftRow[],
  rowId: string,
  field: 'yearMonth' | 'usageKwh' | 'totalBillWon',
  value: string,
) => rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row))

export function EasyDiagnosisImportStep({
  source,
  profile,
  ratePlans,
  candidate,
  onCandidateChange,
  onSourceChange,
  onBack,
  onContinue,
}: EasyDiagnosisImportStepProps) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [manualRows, setManualRows] = useState(() =>
    createManualBillRows(latestYearMonth(), 12),
  )
  const exactPlan = useMemo(
    () => findExactRatePlan(profile, ratePlans),
    [profile, ratePlans],
  )
  const context: BillImportContext | undefined = exactPlan
    ? { appliedPowerKw: profile.appliedPowerKw, currentPlan: exactPlan }
    : undefined

  const setRecognizedCandidate = (
    nextCandidate: BillInputCandidate | null,
    successMessage: string,
  ) => {
    onCandidateChange(nextCandidate)
    setMessage(nextCandidate ? successMessage : '자료에서 월별 사용량과 총 전기요금을 찾지 못했습니다.')
  }

  const readPdfFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setMessage('PDF를 브라우저에서 읽고 있습니다.')
    try {
      const result = await parseBillPdfFiles(files, context)
      setRecognizedCandidate(
        result.autoRows.length
          ? {
              origin: 'uploaded',
              bills: result.autoRows,
              sourceLabel: files.length === 1 ? files[0].name : `고지서 PDF ${files.length}개`,
            }
          : null,
        `${result.autoRows.length}개월을 인식했습니다. 다음 화면에서 월별 값을 확인하세요.`,
      )
    } catch (error) {
      onCandidateChange(null)
      setMessage(error instanceof Error ? error.message : 'PDF를 읽지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const readTableFile = async (file?: File) => {
    if (!file) return
    const validationMessage = validateUploadFile(file)
    if (validationMessage) {
      onCandidateChange(null)
      setMessage(validationMessage)
      return
    }
    setBusy(true)
    setMessage('요금 정리표를 브라우저에서 읽고 있습니다.')
    try {
      const result = await parseWorkbook(file, context)
      const firstSheet = result.sheets[0]
      const bills = result.autoRows.length
        ? result.autoRows
        : firstSheet
          ? mapRowsToBills(
              firstSheet.rows,
              buildBillColumnMapping(firstSheet.headers),
              context,
            )
          : []
      setRecognizedCandidate(
        bills.length
          ? { origin: 'uploaded', bills, sourceLabel: file.name }
          : null,
        `${bills.length}개월을 인식했습니다. 다음 화면에서 월별 값을 확인하세요.`,
      )
    } catch (error) {
      onCandidateChange(null)
      setMessage(error instanceof Error ? error.message : '요금 정리표를 읽지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const inspectPaste = () => {
    try {
      const sheet = parsePastedBillSheet(pasteText)
      const mapping = buildBillColumnMapping(sheet.headers)
      const bills = mapRowsToBills(sheet.rows, mapping, context)
      setRecognizedCandidate(
        bills.length === sheet.rows.length && bills.length > 0
          ? { origin: 'pasted', bills, sourceLabel: '붙여넣은 12개월 표' }
          : null,
        `${bills.length}개월을 인식했습니다. 다음 화면에서 월별 값을 확인하세요.`,
      )
    } catch (error) {
      onCandidateChange(null)
      setMessage(error instanceof Error ? error.message : '붙여넣은 표를 읽지 못했습니다.')
    }
  }

  const inspectManual = () => {
    const result = validateManualBillRows(manualRows, context)
    if (result.issues.length) {
      onCandidateChange(null)
      setMessage(result.issues[0].message)
      return
    }
    setRecognizedCandidate(
      { origin: 'manual', bills: result.bills, sourceLabel: '직접 입력한 12개월 자료' },
      '12개월 입력값을 확인했습니다. 다음 화면에서 한 번 더 검토하세요.',
    )
  }

  return (
    <div className="view-stack">
      <section className="easy-diagnosis-page" aria-labelledby="easy-import-title">
        <div className="easy-diagnosis-page-heading">
          <span>2단계</span>
          <h2 id="easy-import-title">{sourceTitles[source]}</h2>
          <p>사용량과 총 전기요금이 있는 연속 12개월 자료면 됩니다.</p>
        </div>

        {source === 'pdf' && (
          <label className="easy-file-picker">
            <UploadCloud size={28} aria-hidden="true" />
            <strong>12개월 고지서 PDF 선택</strong>
            <span>여러 PDF를 한 번에 선택할 수 있습니다.</span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple
              aria-label="12개월 고지서 PDF 선택"
              onChange={(event) => void readPdfFiles(Array.from(event.currentTarget.files ?? []))}
            />
          </label>
        )}

        {source === 'table' && (
          <label className="easy-file-picker">
            <UploadCloud size={28} aria-hidden="true" />
            <strong>12개월 요금 정리표 선택</strong>
            <span>XLSX, XLS, CSV 파일 한 개를 선택하세요.</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              aria-label="12개월 요금 정리표 선택"
              onChange={(event) => void readTableFile(event.currentTarget.files?.[0])}
            />
          </label>
        )}

        {source === 'paste' && (
          <div className="easy-paste-input">
            <label htmlFor="easy-paste-table">12개월 표 붙여넣기</label>
            <textarea
              id="easy-paste-table"
              value={pasteText}
              placeholder={'연도\t월\t사용량(kWh)\t총 전기요금(원)'}
              onChange={(event) => {
                setPasteText(event.target.value)
                onCandidateChange(null)
                setMessage('')
              }}
            />
            <button type="button" className="primary-button" onClick={inspectPaste}>
              붙여넣은 표 확인
            </button>
          </div>
        )}

        {source === 'manual' && (
          <div className="easy-manual-wrap">
            <p>금액의 쉼표는 입력하지 않아도 됩니다.</p>
            <div className="easy-manual-table-scroll">
              <table className="easy-manual-table">
                <thead>
                  <tr><th>연월</th><th>사용량(kWh)</th><th>총 전기요금(원)</th></tr>
                </thead>
                <tbody>
                  {manualRows.map((row, index) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="month"
                          value={row.yearMonth}
                          aria-label={`${index + 1}행 연월`}
                          onChange={(event) => {
                            setManualRows((current) => updateManualRow(current, row.id, 'yearMonth', event.target.value))
                            onCandidateChange(null)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          inputMode="decimal"
                          value={row.usageKwh}
                          aria-label={`${index + 1}행 사용량`}
                          onChange={(event) => {
                            setManualRows((current) => updateManualRow(current, row.id, 'usageKwh', event.target.value))
                            onCandidateChange(null)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          inputMode="numeric"
                          value={row.totalBillWon}
                          aria-label={`${index + 1}행 총 전기요금`}
                          onChange={(event) => {
                            setManualRows((current) => updateManualRow(current, row.id, 'totalBillWon', event.target.value))
                            onCandidateChange(null)
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="primary-button" onClick={inspectManual}>
              직접 입력한 내용 확인
            </button>
          </div>
        )}

        {message && <p className={candidate ? 'status-line' : 'empty-state'} role="status">{message}</p>}
        <div className="easy-page-actions">
          <button type="button" className="outline-action" onClick={onBack}>
            <ArrowLeft size={17} /> 자료 종류 다시 선택
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!candidate || busy}
            onClick={onContinue}
          >
            자료 확인으로 이동 <ArrowRight size={17} />
          </button>
        </div>
      </section>

      {(source === 'pdf' || source === 'table') && !candidate && (
        <AiBillConversionHelper onOpenPaste={() => onSourceChange('paste')} />
      )}
    </div>
  )
}
