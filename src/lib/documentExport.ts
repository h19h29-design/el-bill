import JSZip from 'jszip'
import type { DocumentBundle } from '../types'

export interface DocumentPdfFiles {
  plan: Blob
  letter: Blob
  application: Blob
}

const pdfOptions = {
  margin: [10, 10, 10, 10],
  image: { type: 'jpeg', quality: 0.98 },
  html2canvas: {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
  },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  pagebreak: {
    mode: ['css', 'legacy'],
    avoid: ['p', 'tr', 'footer', '.doc-alert', '.doc-masthead'],
  },
}

export const createPdfBlob = async (element: HTMLElement): Promise<Blob> => {
  const wasVisible = element.classList.contains('visible')
  element.classList.add('visible', 'export-rendering')
  const html2pdf = (await import('html2pdf.js')).default

  try {
    return await html2pdf()
      .set(pdfOptions)
      .from(element)
      .outputPdf('blob')
  } finally {
    element.classList.remove('export-rendering')
    if (!wasVisible) element.classList.remove('visible')
  }
}

export const createDocumentPackage = async (
  bundle: DocumentBundle,
  pdfFiles: DocumentPdfFiles,
): Promise<Blob> => {
  const zip = new JSZip()
  const [plan, letter, application] = await Promise.all([
    pdfFiles.plan.arrayBuffer(),
    pdfFiles.letter.arrayBuffer(),
    pdfFiles.application.arrayBuffer(),
  ])
  zip.file('전기요금제_변경계획안.pdf', plan)
  zip.file('한전_제출공문.pdf', letter)
  zip.file('전기사용계약_변경신청서_미리보기.pdf', application)
  zip.file('계산근거_요약표.txt', bundle.calculationSummaryText)
  zip.file(
    '계산근거_분해표.json',
    JSON.stringify(bundle.calculationBreakdown, null, 2),
  )
  zip.file('담당자_검토필요항목.txt', bundle.reviewItems.join('\n'))
  zip.file(
    '변경신청서_자동입력항목.json',
    JSON.stringify(bundle.applicationPreviewData, null, 2),
  )
  return zip.generateAsync({ type: 'blob' })
}
