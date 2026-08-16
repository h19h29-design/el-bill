import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { standardBillCsvHeaders } from '../lib/billInput'
import {
  externalAiPrivacyWarning,
  gptBillConversionPrompt,
  usageGuideSections,
} from './usageGuide'

describe('usage guide content', () => {
  it('preserves the approved GPT conversion prompt contract', () => {
    for (const header of standardBillCsvHeaders) {
      expect(gptBillConversionPrompt).toContain(header)
    }

    expect(gptBillConversionPrompt).toContain(
      '원본에 없는 값은 계산하거나 추측하지 마세요.',
    )
    expect(gptBillConversionPrompt).toContain(
      '같은 연도와 월이 중복되면 하나를 임의 선택하지 말고 검토사항에 기록합니다.',
    )
    expect(gptBillConversionPrompt).toContain(
      '선택 항목이 원본에 없으면 0으로 만들지 말고 빈칸으로 둡니다.',
    )
    expect(gptBillConversionPrompt).toContain(
      '학교명, 고객번호, 주소, 담당자 연락처, 계좌·납부정보는 CSV에 포함하지 않습니다.',
    )
  })

  it('matches the exact approved UTF-8 GPT prompt fixture', () => {
    expect(Buffer.byteLength(gptBillConversionPrompt, 'utf8')).toBe(1922)
    expect(
      createHash('sha256')
        .update(gptBillConversionPrompt, 'utf8')
        .digest('hex'),
    ).toBe('ca414ef9496f8bc7765c9596cc7ba3c699a3713405acbcf54bf739571247f4af')
  })

  it('keeps the browser-local deletion policy separate from external AI uploads', () => {
    expect(externalAiPrivacyWarning).toContain('브라우저 로컬')
    expect(externalAiPrivacyWarning).toContain('24시간')
    expect(externalAiPrivacyWarning).toContain('외부 AI 서비스')
    expect(externalAiPrivacyWarning).toContain('적용되지 않습니다')
  })

  it('lists the primary workflow and safety sections in order', () => {
    expect(usageGuideSections.map((section) => section.id)).toEqual([
      'easy-diagnosis',
      'file-upload',
      'paste-input',
      'manual-input',
      'gpt-csv',
      'power-planner',
      'diagnosis',
      'peak',
      'documents',
      'security',
      'rate-change',
    ])
  })
})
