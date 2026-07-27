import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { FileDown, FileSpreadsheet, UploadCloud } from 'lucide-react'
import type { BillImportContext, RatePlan, SchoolProfile } from '../../types'
import {
  mapRowsToBills,
  parseWorkbook,
  validateUploadFile,
  type ParsedSheet,
  type WorkbookParseResult,
} from '../../lib/excel'
import {
  chooseNewestSupportedFile,
  supportsDirectoryPicker,
} from '../../lib/localDirectoryImport'
import { buildBillColumnMapping } from '../../lib/billInput'
import { validateBillPeriods } from '../../lib/billPeriods'
import { findExactRatePlan, summarizeWorkbookRecognition } from '../../lib/diagnosis'
import type { BillInputCandidate } from './BillInputPreview'

interface FileBillInputProps {
  profile: SchoolProfile
  ratePlans: RatePlan[]
  onCandidateChange: (candidate: BillInputCandidate | null) => void
  onApplyCandidate?: (candidate: BillInputCandidate) => Promise<void> | void
}

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

export function FileBillInput({
  profile,
  ratePlans,
  onCandidateChange,
  onApplyCandidate,
}: FileBillInputProps) {
  const [parseResult, setParseResult] = useState<WorkbookParseResult | null>(null)
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [showManualMapping, setShowManualMapping] = useState(false)
  const [sourceLabel, setSourceLabel] = useState('')
  const canChooseDirectory = supportsDirectoryPicker()

  const selectedSheet: ParsedSheet | undefined = useMemo(
    () =>
      parseResult?.sheets.find((sheet) => sheet.name === selectedSheetName) ??
      parseResult?.sheets[0],
    [parseResult, selectedSheetName],
  )
  const exactCurrentPlan = useMemo(
    () => findExactRatePlan(profile, ratePlans),
    [profile, ratePlans],
  )
  const importContext: BillImportContext | undefined = useMemo(
    () => exactCurrentPlan
      ? { appliedPowerKw: profile.appliedPowerKw, currentPlan: exactCurrentPlan }
      : undefined,
    [exactCurrentPlan, profile.appliedPowerKw],
  )
  const recognition = useMemo(
    () => summarizeWorkbookRecognition(parseResult, mapping),
    [parseResult, mapping],
  )
  const pendingBills = useMemo(() => {
    if (!parseResult) return []
    if (parseResult.autoRows.length) return parseResult.autoRows
    return selectedSheet
      ? mapRowsToBills(selectedSheet.rows, mapping, importContext)
      : []
  }, [importContext, mapping, parseResult, selectedSheet])
  const hasPeriodIssues = useMemo(
    () => validateBillPeriods(pendingBills).issues.length > 0,
    [pendingBills],
  )

  useEffect(() => {
    onCandidateChange(
      parseResult && pendingBills.length
        ? { origin: 'uploaded', bills: pendingBills, sourceLabel }
        : null,
    )
  }, [onCandidateChange, parseResult, pendingBills, sourceLabel])

  const handleFile = async (file: File) => {
    const validationMessage = validateUploadFile(file)
    if (validationMessage) {
      setParseResult(null)
      setSourceLabel('')
      setMessage(validationMessage)
      return
    }

    try {
      const result = await parseWorkbook(file, importContext)
      setParseResult(result)
      setSourceLabel(file.name)
      setSelectedSheetName(result.sheets[0]?.name ?? '')
      setShowManualMapping(false)
      setMapping(buildBillColumnMapping(result.sheets[0]?.headers ?? []))
      setMessage(
        importContext
          ? '파일을 읽었습니다. 새 파일 미리보기와 자동 인식 결과를 확인한 뒤 분석을 시작해 주세요.'
          : '현재 요금제가 설정과 정확히 일치하지 않습니다. 설정에서 계약종별, 수전전압, 현재 요금제를 확인한 뒤 요금 추정을 진행하세요. 원본 필수 컬럼은 확인할 수 있습니다.',
      )
    } catch (error) {
      setParseResult(null)
      setSourceLabel('')
      setMessage(
        error instanceof Error
          ? error.message
          : '파일을 분석하지 못했습니다. 파일 형식과 내용을 확인해 주세요.',
      )
    }
  }

  const handleDrop = (
    event: DragEvent<HTMLLabelElement>,
    handler: (file: File) => void,
  ) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) handler(file)
  }

  const openNestedFileInput = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.currentTarget.querySelector('input')?.click()
  }

  const handleNewestDirectoryFile = async () => {
    const result = await chooseNewestSupportedFile()
    if (result.ok) {
      await handleFile(result.file)
      return
    }
    if (result.reason === 'cancelled' || result.reason === 'unsupported') return
    setMessage(
      result.reason === 'no-supported-file'
        ? '다운로드 폴더에서 분석할 수 있는 XLSX, CSV, 또는 파워플래너 HTML XLS 파일을 찾지 못했습니다.'
        : '다운로드 폴더의 파일을 읽지 못했습니다. 일반 파일 선택으로 다시 시도해 주세요.',
    )
  }

  const applyMapping = () => {
    if (!selectedSheet) return
    if (!importContext) {
      setMessage(
        '현재 요금제가 설정과 정확히 일치하지 않아 분석을 시작할 수 없습니다. 설정에서 계약종별, 수전전압, 현재 요금제를 확인해 주세요.',
      )
      return
    }
    const mapped = mapRowsToBills(selectedSheet.rows, mapping, importContext)
    if (!mapped.length) {
      setMessage(
        '유효한 필수 매핑 결과가 없습니다. 연도와 월을 확인해 주세요. 사용량은 0보다 큰 값, 총 전기요금도 0보다 큰 값으로 직접 지정해야 합니다.',
      )
      return
    }
    setMessage(`${mapped.length.toLocaleString('ko-KR')}건을 매핑해 미리보기에 반영했습니다.`)
  }

  return (
    <div className="view-stack">
      <section className="panel upload-panel">
        <div>
          <h2>고지서 업로드</h2>
          <p>최근 3년 자료 업로드 가능. 첨부 엑셀처럼 연도별 시트가 나뉜 경우 자동 병합을 시도합니다.</p>
        </div>
        <div className="upload-actions">
          <label
            className="upload-drop"
            role="button"
            tabIndex={0}
            aria-label="엑셀 파일 선택 또는 드롭"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, (file) => void handleFile(file))}
            onKeyDown={openNestedFileInput}
          >
            <UploadCloud size={24} />
            <span>파일을 선택하거나 드롭</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </label>
          <label className="outline-action" role="button" tabIndex={0} aria-label="엑셀 업로드" onKeyDown={openNestedFileInput}>
            <FileSpreadsheet size={18} />
            엑셀 업로드
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </label>
          <label className="outline-action" role="button" tabIndex={0} aria-label="CSV 불러오기" onKeyDown={openNestedFileInput}>
            <FileDown size={18} />
            CSV 불러오기
            <input
              type="file"
              accept=".csv"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </label>
          {canChooseDirectory ? (
            <button
              type="button"
              className="outline-action"
              onClick={() => void handleNewestDirectoryFile()}
            >
              다운로드 폴더에서 최신 파일 찾기
            </button>
          ) : (
            <p>Chrome 또는 Edge에서는 다운로드 폴더에서 최신 파일을 찾을 수 있습니다.</p>
          )}
        </div>
        {message && <p className="status-line">{message}</p>}
        {!importContext && (
          <p className="empty-state">
            현재 프로필과 정확히 일치하는 요금제가 없습니다. 설정에서 계약종별, 수전전압, 현재 요금제를 일치시켜야 보정 요금과 추정 요금을 계산합니다.
          </p>
        )}
      </section>

      {recognition && (
        <section className="panel recognition-panel">
          <div className="panel-title">
            <h2>자동 인식 결과</h2>
            <span>구조·데이터 인식 신뢰도 {recognition.mappingConfidence}%</span>
          </div>
          <div className="recognition-grid">
            <article><span>인식된 시트</span><strong>{recognition.sheetNames.join(', ') || '없음'}</strong></article>
            <article><span>인식된 연도</span><strong>{recognition.recognizedYears.length ? recognition.recognizedYears.join(', ') : '자동 추정'}</strong></article>
            <article><span>정규화 레코드</span><strong>{recognition.recognizedRecordCount.toLocaleString('ko-KR')}건</strong></article>
            <article><span>필수 컬럼</span><strong>{recognition.requiredColumns.join(', ') || '없음'}</strong></article>
            <article className={recognition.missingRequiredColumns.length ? 'danger' : ''}><span>누락 컬럼</span><strong>{recognition.missingRequiredColumns.length ? recognition.missingRequiredColumns.join(', ') : '없음'}</strong></article>
            <article className={recognition.invalidRequiredValues.length ? 'danger' : ''}><span>값 확인 필요</span><strong>{recognition.invalidRequiredValues.length ? recognition.invalidRequiredValues.join(', ') : '없음'}</strong></article>
            <article><span>선택 컬럼</span><strong>{recognition.optionalColumns.join(', ') || '없음'}</strong></article>
          </div>
          <p className={recognition.canAnalyze ? 'status-line' : 'empty-state'}>{recognition.guidance}</p>
          <div className="recognition-actions">
            <button
              type="button"
              className="primary-button"
              disabled={
                !recognition.canAnalyze ||
                !importContext ||
                !pendingBills.length ||
                hasPeriodIssues
              }
              onClick={() => {
                if (pendingBills.length) {
                  void onApplyCandidate?.({
                    origin: 'uploaded',
                    bills: pendingBills,
                    sourceLabel,
                  })
                }
              }}
            >
              이 매핑으로 분석 시작
            </button>
            <button type="button" className="outline-action" onClick={() => setShowManualMapping(true)}>
              수동 매핑 수정
            </button>
          </div>
        </section>
      )}

      {parseResult && selectedSheet && showManualMapping && (
        <section className="panel">
          <div className="panel-title"><h2>컬럼 매핑</h2><span>자동 인식 실패 또는 보정 시 사용</span></div>
          <div className="mapping-toolbar">
            <label>
              분석 대상 시트
              <select value={selectedSheet.name} onChange={(event) => setSelectedSheetName(event.target.value)}>
                {parseResult.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
              </select>
            </label>
            <button type="button" className="primary-button" onClick={applyMapping}>선택 시트 적용</button>
          </div>
          <div className="mapping-grid">
            {mappingFields.map(([key, label, required]) => (
              <label key={key}>
                {label}{required && <span className="required-dot">필수</span>}
                <select value={mapping[key] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [key]: event.target.value }))}>
                  <option value="">미사용</option>
                  {selectedSheet.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
          {parseResult.diagnostics.length > 0 && <ul className="diagnostics-list">{parseResult.diagnostics.map((item) => <li key={item}>{item}</li>)}</ul>}
        </section>
      )}
    </div>
  )
}
