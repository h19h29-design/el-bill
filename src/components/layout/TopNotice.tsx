import { Info, RotateCw } from 'lucide-react'

interface TopNoticeProps {
  expiresAt?: string
  onReset: () => void
}

export function TopNotice({ expiresAt, onReset }: TopNoticeProps) {
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
        시연용 데이터는 24시간 후 자동 삭제
      </span>
      <span className="notice-detail">만료 예정: {expiresText}</span>
      <button type="button" className="ghost-button" onClick={onReset}>
        <RotateCw size={15} />
        샘플 초기화
      </button>
    </div>
  )
}
