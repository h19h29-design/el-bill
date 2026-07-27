import { useMemo } from 'react'
import { validateBillPeriods } from '../../lib/billPeriods'
import {
  getObservedBillFields,
  type BillDataOrigin,
  type MonthlyBill,
} from '../../types'
import { BillTable } from './BillTable'

export interface BillInputCandidate {
  origin: Exclude<BillDataOrigin, 'sample'>
  bills: MonthlyBill[]
  sourceLabel: string
}

interface BillInputPreviewProps {
  candidate: BillInputCandidate | null
  currentBills: MonthlyBill[]
  hasExactRatePlan: boolean
  onConfirm: (candidate: BillInputCandidate) => Promise<void> | void
  message?: string
  isConfirming?: boolean
}

const requiredFields = ['연도', '월', '사용량', '총 전기요금']

const optionalFieldLabels = {
  appliedPowerKw: '요금적용전력',
  maxDemandKw: '최대수요전력',
  baseChargeWon: '기본요금',
  energyChargeWon: '전력량요금',
  powerFactorChargeWon: '역률요금',
  climateChargeWon: '기후환경요금',
  fuelAdjustmentWon: '연료비조정액',
  vatWon: '부가세',
  fundWon: '전력산업기반기금',
} as const

const formatPeriod = (bill: MonthlyBill) => `${bill.year}년 ${bill.month}월`

export function BillInputPreview({
  candidate,
  currentBills,
  hasExactRatePlan,
  onConfirm,
  message,
  isConfirming = false,
}: BillInputPreviewProps) {
  const recentBills = useMemo(
    () =>
      [...currentBills]
        .sort((a, b) => b.year * 100 + b.month - (a.year * 100 + a.month))
        .slice(0, 12),
    [currentBills],
  )
  const validation = useMemo(
    () => (candidate ? validateBillPeriods(candidate.bills) : null),
    [candidate],
  )
  const observedOptionalFields = useMemo(() => {
    if (!candidate) return []
    const observed = new Set(
      candidate.bills.flatMap((bill) => getObservedBillFields(bill)),
    )
    return Object.entries(optionalFieldLabels)
      .filter(([field]) => observed.has(field as keyof typeof optionalFieldLabels))
      .map(([, label]) => label)
  }, [candidate])
  const periodRange = useMemo(() => {
    const normalizedBills = validation?.normalizedBills ?? []
    if (!normalizedBills.length) return '없음'
    const first = normalizedBills[0]
    const last = normalizedBills[normalizedBills.length - 1]
    return first === last ? formatPeriod(first) : `${formatPeriod(first)} ~ ${formatPeriod(last)}`
  }, [validation])
  const cannotConfirm =
    !candidate ||
    candidate.bills.length === 0 ||
    (validation?.issues.length ?? 0) > 0 ||
    !hasExactRatePlan

  return (
    <>
      {candidate && (
        <section className="panel pending-data-panel">
          <div className="panel-title">
            <h2>새 입력 데이터</h2>
            <span className="pending-data-badge">아직 적용 전</span>
          </div>
          <p className="preview-state-note">
            아래 내용은 새 입력 데이터의 미리보기입니다. `이 데이터로 분석 시작`을 눌러야 현재 진단 데이터가 변경됩니다.
          </p>
          <div className="bill-input-summary" aria-label="입력 데이터 요약">
            <article>
              <span>원본</span>
              <strong>{candidate.sourceLabel}</strong>
            </article>
            <article>
              <span>행 수</span>
              <strong>{candidate.bills.length.toLocaleString('ko-KR')}건</strong>
            </article>
            <article>
              <span>기간</span>
              <strong>{periodRange}</strong>
            </article>
            <article>
              <span>필수 항목</span>
              <strong>{requiredFields.join(', ')}</strong>
            </article>
            <article>
              <span>관측된 선택 항목</span>
              <strong>{observedOptionalFields.join(', ') || '없음'}</strong>
            </article>
          </div>
          {validation && validation.issues.length > 0 && (
            <ul className="diagnostics-list" aria-label="기간 확인 필요">
              {validation.issues.map((issue) => (
                <li key={`${issue.code}-${issue.period}`}>{issue.message}</li>
              ))}
            </ul>
          )}
          {!hasExactRatePlan && (
            <p className="empty-state">
              현재 프로필과 정확히 일치하는 요금제가 없습니다. 설정에서 계약종별, 수전전압, 현재 요금제를 일치시켜야 보정 요금과 추정 요금을 계산합니다.
            </p>
          )}
          {message && <p className="status-line">{message}</p>}
          <div className="recognition-actions">
            <button
              type="button"
              className="primary-button"
              disabled={cannotConfirm || isConfirming}
              onClick={() => {
                void onConfirm(candidate)
              }}
            >
              이 데이터로 분석 시작
            </button>
          </div>
          <BillTable bills={candidate.bills.slice(0, 12)} />
        </section>
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>현재 적용 데이터</h2>
          <span>분석에 사용 중 · 최근 12개월</span>
        </div>
        <BillTable bills={recentBills} />
      </section>
    </>
  )
}
