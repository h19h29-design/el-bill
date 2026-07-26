import type { PeakScenario } from '../types'

export interface PeakOperationPlan {
  todayPlan: string
  summerPlan: string
  winterPlan: string
  preCoolingHeating: string
  sequentialOrder: string[]
  avoidCombinations: string[]
  exceptionConditions: string[]
  operatingWindows: Array<{
    label: string
    time: string
    tone: 'danger' | 'warning' | 'neutral'
  }>
}

export const EHP_GROUP_MIN = 1
export const EHP_GROUP_MAX = 100

export const normalizeEhpGroupCount = (
  value: number | undefined,
  fallback: number,
) => {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    Number(value) < EHP_GROUP_MIN
  ) {
    return fallback
  }
  return Math.min(Number(value), EHP_GROUP_MAX)
}

const formatStartTime = (offset: number) => {
  const minutes = 13 * 60 + offset * 5
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export const buildPeakOperationPlan = (
  scenario: PeakScenario,
): PeakOperationPlan => {
  const mainGroups = normalizeEhpGroupCount(scenario.mainBuildingEhpGroups, 5)
  const annexGroups = normalizeEhpGroupCount(scenario.annexEhpGroups, 2)
  const cafeteriaTime = scenario.cafeteriaHighPowerTime || '11:00~13:00'
  const specialRoomTime = scenario.specialRoomTime || '14:00~16:00'
  const exemptSpaces = scenario.exemptSpaces || '보건실, 서버실, 특수학급'
  const auditoriumText = scenario.auditoriumCooling
    ? '강당 냉방은 12:30 예냉 후 유지운전으로 전환합니다.'
    : '강당 냉난방은 행사 시간 외에는 대기 운전으로 유지합니다.'
  const mainSequence = Array.from({ length: mainGroups }, (_, index) =>
    `${formatStartTime(index)} 본관 EHP ${index + 1}그룹 기동`,
  )
  const annexSequence = Array.from({ length: annexGroups }, (_, index) =>
    `${formatStartTime(mainGroups + index)} 별관 EHP ${index + 1}그룹 기동`,
  )

  return {
    todayPlan:
      `13:00~17:00 최대부하 시간대에는 본관 EHP ${mainGroups}개 그룹을 ` +
      `층별 5분 간격으로 순차 가동하고, 별관 ${annexGroups}개 그룹은 본관 기동 후 분산 투입합니다. ` +
      `${auditoriumText} 급식실 고전력 기기 사용 시간(${cafeteriaTime})과 강당 EHP 동시 가동은 피크 위험이 있으므로 시간 분산이 필요합니다.`,
    summerPlan:
      '하계에는 10:30부터 예냉을 시작하고 13:00 이후에는 설정온도 유지, 블라인드 차열, 층별 순환 운전을 적용합니다.',
    winterPlan:
      '동계에는 08:30 예열 후 10:00~12:00, 17:00~20:00, 22:00~23:00 최대부하 시간대의 동시 기동을 제한합니다.',
    preCoolingHeating:
      '예냉은 최대부하 30~60분 전, 예열은 등교 전 30분 전부터 시작하고 최대부하 시간대에는 신규 기동보다 유지운전을 우선합니다.',
    sequentialOrder: [
      `제외 공간 상시 유지: ${exemptSpaces}`,
      ...mainSequence,
      ...annexSequence,
      '특별실 및 강당은 예냉 후 유지운전',
    ],
    avoidCombinations: [
      `급식실 고전력 기기(${cafeteriaTime}) + 강당 EHP`,
      `특별실 집중 사용(${specialRoomTime}) + 본관 전체 EHP 동시 기동`,
      '하계 13:00 신규 냉방 기동 + 급식실 후처리 장비',
    ],
    exceptionConditions: [
      `${exemptSpaces}은 학생 수업환경과 안전을 위해 피크 제어 대상에서 제외합니다.`,
      '폭염·한파 특보, 시험, 행사, 보건상 필요 시 담당자 판단으로 예외 운전합니다.',
      '예외 운전은 시간과 사유를 메모해 다음 달 피크관리 계획에 반영합니다.',
    ],
    operatingWindows: [
      {
        label: '하계 최대부하',
        time: '11:00~12:00 · 13:00~17:00',
        tone: 'danger',
      },
      {
        label: '동계 최대부하',
        time: '10:00~12:00 · 17:00~20:00 · 22:00~23:00',
        tone: 'danger',
      },
      {
        label: '급식실 고전력 기기',
        time: cafeteriaTime,
        tone: 'warning',
      },
      {
        label: '특별실 집중 사용',
        time: specialRoomTime,
        tone: 'warning',
      },
      {
        label: '강당 예냉·유지운전',
        time: scenario.auditoriumCooling ? '12:30 예냉 · 이후 유지운전' : '행사 시간 확인',
        tone: 'neutral',
      },
    ],
  }
}
