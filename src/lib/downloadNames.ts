export const sanitizeDownloadStem = (value: string) => {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\.+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const isReservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)
  return sanitized && !isReservedWindowsName ? sanitized : '학교'
}

export interface DocumentFileNames {
  planPdf: string
  letterPdf: string
  applicationPdf: string
  calculationSummary: string
  calculationBreakdown: string
  reviewItems: string
  applicationData: string
  zip: string
}

export const getDocumentFileNames = (displaySchoolName: string): DocumentFileNames => {
  const stem = sanitizeDownloadStem(displaySchoolName)
  return {
    planPdf: `${stem}_전기요금제_변경계획안.pdf`,
    letterPdf: `${stem}_한전_제출공문.pdf`,
    applicationPdf: `${stem}_전기사용계약_변경신청서_미리보기.pdf`,
    calculationSummary: `${stem}_계산근거_요약표.txt`,
    calculationBreakdown: `${stem}_계산근거_분해표.json`,
    reviewItems: `${stem}_담당자_검토필요항목.txt`,
    applicationData: `${stem}_변경신청서_자동입력항목.json`,
    zip: `${stem}_전기요금_변경_문서묶음.zip`,
  }
}
