export type PeakRiskLevel = '안전' | '주의' | '경고' | '위험'

export const getPeakRatio = (targetPeakKw: number, expectedPeakKw: number) => {
  if (!targetPeakKw) return 0
  return expectedPeakKw / targetPeakKw
}

export const getPeakRiskLevel = (
  targetPeakKw: number,
  expectedPeakKw: number,
): PeakRiskLevel => {
  const ratio = getPeakRatio(targetPeakKw, expectedPeakKw)
  if (ratio < 0.8) return '안전'
  if (ratio < 0.9) return '주의'
  if (ratio < 0.95) return '경고'
  return '위험'
}

export const getPeakRiskTone = (level: PeakRiskLevel) => {
  if (level === '안전') return 'safe'
  if (level === '주의') return 'watch'
  if (level === '경고') return 'warning'
  return 'danger'
}

export const summerPeakBlocks = ['11:00~12:00', '13:00~17:00']
export const winterPeakBlocks = ['10:00~12:00', '17:00~20:00', '22:00~23:00']

export const peakGuideItems = [
  '본관 EHP 층별 5분 간격 순차 가동',
  '강당 냉방·난방은 수업 30분 전 예냉·예열 후 유지 운전',
  '급식실 고전력 기기 동시 사용 분산',
  '특별실 냉난방 시간 조정',
  '보건실, 서버실, 특수학급 등 필수 공간은 제외 대상으로 표시',
]
