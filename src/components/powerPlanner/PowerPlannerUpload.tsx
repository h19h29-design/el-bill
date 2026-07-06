import {
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import {
  AlertTriangle,
  DatabaseZap,
  FileSpreadsheet,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import type {
  PowerPlannerDataSource,
  PowerPlannerDataType,
} from '../../types'
import {
  parseWorkbook,
  type ParsedSheet,
  type WorkbookParseResult,
} from '../../lib/excel'
import {
  createPowerPlannerDataSource,
  getMissingPowerPlannerMappings,
  getPowerPlannerSheetLabel,
  getPowerPlannerSummary,
  guessPowerPlannerDataType,
  guessPowerPlannerMapping,
  mapRowsToPowerPlannerRecords,
  powerPlannerDataTypeLabels,
  powerPlannerMappingFields,
  powerPlannerMvpGuardrail,
  powerPlannerUploadNotice,
  requiredPowerPlannerMapping,
} from '../../lib/powerPlanner'
import { samplePowerPlannerDataSource } from '../../data/samplePowerPlanner'

interface PowerPlannerUploadProps {
  dataSource: PowerPlannerDataSource | null
  onDataSourceChange: (dataSource: PowerPlannerDataSource | null) => void
}

const dataTypes = Object.entries(powerPlannerDataTypeLabels) as Array<
  [PowerPlannerDataType, string]
>

export function PowerPlannerUpload({
  dataSource,
  onDataSourceChange,
}: PowerPlannerUploadProps) {
  const [dataType, setDataType] = useState<PowerPlannerDataType>('hourlyUsage')
  const [parseResult, setParseResult] = useState<WorkbookParseResult | null>(null)
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [sourceName, setSourceName] = useState('파워플래너 사용자 업로드')
  const [message, setMessage] = useState('')

  const selectedSheet: ParsedSheet | undefined = useMemo(
    () =>
      parseResult?.sheets.find((sheet) => sheet.name === selectedSheetName) ??
      parseResult?.sheets[0],
    [parseResult, selectedSheetName],
  )
  const summary = useMemo(() => getPowerPlannerSummary(dataSource), [dataSource])
  const required = requiredPowerPlannerMapping(dataType)

  const handleFile = async (file: File) => {
    const result = await parseWorkbook(file)
    const firstSheet = result.sheets[0]
    setParseResult(result)
    setSelectedSheetName(firstSheet?.name ?? '')
    setSourceName(file.name)
    setDataType(guessPowerPlannerDataType(firstSheet?.headers ?? []))
    setMapping(guessPowerPlannerMapping(firstSheet?.headers ?? []))
    setMessage('파일을 읽었습니다. 데이터 유형과 컬럼 매핑을 확인해 주세요.')
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const openNestedFileInput = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.currentTarget.querySelector('input')?.click()
  }

  const applyMapping = () => {
    if (!selectedSheet) {
      setMessage('선택된 시트가 없습니다.')
      return
    }

    const missing = getMissingPowerPlannerMappings(dataType, mapping)
    if (missing.length) {
      setMessage(`필수 매핑이 비어 있습니다: ${missing.join(', ')}`)
      return
    }

    const records = mapRowsToPowerPlannerRecords(
      selectedSheet.rows,
      dataType,
      mapping,
    )
    if (!records.length) {
      setMessage('매핑 결과가 없습니다. 필수 컬럼 값과 데이터 유형을 확인해 주세요.')
      return
    }

    const existing = dataSource?.records ?? []
    const next = createPowerPlannerDataSource(
      [...existing, ...records],
      sourceName,
      `${powerPlannerDataTypeLabels[dataType]} ${records.length.toLocaleString('ko-KR')}건 반영`,
    )
    onDataSourceChange(next)
    setMessage(
      `${powerPlannerDataTypeLabels[dataType]} ${records.length.toLocaleString('ko-KR')}건을 반영했습니다. 기존 자료와 합쳐 총 ${next.records.length.toLocaleString('ko-KR')}건입니다.`,
    )
  }

  return (
    <div className="view-stack">
      <section className="power-info-grid">
        <article className="info-card">
          <DatabaseZap size={26} />
          <strong>한전 파워플래너 자료 재분석</strong>
          <p>
            파워플래너의 실시간 전기사용량, 월예상요금, 소비패턴 분석, 목표사용량 초과 알림,
            선택요금/부하이동 시뮬레이션 자료를 학교 행정업무 관점으로 다시 정리합니다.
          </p>
        </article>
        <article className="info-card guard">
          <ShieldCheck size={26} />
          <strong>자동 연동 없음</strong>
          <p>{powerPlannerMvpGuardrail}</p>
        </article>
        <article className="info-card notice">
          <AlertTriangle size={26} />
          <strong>고객번호 확인</strong>
          <p>{powerPlannerUploadNotice}</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>자료 업로드 및 컬럼 매핑</h2>
          <span>엑셀/CSV 업로드 후 컬럼 매핑</span>
        </div>
        <div className="power-upload-layout">
          <label>
            업로드 데이터 유형
            <select
              value={dataType}
              onChange={(event) =>
                setDataType(event.target.value as PowerPlannerDataType)
              }
            >
              {dataTypes.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="upload-drop power-upload"
            role="button"
            tabIndex={0}
            aria-label="파워플래너 엑셀 또는 CSV 선택"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            onKeyDown={openNestedFileInput}
          >
            <UploadCloud size={24} />
            <span>파워플래너 엑셀/CSV 선택</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </label>
          <button type="button" className="outline-action" onClick={applyMapping}>
            <FileSpreadsheet size={18} />
            매핑 적용
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              onDataSourceChange(samplePowerPlannerDataSource)
              setMessage('시연용 시간대별 파워플래너 샘플을 적용했습니다.')
            }}
          >
            시연 샘플 적용
          </button>
        </div>
        {parseResult && (
          <div className="mapping-toolbar">
            <label>
              분석 대상 시트
              <select
                value={selectedSheet?.name ?? ''}
                onChange={(event) => {
                  const nextSheetName = event.target.value
                  const nextSheet = parseResult.sheets.find(
                    (sheet) => sheet.name === nextSheetName,
                  )
                  setSelectedSheetName(nextSheetName)
                  setDataType(guessPowerPlannerDataType(nextSheet?.headers ?? []))
                  setMapping(guessPowerPlannerMapping(nextSheet?.headers ?? []))
                }}
              >
                {parseResult.sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {getPowerPlannerSheetLabel(sheet)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              출처명
              <input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
              />
            </label>
          </div>
        )}
        {selectedSheet && (
          <div className="mapping-grid power-mapping-grid">
            {powerPlannerMappingFields.map(([key, label]) => (
              <label key={key}>
                {label}
                {required.includes(key) && <span className="required-dot">필수</span>}
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
        )}
        {message && <p className="status-line">{message}</p>}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>업로드 자료 요약</h2>
          <span>
            {dataSource
              ? `${dataSource.sourceLabel} · ${new Date(dataSource.importedAt).toLocaleString('ko-KR')}`
              : '자료 없음'}
          </span>
        </div>
        {dataSource ? (
          <div className="power-summary-grid">
            <article>
              <span>총 레코드</span>
              <strong>{summary.totalRecords.toLocaleString('ko-KR')}건</strong>
            </article>
            <article>
              <span>시간대별 자료</span>
              <strong>{summary.hourlyCount.toLocaleString('ko-KR')}건</strong>
            </article>
            <article>
              <span>최대 시간대</span>
              <strong>
                {summary.maxHourly?.hour !== undefined
                  ? `${summary.maxHourly.hour}시 · ${summary.maxHourly.usageKwh?.toLocaleString('ko-KR')}kWh`
                  : '자료 없음'}
              </strong>
            </article>
            <article>
              <span>최대수요전력</span>
              <strong>
                {summary.maxDemand?.maxDemandKw
                  ? `${summary.maxDemand.maxDemandKw.toLocaleString('ko-KR')}kW`
                  : '자료 없음'}
              </strong>
            </article>
          </div>
        ) : (
          <p className="empty-state">
            파워플래너 자료가 없으면 기존 한전 고지서 월별 데이터만으로 진단합니다.
          </p>
        )}
        {dataSource && (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              onDataSourceChange(null)
              setMessage('파워플래너 업로드 자료를 초기화했습니다.')
            }}
          >
            업로드 자료 초기화
          </button>
        )}
      </section>
    </div>
  )
}
