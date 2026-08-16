import { describe, expect, it } from 'vitest'
import type { BillInputCandidate } from '../components/bills/BillInputPreview'
import { defaultRatePlans } from '../data/ratePlans'
import {
  defaultScenario,
  defaultSchoolProfile,
  sampleBills,
} from '../data/sampleBills'
import { defaultCalculationSettings } from './calculationSettings'
import { buildAutoDiagnosis } from './diagnosis'
import {
  buildEasyDiagnosisDecision,
  buildEasyDiagnosisReview,
  getEasyDiagnosisProfileIssue,
} from './easyDiagnosis'

const candidate = (
  bills = sampleBills,
  origin: BillInputCandidate['origin'] = 'uploaded',
): BillInputCandidate => ({
  origin,
  bills,
  sourceLabel: '테스트 자료',
})

const diagnosis = buildAutoDiagnosis({
  bills: sampleBills,
  profile: defaultSchoolProfile,
  ratePlans: defaultRatePlans,
  scenario: defaultScenario,
  powerPlannerDataSource: null,
  billsAreUserUploaded: true,
  calculationSettings: defaultCalculationSettings,
})

describe('easy diagnosis readiness', () => {
  it('blocks eleven months and explains the twelve-month requirement', () => {
    const review = buildEasyDiagnosisReview(candidate(sampleBills.slice(-11)))

    expect(review.canContinue).toBe(false)
    expect(review.consecutiveMonthCount).toBe(11)
    expect(review.issues).toContain(
      '연속 12개월 자료가 필요합니다. 현재 11개월을 확인했습니다.',
    )
  })

  it('uses the latest twelve consecutive months from a longer source', () => {
    const review = buildEasyDiagnosisReview(candidate(sampleBills))

    expect(review.canContinue).toBe(true)
    expect(review.bills).toEqual(sampleBills.slice(-12))
    expect(review.periodLabel).toBe('2025년 8월 ~ 2026년 7월')
  })

  it('blocks a duplicate billing month with a concrete issue', () => {
    const duplicate = sampleBills.at(-1)
    if (!duplicate) throw new Error('sample bill missing')

    const review = buildEasyDiagnosisReview(
      candidate([...sampleBills.slice(-12), duplicate]),
    )

    expect(review.canContinue).toBe(false)
    expect(review.issues).toContain('2026-7 청구월이 중복되었습니다.')
  })

  it('requires positive applied power and an exact current tariff', () => {
    expect(
      getEasyDiagnosisProfileIssue(
        { ...defaultSchoolProfile, appliedPowerKw: 0 },
        defaultRatePlans,
      ),
    ).toBe('요금적용전력은 0보다 큰 값으로 입력해 주세요.')

    expect(
      getEasyDiagnosisProfileIssue(
        { ...defaultSchoolProfile, currentPlan: '존재하지 않는 요금제' },
        defaultRatePlans,
      ),
    ).toContain('일치하는 학교용 요금제')
  })
})

describe('easy diagnosis decision copy', () => {
  it.each([
    ['변경 추천', '선택요금Ⅰ으로 변경하세요'],
    ['유지 추천', '현재 선택요금Ⅱ를 유지하세요'],
    ['추가 검토 필요', '지금은 변경하지 마세요'],
  ] as const)('maps %s to the command %s', (finalJudgement, command) => {
    const decision = buildEasyDiagnosisDecision(
      { ...diagnosis, finalJudgement },
      { bills: 'uploaded', powerPlanner: 'none' },
    )

    expect(decision.command).toBe(command)
    expect(decision.cautions).toContain(
      '요금제 변경 신청은 원칙적으로 1년에 한 번만 가능하므로 예상 절감액과 향후 사용량을 신중히 검토하세요.',
    )
  })

  it('does not present sample bills as a real diagnosis result', () => {
    const decision = buildEasyDiagnosisDecision(diagnosis, {
      bills: 'sample',
      powerPlanner: 'none',
    })

    expect(decision.command).toBe('실제 12개월 자료를 먼저 넣어주세요')
    expect(decision.canAct).toBe(false)
  })
})
