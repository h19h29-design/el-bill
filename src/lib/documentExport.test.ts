import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { DocumentBundle } from '../types'
import { getDocumentFileNames } from './downloadNames'
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
    const filenames = getDocumentFileNames('테스트/고등학교')
    const packageBlob = await createDocumentPackage(bundle, {
      plan: new Blob(['plan-pdf'], { type: 'application/pdf' }),
      letter: new Blob(['letter-pdf'], { type: 'application/pdf' }),
      application: new Blob(['application-pdf'], { type: 'application/pdf' }),
    }, filenames)
    const zip = await JSZip.loadAsync(await packageBlob.arrayBuffer())
    const names = Object.keys(zip.files)

    expect(names).toEqual(
      expect.arrayContaining([
        filenames.planPdf,
        filenames.letterPdf,
        filenames.applicationPdf,
        filenames.calculationSummary,
        filenames.calculationBreakdown,
        filenames.reviewItems,
        filenames.applicationData,
      ]),
    )
    expect(names.every((name) => name.startsWith('테스트 고등학교_'))).toBe(true)
    expect(await zip.file(filenames.letterPdf)?.async('string')).toBe('letter-pdf')
  })
})
