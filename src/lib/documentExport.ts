import JSZip from 'jszip'
import type { DocumentBundle } from '../types'
import type { DocumentFileNames } from './downloadNames'

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
  filenames: DocumentFileNames,
): Promise<Blob> => {
  const zip = new JSZip()
  const [plan, letter, application] = await Promise.all([
    pdfFiles.plan.arrayBuffer(),
    pdfFiles.letter.arrayBuffer(),
    pdfFiles.application.arrayBuffer(),
  ])
  zip.file(filenames.planPdf, plan)
  zip.file(filenames.letterPdf, letter)
  zip.file(filenames.applicationPdf, application)
  zip.file(filenames.calculationSummary, bundle.calculationSummaryText)
  zip.file(
    filenames.calculationBreakdown,
    JSON.stringify(bundle.calculationBreakdown, null, 2),
  )
  zip.file(filenames.reviewItems, bundle.reviewItems.join('\n'))
  zip.file(
    filenames.applicationData,
    JSON.stringify(bundle.applicationPreviewData, null, 2),
  )
  return zip.generateAsync({ type: 'blob' })
}
