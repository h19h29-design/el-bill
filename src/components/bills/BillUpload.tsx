import {
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { FileDown, FileSpreadsheet, UploadCloud } from 'lucide-react'
import type { MonthlyBill, SchoolProfile } from '../../types'
import {
  mapRowsToBills,
  parseWorkbook,
  type ParsedSheet,
  type WorkbookParseResult,
} from '../../lib/excel'
import { BillTable } from './BillTable'

interface BillUploadProps {
  bills: MonthlyBill[]
  profile: SchoolProfile
  onBillsChange: (bills: MonthlyBill[]) => void
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

export function BillUpload({ bills, profile, onBillsChange }: BillUploadProps) {
  const [parseResult, setParseResult] = useState<WorkbookParseResult | null>(null)
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

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

  const handleFile = async (file: File) => {
    const result = await parseWorkbook(file)
    setParseResult(result)
    setSelectedSheetName(result.sheets[0]?.name ?? '')
    const headers = result.sheets[0]?.headers ?? []
    setMapping({
      year: guessHeader(headers, '연도'),
      month: guessHeader(headers, '월'),
      usageKwh: guessHeader(headers, '사용량'),
      totalBillWon: guessHeader(headers, '총'),
      appliedPowerKw: guessHeader(headers, '요금적용전력'),
      maxDemandKw: guessHeader(headers, '최대수요전력'),
      baseChargeWon: guessHeader(headers, '기본요금'),
      energyChargeWon: guessHeader(headers, '전력량요금'),
    })

    if (result.autoRows.length) {
      onBillsChange(result.autoRows)
      const isPowerPlannerExport = result.diagnostics.some((item) =>
        item.includes('파워플래너'),
      )
      setMessage(
        isPowerPlannerExport
          ? `파워플래너 월별청구요금 ${result.autoRows.length.toLocaleString('ko-KR')}건을 반영했습니다.`
          : `연도별 시트 자동 병합으로 ${result.autoRows.length.toLocaleString('ko-KR')}건을 반영했습니다.`,
      )
      return
    }

    setMessage('자동 병합이 어려워 컬럼 매핑을 확인해 주세요.')
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
    const text = await file.text()
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.split(',').map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean))
    const headers = rows[0] ?? []
    const dataRows = rows.slice(1).map((row) =>
      headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = row[index] ?? ''
        return acc
      }, {}),
    )
    setParseResult({
      sheets: [{ name: file.name, headers, rows: dataRows }],
      autoRows: [],
      diagnostics: ['CSV는 수동 컬럼 매핑으로 처리합니다.'],
    })
    setSelectedSheetName(file.name)
    setMessage('CSV를 읽었습니다. 필수 컬럼 매핑을 확인해 주세요.')
  }

  const applyMapping = () => {
    if (!selectedSheet) return
    const mapped = mapRowsToBills(selectedSheet.rows, mapping)
    if (!mapped.length) {
      setMessage('필수 매핑 결과가 없습니다. 연도, 월, 사용량, 총 전기요금을 확인해 주세요.')
      return
    }
    onBillsChange(mapped)
    setMessage(`${mapped.length.toLocaleString('ko-KR')}건을 매핑해 반영했습니다.`)
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
      </section>

      {parseResult && selectedSheet && (
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
            <button type="button" className="primary-button" onClick={applyMapping}>
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

      <section className="panel">
        <div className="panel-title">
          <h2>고지서 입력 내역</h2>
          <span>최근 12개월 미리보기</span>
        </div>
        <BillTable bills={recentBills} />
      </section>
    </div>
  )
}
