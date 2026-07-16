import { Info, RotateCw } from 'lucide-react'
import type { DataMode } from '../../types'

interface TopNoticeProps {
  expiresAt?: string
  dataMode: DataMode
  onReset: () => void
}

export function TopNotice({ expiresAt, dataMode, onReset }: TopNoticeProps) {
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
        {dataMode === 'sample' ? '현재: 시연 샘플' : '현재: 사용자 업로드'} · 만료 예정: {expiresText}
      </span>
      <button type="button" className="ghost-button" onClick={onReset}>
        <RotateCw size={15} />
        시연 샘플로 초기화
      </button>
    </div>
  )
}
