import type {
  AutoDiagnosisResult,
  DocumentBundle,
  MonthlyBill,
  PeakScenario,
  PlanComparison,
  SchoolProfile,
} from '../types'
import { formatKwh, formatWon } from './calculations'
import { getPeakRiskLevel } from './peak'
import type { PeakOperationPlan } from './peakOperations'

export const rateChangeCaution =
  '요금제 변경 신청은 원칙적으로 1년에 한 번만 가능하므로 예상 절감액, 피크 시나리오, 향후 사용량 변동을 신중히 검토한 뒤 진행해야 합니다.'

export const buildDocumentBundle = (
  profile: SchoolProfile,
  latestBill: MonthlyBill | undefined,
  comparison: PlanComparison,
  scenario: PeakScenario,
  diagnosis?: AutoDiagnosisResult,
  peakOperationPlan?: PeakOperationPlan,
): DocumentBundle => {
  const activeComparison = diagnosis?.comparison ?? comparison
  const recommendedPlanName = diagnosis?.recommendedPlan.planName ?? '추천 요금제'
  const currentPlanName = diagnosis?.currentPlan.planName ?? profile.currentPlan
  const peakScenarioSavingWon = diagnosis?.comparison.peakScenarioSavingWon ?? 0
  const calculationModeLabel =
    diagnosis?.calculationMode === 'tariffFull'
      ? '요금표 기반 전체 추정'
      : '고지서 기반 차액 추정'
  const latestMonthLabel = latestBill
    ? `${latestBill.year}년 ${latestBill.month}월분`
    : '최근 월분'
  const latestUsage = latestBill ? formatKwh(latestBill.usageKwh) : '자료 없음'
  const latestBillWon = latestBill ? formatWon(latestBill.totalBillWon) : '자료 없음'
  const riskLevel = getPeakRiskLevel(scenario.targetPeakKw, scenario.expectedPeakKw)
  const calculationBreakdown = diagnosis?.comparison.calculationBreakdown ?? []

  const planText = [
    '예산절감을 위한 전기요금제 변경 계획(안)',
    '',
    'Ⅰ. 관련 근거',
    '- 초·중등교육법 제20조(교직원의 임무)',
    '- 서울특별시교육감 행정권한의 위임에 관한 조례 제6조',
    '- 서울특별시교육청 공인조례',
    '',
    'Ⅱ. 목적 및 필요성',
    '- 기존 전기요금제보다 효율적인 전기요금제를 선택하여 학교 예산 절감 가능성을 검토한다.',
    '- 절감 예산은 교육환경 개선 및 교육활동 지원에 활용한다.',
    '- 본 자료는 학교 내부 진단용 추정이며 공식 청구액 계산기가 아니다.',
    '',
    'Ⅲ. 우리학교 현황',
    `- 학교명: ${profile.displaySchoolName}`,
    `- 계약종별: ${profile.contractType} ${profile.voltageType}`,
    `- 현재 적용 요금제: ${profile.currentPlan}`,
    `- 계약전력: ${profile.contractPowerKw.toLocaleString('ko-KR')}kW`,
    `- 요금적용전력: ${profile.appliedPowerKw.toLocaleString('ko-KR')}kW`,
    `- ${latestMonthLabel} 사용량: ${latestUsage}`,
    `- ${latestMonthLabel} 전기요금: ${latestBillWon}`,
    '',
    'Ⅳ. 요금제별 비교',
    `- 현재 요금제(${currentPlanName}) 기준 연간 예상액: ${formatWon(activeComparison.currentAnnualWon)}`,
    `- 추천 요금제(${recommendedPlanName}) 기준 연간 예상액: ${formatWon(activeComparison.candidateAnnualWon)}`,
    `- 최근 12개월 기준 절감 예상액: ${formatWon(activeComparison.savingWon)}`,
    `- 최근 3년 기준 절감 예상액: ${formatWon(activeComparison.threeYearSavingWon)}`,
    `- 예상 피크값 반영 후 절감액: ${formatWon(peakScenarioSavingWon)}`,
    `- 절감률: ${(activeComparison.savingRate * 100).toFixed(1)}%`,
    `- 판단: ${activeComparison.recommendation}`,
    `- 계산 신뢰도: ${diagnosis?.dataConfidence ?? '보통'}`,
    '',
    'Ⅴ. 예상 피크 시나리오 검토 결과',
    `- 목표 피크: ${scenario.targetPeakKw.toLocaleString('ko-KR')}kW`,
    `- 예상 피크: ${scenario.expectedPeakKw.toLocaleString('ko-KR')}kW`,
    `- 위험도: ${riskLevel}`,
    `- 메모: ${scenario.memo || '해당 없음'}`,
    ...(peakOperationPlan
      ? [
          `- 오늘의 피크관리 운영안: ${peakOperationPlan.todayPlan}`,
          `- 예냉·예열 기준: ${peakOperationPlan.preCoolingHeating}`,
        ]
      : []),
    '',
    'Ⅵ. 전기요금제 변경안',
    `- 기존 ${currentPlanName}에서 ${recommendedPlanName}으로 변경하는 방안을 검토한다.`,
    `- ${rateChangeCaution}`,
    '',
    'Ⅶ. 추진일정',
    '- 1단계: 요금제 검토 및 학교장 승인',
    '- 2단계: 한전 전기사용계약 변경신청서 제출',
    '- 3단계: 요금제 변경 적용 확인',
    '- 4단계: 절감효과 및 피크 모니터링',
    '',
    'Ⅷ. 행정사항',
    '- 전기사용 변경 신청서 공문 제출 시 학교장 직인 확인',
    '- 교육감 또는 소유주 직인이 필요한 경우 관할 부서 협조',
    '- 정기적으로 전기사용량 및 최대수요전력 모니터링 지속',
    '',
    'Ⅸ. 기대효과',
    `- 연간 약 ${formatWon(activeComparison.savingWon)} 절감 가능성을 검토한다.`,
    `- 5년 누적 약 ${formatWon(activeComparison.fiveYearSavingWon)} 절감 가능성이 있다.`,
    '- 예산절감에 따른 학교 시설개선 및 교육활동 지원 가능',
  ].join('\n')

  const kepcoLetterText = [
    '수신: 한국전력공사사장(관할 지사장)',
    `제목: ${profile.displaySchoolName} 전기요금 변경 신청`,
    '',
    '1. 평소 안정적인 전력공급에 깊은 감사를 드리며 귀사의 무궁한 발전을 기원합니다.',
    '2. 관련',
    '  가. 초·중등교육법 제20조',
    '  나. 서울특별시교육청 공인 조례',
    '  다. 서울특별시교육감 행정권한의 위임에 관한 조례 제6조',
    `3. 공립학교의 효율적인 운영을 위하여 ${recommendedPlanName} 적용을 검토하고 붙임과 같이 요금제 변경을 학교장 직인으로 신청하오니 협조하여 주시기 바랍니다.`,
    `4. ${rateChangeCaution}`,
    '5. 신청 희망 적용일은 익월 검침일 이후로 하되, 실제 적용 가능일은 한전 담당자 확인 후 확정합니다.',
    '',
    '붙임',
    `1. 전기사용계약 변경신청서(${profile.displaySchoolName}) 1부.`,
    '2. 사업자등록증 1부.',
    `3. ${latestMonthLabel} 전기요금내역 1부.`,
    '4. 건축물관리대장 1부. 끝.',
    '',
    `${profile.displaySchoolName}장`,
    '',
    '실제 제출 전 담당자 검토 필요',
  ].join('\n')

  const calculationSummaryText = [
    '계산 근거 요약표',
    `- 계산 모드: ${calculationModeLabel}`,
    `- 데이터 인식률: ${diagnosis?.dataRecognitionRate ?? 0}%`,
    `- 인식 월수: ${diagnosis?.recognizedMonths ?? 0}개월`,
    `- 최근 12개월 절감액: ${formatWon(activeComparison.savingWon)}`,
    `- 최근 3년 절감액: ${formatWon(activeComparison.threeYearSavingWon)}`,
    `- 예상 피크값 반영 후 절감액: ${formatWon(peakScenarioSavingWon)}`,
    ...calculationBreakdown.flatMap((row) => [
      `- ${row.label}: 현재 ${formatWon(row.currentWon)} / 추천 ${formatWon(row.candidateWon)} / 차액 ${formatWon(row.differenceWon)}`,
      `  · ${row.note}`,
    ]),
  ].join('\n')
  const reviewItems = [
    '한전 담당자와 실제 적용 가능 요금제 및 적용일 확인',
    '최신 한전 고시 단가 재확인',
    '고객번호, 계약전력, 요금적용전력 원본 청구서 대조',
    '학교장 직인, 개인정보 동의, 소유주 또는 교육청 협조 필요 여부 확인',
    rateChangeCaution,
  ]

  return {
    planText,
    kepcoLetterText,
    applicationPreviewData: {
      고객번호: profile.customerNumber,
      신청일: new Date().toLocaleDateString('ko-KR'),
      전기사용장소: profile.address,
      계약종별: `${profile.contractType} ${profile.voltageType}`,
      계약전력: `${profile.contractPowerKw.toLocaleString('ko-KR')}kW`,
      선택요금변경: `${currentPlanName} -> ${recommendedPlanName}`,
      요금적용희망일: '익월 검침일 이후',
      청구방법: '기존 청구방법 유지',
      신중검토안내: rateChangeCaution,
      서명직인: '수기 확인 필요',
      개인정보동의: '수기 확인 필요',
    },
    checklist: [
      { label: '사업자등록증', ready: true },
      { label: '전기요금내역', ready: true },
      { label: '건축물관리대장', ready: true },
      { label: '변경신청서', ready: true },
      { label: '계산 근거 요약표', ready: true },
      { label: '담당자 검토 필요 항목', ready: true },
    ],
    calculationSummaryText,
    calculationBreakdown,
    reviewItems,
  }
}
