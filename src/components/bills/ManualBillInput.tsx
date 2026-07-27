import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Trash2 } from 'lucide-react'
import {
  applyMatrixToDraftRows,
  createManualBillRows,
  validateManualBillRows,
  type BillInputIssue,
  type ManualBillDraftField,
  type ManualBillDraftRow,
} from '../../lib/billInput'
import { parseDelimitedMatrix } from '../../lib/excel'
import {
  readBillEntryDraft,
} from '../../lib/billDraftStorage'
import type { PersonalBillInputProps } from './PastedBillInput'
import {
  createManualBillDraftLifecycle,
  type ManualBillDraftLifecycle,
} from './manualBillDraftLifecycle'

const basicFields: ManualBillDraftField[] = [
  'yearMonth',
  'usageKwh',
  'totalBillWon',
  'maxDemandKw',
]

const detailFields: ManualBillDraftField[] = [
  'appliedPowerKw',
  'baseChargeWon',
  'energyChargeWon',
  'powerFactorChargeWon',
  'climateChargeWon',
  'fuelAdjustmentWon',
  'vatWon',
  'fundWon',
  'note',
]

const fieldLabels: Record<ManualBillDraftField, string> = {
  yearMonth: '연월',
  usageKwh: '사용량(kWh)',
  totalBillWon: '총 전기요금(원)',
  maxDemandKw: '최대수요전력(kW)',
  appliedPowerKw: '요금적용전력(kW)',
  baseChargeWon: '기본요금(원)',
  energyChargeWon: '전력량요금(원)',
  powerFactorChargeWon: '역률요금(원)',
  climateChargeWon: '기후환경요금(원)',
  fuelAdjustmentWon: '연료비조정액(원)',
  vatWon: '부가세(원)',
  fundWon: '전력산업기반기금(원)',
  note: '메모',
}

const numericFields = new Set<ManualBillDraftField>([
  'usageKwh',
  'totalBillWon',
  'maxDemandKw',
  'appliedPowerKw',
  'baseChargeWon',
  'energyChargeWon',
  'powerFactorChargeWon',
  'climateChargeWon',
  'fuelAdjustmentWon',
  'vatWon',
  'fundWon',
])
const maximumManualPasteCharacters = 200_000

const localYearMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const newRow = (): ManualBillDraftRow => ({
  id: `manual-${globalThis.crypto.randomUUID()}`,
  yearMonth: '',
  usageKwh: '',
  totalBillWon: '',
  maxDemandKw: '',
  appliedPowerKw: '',
  baseChargeWon: '',
  energyChargeWon: '',
  powerFactorChargeWon: '',
  climateChargeWon: '',
  fuelAdjustmentWon: '',
  vatWon: '',
  fundWon: '',
  note: '',
})

const rowHasContent = (row: ManualBillDraftRow) =>
  Object.entries(row).some(
    ([field, value]) => field !== 'id' && field !== 'yearMonth' && value.trim(),
  )

const inputKey = (rowId: string, field: ManualBillDraftField) => `${rowId}-${field}`

interface ManualBillInputProps extends PersonalBillInputProps {
  onDraftLifecycleChange?: (lifecycle: ManualBillDraftLifecycle | null) => void
}

export type { ManualBillDraftLifecycle } from './manualBillDraftLifecycle'

const formatNumericDisplay = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/(?:kwh|kw|원)$/i, '')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return value
  const number = Number(normalized)
  return Number.isFinite(number)
    ? number.toLocaleString('ko-KR', { maximumFractionDigits: 12 })
    : value
}

