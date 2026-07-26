import { Info, RotateCw } from 'lucide-react'
import type { DataProvenance } from '../../types'

interface TopNoticeProps {
  expiresAt?: string
  dataProvenance: DataProvenance
  onReset: () => void
}

export function TopNotice({ expiresAt, dataProvenance, onReset }: TopNoticeProps) {
  const expiresText = expiresAt
    ? new Date(expiresAt).toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '24시간 후'

  return (
    <div className="top-notice">
      <span className="notice-badge">
        <Info size={17} />
        브라우저 저장 데이터는 24시간 후 자동 삭제
      </span>
      <span className="notice-detail">
        <span>고지서: {dataProvenance.bills === 'sample' ? '시연 샘플' : '사용자 업로드'}</span>
        {' · '}
        <span>
          파워플래너: {
            dataProvenance.powerPlanner === 'uploaded'
              ? '사용자 업로드'
              : dataProvenance.powerPlanner === 'sample'
                ? '시연 샘플'
                : '미사용'
          }
        </span>
        {' · '}만료 예정: {expiresText}
      </span>
      <button type="button" className="ghost-button" onClick={onReset}>
        <RotateCw size={15} />
        시연 샘플로 초기화
      </button>
    </div>
  )
}
