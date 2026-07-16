import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { DocumentBundle } from '../types'
import { createDocumentPackage } from './documentExport'

const bundle: DocumentBundle = {
  planText: '계획안',
  kepcoLetterText: '공문',
  applicationPreviewData: { 선택요금변경: '선택요금Ⅱ -> 선택요금Ⅰ' },
  checklist: [{ label: '변경신청서', ready: true }],
  calculationSummaryText: '계산 근거',
  calculationBreakdown: [
    {
      label: '최근 12개월 합계',
      currentWon: 100,
      candidateWon: 90,
      differenceWon: 10,
      note: '테스트',
    },
  ],
  reviewItems: ['한전 담당자 확인'],
}

describe('document package export', () => {
  it('includes all generated PDFs and supporting evidence files', async () => {
    const packageBlob = await createDocumentPackage(bundle, {
      plan: new Blob(['plan-pdf'], { type: 'application/pdf' }),
      letter: new Blob(['letter-pdf'], { type: 'application/pdf' }),
      application: new Blob(['application-pdf'], { type: 'application/pdf' }),
    })
    const zip = await JSZip.loadAsync(await packageBlob.arrayBuffer())
    const names = Object.keys(zip.files)

    expect(names).toEqual(
      expect.arrayContaining([
        '전기요금제_변경계획안.pdf',
        '한전_제출공문.pdf',
        '전기사용계약_변경신청서_미리보기.pdf',
        '계산근거_요약표.txt',
        '계산근거_분해표.json',
        '담당자_검토필요항목.txt',
        '변경신청서_자동입력항목.json',
      ]),
    )
    expect(names.some((name) => name.endsWith('변경계획안.txt'))).toBe(false)
    expect(await zip.file('한전_제출공문.pdf')?.async('string')).toBe('letter-pdf')
  })
})