export function ManualBillInput({
  importContext,
  onCandidateChange,
  onOpenGuide,
  onDraftLifecycleChange,
}: ManualBillInputProps) {
  const [initialDraft] = useState(() => readBillEntryDraft())
  const [lastYearMonth, setLastYearMonth] = useState(localYearMonth)
  const [rows, setRows] = useState<ManualBillDraftRow[]>(() => initialDraft?.rows ?? [])
  const [touchedRowIds, setTouchedRowIds] = useState<Set<string>>(() => new Set())
  const [showDetails, setShowDetails] = useState(false)
  const [draftMessage, setDraftMessage] = useState(
    initialDraft ? '이전 입력 초안을 복원했습니다.' : '',
  )
  const inputRefs = useRef(new Map<string, HTMLInputElement>())
  const skipInitialWrite = useRef(true)
  const globalIssueRef = useRef<HTMLElement | null>(null)
  const lifecycleRef = useRef<ManualBillDraftLifecycle | null>(null)
  if (!lifecycleRef.current) {
    lifecycleRef.current = createManualBillDraftLifecycle({
      initialRevision: initialDraft?.revision,
      onStatus: (status) => {
        if (status === 'saved') {
          setDraftMessage('입력 초안이 이 브라우저에 최대 24시간 보관됩니다')
          return
        }
        setDraftMessage(
          status === 'remove-failed'
            ? '초안을 삭제하지 못했습니다. 입력을 유지합니다.'
            : '초안을 저장하지 못했습니다. 입력은 화면에 유지됩니다.',
        )
      },
    })
  }
  const draftLifecycle = lifecycleRef.current

  const visibleFields = useMemo(
    () => showDetails ? [...basicFields, ...detailFields] : basicFields,
    [showDetails],
  )
  const activeRows = useMemo(
    () => rows.filter((row) => rowHasContent(row) || touchedRowIds.has(row.id)),
    [rows, touchedRowIds],
  )
  const validation = useMemo(
    () => validateManualBillRows(activeRows, importContext),
    [activeRows, importContext],
  )
  const issuesByCell = useMemo(() => {
    const issues = new Map<string, BillInputIssue[]>()
    validation.issues.forEach((issue) => {
      const field = issue.field === 'period' ? 'yearMonth' : issue.field
      const key = inputKey(issue.rowId, field)
      issues.set(key, [...(issues.get(key) ?? []), issue])
    })
    return issues
  }, [validation.issues])
  const globalIssues = useMemo(
    () => validation.issues.filter((issue) => !issue.rowId),
    [validation.issues],
  )

  useEffect(() => () => draftLifecycle.dispose(), [draftLifecycle])

  useEffect(() => {
    onDraftLifecycleChange?.(draftLifecycle)
    return () => onDraftLifecycleChange?.(null)
  }, [draftLifecycle, onDraftLifecycleChange])

  useEffect(() => {
    onCandidateChange(
      validation.bills.length && validation.issues.length === 0
        ? {
            origin: 'manual',
            bills: validation.bills,
            sourceLabel: '직접 입력',
          }
        : null,
    )
  }, [onCandidateChange, validation.bills, validation.issues.length])

  useEffect(() => {
    if (skipInitialWrite.current) {
      skipInitialWrite.current = false
      return
    }
    if (!rows.length) {
      void draftLifecycle.remove()
      return
    }
    draftLifecycle.schedule(rows)
  }, [draftLifecycle, rows])

  const updateCell = (rowId: string, field: ManualBillDraftField, value: string) => {
    setTouchedRowIds((current) => new Set(current).add(rowId))
    setRows((current) => current.map((row) =>
      row.id === rowId ? { ...row, [field]: value } : row,
    ))
  }

  const focusCell = (rowIndex: number, fieldIndex: number) => {
    const row = rows[rowIndex]
    const field = visibleFields[fieldIndex]
    if (row && field) inputRefs.current.get(inputKey(row.id, field))?.focus()
  }

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    field: ManualBillDraftField,
  ) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.shiftKey && event.key !== 'Tab') ||
      event.nativeEvent.isComposing
    ) return
    const fieldIndex = visibleFields.indexOf(field)
    if (fieldIndex < 0) return
    let targetRow = rowIndex
    let targetField = fieldIndex

    if (event.key === 'Tab') {
      targetField += event.shiftKey ? -1 : 1
      if (targetField < 0) {
        targetRow -= 1
        targetField = visibleFields.length - 1
      }
      if (targetField >= visibleFields.length) {
        targetRow += 1
        targetField = 0
      }
    } else if (event.key === 'Enter' || event.key === 'ArrowDown') {
      targetRow += 1
    } else if (event.key === 'ArrowUp') {
      targetRow -= 1
    } else if (event.key === 'ArrowRight') {
      targetField += 1
    } else if (event.key === 'ArrowLeft') {
      targetField -= 1
    } else {
      return
    }

    if (targetRow < 0 || targetRow >= rows.length || targetField < 0 || targetField >= visibleFields.length) return
    event.preventDefault()
    focusCell(targetRow, targetField)
  }

  const handleCellPaste = (
    event: ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    field: ManualBillDraftField,
  ) => {
    const text = event.clipboardData.getData('text')
    if (text.length > maximumManualPasteCharacters) {
      event.preventDefault()
      setDraftMessage('붙여넣기 내용은 200,000자 이하로 입력해 주세요.')
      return
    }
    if (!text.includes('\t') && !text.includes('\n') && !text.includes('\r')) return
    const firstNonEmptyLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
    const matrix = parseDelimitedMatrix(text, firstNonEmptyLine.includes('\t') ? '\t' : ',')
    if (!matrix.length) return
    event.preventDefault()
    setTouchedRowIds((current) => {
      const next = new Set(current)
      matrix.forEach((_, matrixIndex) => {
        const row = rows[rowIndex + matrixIndex]
        if (row) next.add(row.id)
      })
      return next
    })
    setRows((current) => applyMatrixToDraftRows(
      current,
      rowIndex,
      field,
      matrix,
      visibleFields,
    ))
  }

  const generateRows = (count: 12 | 36) => {
    if (rows.length && !window.confirm('현재 입력 행을 새 기간으로 덮어쓸까요?')) return
    const generated = createManualBillRows(lastYearMonth, count)
    if (!generated.length) {
      setDraftMessage('마지막 청구월은 YYYY-MM 형식으로 입력해 주세요.')
      return
    }
    setRows(generated)
    setTouchedRowIds(new Set())
    setDraftMessage('')
  }

  const resetRows = async () => {
    if (!rows.length || !window.confirm('입력한 모든 행을 초기화할까요?')) return
    const removal = await draftLifecycle.remove()
    if (!removal.ok) return
    setRows([])
    setTouchedRowIds(new Set())
    setDraftMessage('')
  }

  const applyPowerToAllRows = () => {
    const value = rows.find((row) => row.appliedPowerKw.trim())?.appliedPowerKw
    if (!value) {
      setDraftMessage('먼저 요금적용전력 값을 한 행에 입력해 주세요.')
      return
    }
    setRows((current) => current.map((row) => ({ ...row, appliedPowerKw: value })))
  }

  const focusFirstIssue = () => {
    const issue = validation.issues.find((item) => item.rowId)
    if (issue) {
      const field = issue.field === 'period' ? 'yearMonth' : issue.field
      inputRefs.current.get(inputKey(issue.rowId, field))?.focus()
      return
    }
    globalIssueRef.current?.focus()
  }

  return (
    <div className="input-mode-shell">
      <section className="panel manual-bill-panel">
        <div className="panel-title">
          <div>
            <h2>직접 입력</h2>
            <p>필수 값만 입력해도 분석 미리보기를 만들 수 있습니다.</p>
          </div>
          <button type="button" className="text-action" onClick={() => onOpenGuide('manual-input')}>
            입력 안내
          </button>
        </div>
        <div className="manual-controls">
          <label>
            마지막 청구월
            <input
              value={lastYearMonth}
              onChange={(event) => setLastYearMonth(event.target.value)}
              inputMode="numeric"
              placeholder="YYYY-MM"
            />
          </label>
          <div className="manual-grid-actions" aria-label="입력행 생성">
            <button type="button" className="primary-button" onClick={() => generateRows(12)}>최근 12개월 입력행 생성</button>
            <button type="button" className="outline-action" onClick={() => generateRows(36)}>최근 36개월 입력행 생성</button>
            <button type="button" className="outline-action" onClick={() => void resetRows()} disabled={!rows.length}>전체 초기화</button>
          </div>
        </div>
        <p className="field-hint" role="status">{draftMessage || '입력 초안이 이 브라우저에 최대 24시간 보관됩니다'}</p>
      </section>

      {rows.length > 0 && (
        <section className="panel manual-grid-panel">
          <div className="manual-grid-toolbar">
            <div className="manual-grid-actions">
              <button type="button" className="outline-action" onClick={() => setShowDetails((current) => !current)}>
                상세 항목 {showDetails ? '접기' : '펼치기'}
              </button>
              {showDetails && <button type="button" className="outline-action" onClick={applyPowerToAllRows}>모든 월에 동일 적용</button>}
              <button
                type="button"
                className="outline-action"
                disabled={rows.length >= 36}
                onClick={() => setRows((current) => current.length >= 36 ? current : [...current, newRow()])}
              >
                입력행 추가
              </button>
            </div>
            <span>{rows.length}/36행</span>
          </div>
          {validation.issues.length > 0 && (
            <button
              type="button"
              className="outline-action first-error-action"
              aria-controls={globalIssues.length ? 'manual-global-issues' : undefined}
              onClick={focusFirstIssue}
            >
              첫 오류로 이동
            </button>
          )}
          {globalIssues.length > 0 && (
            <section
              ref={globalIssueRef}
              id="manual-global-issues"
              className="manual-global-issues"
              role="status"
              aria-label="기간 확인 필요"
              tabIndex={-1}
            >
              <strong>기간 확인 필요</strong>
              <ul className="diagnostics-list">
                {globalIssues.map((issue) => <li key={issue.message}>{issue.message}</li>)}
              </ul>
            </section>
          )}
          <div className="manual-grid-scroll">
            <table className="manual-bill-grid">
              <thead>
                <tr>
                  {visibleFields.map((field) => <th key={field} scope="col">{fieldLabels[field]}</th>)}
                  <th scope="col">상태</th>
                  <th scope="col" aria-label="행 삭제" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const rowIssues = validation.issues.filter((issue) => issue.rowId === row.id)
                  return (
                    <tr key={row.id} className={rowIssues.length ? 'has-input-issues' : ''}>
                      {visibleFields.map((field) => {
                        const cellIssues = issuesByCell.get(inputKey(row.id, field)) ?? []
                        const baseLabel = fieldLabels[field]
                        const label = row.yearMonth ? `${row.yearMonth} ${baseLabel}` : baseLabel
                        const issueId = cellIssues.length ? `issue-${row.id}-${field}` : undefined
                        return (
                          <td key={field}>
                            <input
                              ref={(element) => {
                                const key = inputKey(row.id, field)
                                if (element) inputRefs.current.set(key, element)
                                else inputRefs.current.delete(key)
                              }}
                              aria-label={label}
                              aria-invalid={cellIssues.length > 0 || undefined}
                              aria-describedby={issueId}
                              value={row[field]}
                              inputMode={numericFields.has(field) ? 'decimal' : undefined}
                              onChange={(event) => updateCell(row.id, field, event.target.value)}
                              onBlur={(event) => {
                                if (numericFields.has(field)) {
                                  updateCell(row.id, field, formatNumericDisplay(event.target.value))
                                }
                              }}
                              onKeyDown={(event) => handleCellKeyDown(event, rowIndex, field)}
                              onPaste={(event) => handleCellPaste(event, rowIndex, field)}
                            />
                            {cellIssues.map((issue) => <p key={issue.message} id={issueId} className="cell-issue">{issue.message}</p>)}
                          </td>
                        )
                      })}
                      <td>
                        {rowIssues.length ? <span className="row-issue">보완 필요</span> : <span className="row-valid">입력 대기</span>}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`${row.yearMonth || rowIndex + 1}행 삭제`}
                          title="행 삭제"
                          onClick={() => {
                            setRows((current) => current.filter((item) => item.id !== row.id))
                            setTouchedRowIds((current) => {
                              const next = new Set(current)
                              next.delete(row.id)
                              return next
                            })
                          }}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
