import {
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { FileDown, FileSpreadsheet, UploadCloud } from 'lucide-react'
import type { MonthlyBill, RatePlan, SchoolProfile } from '../../types'
import {
  mapRowsToBills,
  parseWorkbook,
  validateUploadFile,
  type ParsedSheet,
  type WorkbookParseResult,
} from '../../lib/excel'
import { findExactRatePlan, summarizeWorkbookRecognition } from '../../lib/diagnosis'
import { BillTable } from './BillTable'

interface BillUploadProps {
  bills: MonthlyBill[]
  profile: SchoolProfile
  ratePlans: RatePlan[]
  onBillsChange: (bills: MonthlyBill[]) => Promise<boolean>
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

const guessHeader = (headers: string[], label: string) =>
  headers.find((header) => header.includes(label) || label.includes(header)) ?? ''

const buildMapping = (headers: string[]) => ({
  year: guessHeader(headers, '연도'),
  month: guessHeader(headers, '월'),
  usageKwh: guessHeader(headers, '사용량'),
  totalBillWon: guessHeader(headers, '총'),
  appliedPowerKw: guessHeader(headers, '요금적용전력'),
  maxDemandKw: guessHeader(headers, '최대수요전력'),
  baseChargeWon: guessHeader(headers, '기본요금'),
  energyChargeWon: guessHeader(headers, '전력량요금'),
  powerFactorChargeWon: guessHeader(headers, '역률요금'),
  climateChargeWon: guessHeader(headers, '기후환경요금'),
  fuelAdjustmentWon: guessHeader(headers, '연료비조정액'),
  vatWon: guessHeader(headers, '부가세'),
  fundWon: guessHeader(headers, '전력산업기반기금'),
  note: guessHeader(headers, '메모'),
})

export function BillUpload({
  bills,
  profile,
  ratePlans,
  onBillsChange,
}: BillUploadProps) {
  const [parseResult, setParseResult] = useState<WorkbookParseResult | null>(null)
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [showManualMapping, setShowManualMapping] = useState(false)

  const selectedSheet: ParsedSheet | undefined = useMemo(
    () =>
      parseResult?.sheets.find((sheet) => sheet.name === selectedSheetName) ??
      parseResult?.sheets[0],
    [parseResult, selectedSheetName],
  )

  const recentBills = useMemo(
    () =>
      [...bills]
        .sort((a, b) => b.year * 100 + b.month - (a.year * 100 + a.month))
        .slice(0, 12),
    [bills],
  )
  const recognition = useMemo(
    () => summarizeWorkbookRecognition(parseResult, mapping),
    [parseResult, mapping],
  )
  const exactCurrentPlan = useMemo(
    () => findExactRatePlan(profile, ratePlans),
    [profile, ratePlans],
  )
  const importContext = useMemo(
    () => exactCurrentPlan
      ? {
          appliedPowerKw: profile.appliedPowerKw,
          currentPlan: exactCurrentPlan,
        }
      : undefined,
    [exactCurrentPlan, profile.appliedPowerKw],
  )
  const pendingBills = useMemo(() => {
    if (!parseResult) return []
    if (parseResult.autoRows.length) return parseResult.autoRows
    return selectedSheet
      ? mapRowsToBills(selectedSheet.rows, mapping, importContext)
      : []
  }, [importContext, mapping, parseResult, selectedSheet])

  const handleFile = async (file: File) => {
    const validationMessage = validateUploadFile(file)
    if (validationMessage) {
      setParseResult(null)
      setMessage(validationMessage)
      return
    }

    try {
      const result = await parseWorkbook(file, importContext)
      setParseResult(result)
      setSelectedSheetName(result.sheets[0]?.name ?? '')
      setShowManualMapping(false)
      setMapping(buildMapping(result.sheets[0]?.headers ?? []))
      setMessage(
        importContext
          ? '파일을 읽었습니다. 새 파일 미리보기와 자동 인식 결과를 확인한 뒤 분석을 시작해 주세요.'
          : '현재 요금제가 설정과 정확히 일치하지 않습니다. 설정에서 계약종별, 수전전압, 현재 요금제를 확인한 뒤 요금 추정을 진행하세요. 원본 필수 컬럼은 확인할 수 있습니다.',
      )
    } catch (error) {
      setParseResult(null)
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

  const handleCsv = async (file: File) => {
    await handleFile(file)
  }

  const applyMapping = async () => {
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
    let saved = false
    try {
      saved = await onBillsChange(mapped)
    } catch {
      saved = false
    }
    if (!saved) {
      setMessage(
        '브라우저 저장소에 자료를 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요.',
      )
      return
    }
    setMessage(`${mapped.length.toLocaleString('ko-KR')}건을 매핑해 반영했습니다.`)
  }

  const applyRecognizedMapping = async () => {
    if (!parseResult) return
    if (!importContext) {
      setMessage(
        '현재 요금제가 설정과 정확히 일치하지 않아 분석을 시작할 수 없습니다. 설정에서 계약종별, 수전전압, 현재 요금제를 확인해 주세요.',
      )
      return
    }
    if (parseResult.autoRows.length) {
      let saved = false
      try {
        saved = await onBillsChange(parseResult.autoRows)
      } catch {
        saved = false
      }
      if (!saved) {
        setMessage(
          '브라우저 저장소에 자료를 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요.',
        )
        return
      }
      const isPowerPlannerExport = parseResult.diagnostics.some((item) =>
        item.includes('파워플래너'),
      )
      setMessage(
        isPowerPlannerExport
          ? `파워플래너 월별청구요금 ${parseResult.autoRows.length.toLocaleString('ko-KR')}건으로 자동진단을 시작했습니다.`
          : `연도별 시트 자동 병합 ${parseResult.autoRows.length.toLocaleString('ko-KR')}건으로 자동진단을 시작했습니다.`,
      )
      return
    }
    await applyMapping()
  }

  return (
    <div className="view-stack">
      <section className="form-grid four">
        <label>
          학교명
          <input value={profile.displaySchoolName} readOnly />
        </label>
        <label>
          계약종별
          <input value={profile.contractType} readOnly />
        </label>
        <label>
          수전전압
          <input value={profile.voltageType} readOnly />
        </label>
        <label>
          현재 요금제
          <input value={profile.currentPlan} readOnly />
        </label>
      </section>

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
          <label
            className="outline-action"
            role="button"
            tabIndex={0}
            aria-label="엑셀 업로드"
            onKeyDown={openNestedFileInput}
          >
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
          <label
            className="outline-action"
            role="button"
            tabIndex={0}
            aria-label="CSV 불러오기"
            onKeyDown={openNestedFileInput}
          >
            <FileDown size={18} />
            CSV 불러오기
            <input
              type="file"
              accept=".csv"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void handleCsv(file)
              }}
            />
          </label>
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
            <article>
              <span>인식된 시트</span>
              <strong>{recognition.sheetNames.join(', ') || '없음'}</strong>
            </article>
            <article>
              <span>인식된 연도</span>
              <strong>
                {recognition.recognizedYears.length
                  ? recognition.recognizedYears.join(', ')
                  : '자동 추정'}
              </strong>
            </article>
            <article>
              <span>정규화 레코드</span>
              <strong>{recognition.recognizedRecordCount.toLocaleString('ko-KR')}건</strong>
            </article>
            <article>
              <span>필수 컬럼</span>
              <strong>{recognition.requiredColumns.join(', ') || '없음'}</strong>
            </article>
            <article className={recognition.missingRequiredColumns.length ? 'danger' : ''}>
              <span>누락 컬럼</span>
              <strong>
                {recognition.missingRequiredColumns.length
                  ? recognition.missingRequiredColumns.join(', ')
                  : '없음'}
              </strong>
            </article>
            <article>
              <span>선택 컬럼</span>
              <strong>{recognition.optionalColumns.join(', ') || '없음'}</strong>
            </article>
          </div>
          <p className={recognition.canAnalyze ? 'status-line' : 'empty-state'}>
            {recognition.guidance}
          </p>
          <div className="recognition-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!recognition.canAnalyze || !importContext}
              onClick={() => {
                void applyRecognizedMapping()
              }}
            >
              이 매핑으로 분석 시작
            </button>
            <button
              type="button"
              className="outline-action"
              onClick={() => setShowManualMapping(true)}
            >
              수동 매핑 수정
            </button>
          </div>
        </section>
      )}

      {parseResult && selectedSheet && showManualMapping && (
        <section className="panel">
          <div className="panel-title">
            <h2>컬럼 매핑</h2>
            <span>자동 인식 실패 또는 보정 시 사용</span>
          </div>
          <div className="mapping-toolbar">
            <label>
              분석 대상 시트
              <select
                value={selectedSheet.name}
                onChange={(event) => setSelectedSheetName(event.target.value)}
              >
                {parseResult.sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void applyMapping()
              }}
            >
              선택 시트 적용
            </button>
          </div>
          <div className="mapping-grid">
            {mappingFields.map(([key, label, required]) => (
              <label key={key}>
                {label}
                {required && <span className="required-dot">필수</span>}
                <select
                  value={mapping[key] ?? ''}
                  onChange={(event) =>
                    setMapping((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                >
                  <option value="">미사용</option>
                  {selectedSheet.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {parseResult.diagnostics.length > 0 && (
            <ul className="diagnostics-list">
              {parseResult.diagnostics.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {parseResult && pendingBills.length > 0 && (
        <section className="panel pending-data-panel">
          <div className="panel-title">
            <h2>새 파일 분석 미리보기</h2>
            <span className="pending-data-badge">아직 적용 전</span>
          </div>
          <p className="preview-state-note">
            아래 내용은 새로 선택한 파일의 미리보기입니다. `이 매핑으로 분석 시작`을 눌러야 현재 진단 데이터가 변경됩니다.
          </p>
          <BillTable bills={pendingBills.slice(0, 12)} />
        </section>
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>현재 적용 데이터</h2>
          <span>분석에 사용 중 · 최근 12개월</span>
        </div>
        <BillTable bills={recentBills} />
      </section>
    </div>
  )
}
