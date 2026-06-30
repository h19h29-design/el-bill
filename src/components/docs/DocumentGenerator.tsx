import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCopy, Download, Eye, FileArchive } from 'lucide-react'
import JSZip from 'jszip'
import type {
  MonthlyBill,
  PeakScenario,
  PlanComparison,
  SchoolProfile,
} from '../../types'
import { buildDocumentBundle, rateChangeCaution } from '../../lib/documentTemplates'

interface DocumentGeneratorProps {
  profile: SchoolProfile
  latestBill: MonthlyBill | undefined
  comparison: PlanComparison
  scenario: PeakScenario
}

const copyText = async (text: string) => {
  await navigator.clipboard.writeText(text)
}

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function DocumentGenerator({
  profile,
  latestBill,
  comparison,
  scenario,
}: DocumentGeneratorProps) {
  const [selectedPreview, setSelectedPreview] = useState<'plan' | 'letter' | 'application'>('plan')
  const [status, setStatus] = useState('')
  const bundle = useMemo(
    () => buildDocumentBundle(profile, latestBill, comparison, scenario),
    [profile, latestBill, comparison, scenario],
  )

  const downloadPdf = async (targetId: string, filename: string) => {
    const element = document.getElementById(targetId)
    if (!element) return
    const wasVisible = element.classList.contains('visible')
    element.classList.add('visible')
    const html2pdf = (await import('html2pdf.js')).default
    try {
      await html2pdf()
        .set({
          margin: 10,
          filename,
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(element)
        .save(filename)
    } finally {
      if (!wasVisible) element.classList.remove('visible')
    }
    setStatus(`${filename} 다운로드를 시작했습니다.`)
  }

  const downloadZip = async () => {
    const zip = new JSZip()
    zip.file('전기요금제_변경계획안.txt', bundle.planText)
    zip.file('한전_제출공문.txt', bundle.kepcoLetterText)
    zip.file(
      '변경신청서_자동입력항목.json',
      JSON.stringify(bundle.applicationPreviewData, null, 2),
    )
    const blob = await zip.generateAsync({ type: 'blob' })
    saveBlob(blob, 'A고등학교_전기요금_변경_문서묶음.zip')
    setStatus('문서 묶음 ZIP 다운로드를 시작했습니다.')
  }

  const selectedId =
    selectedPreview === 'plan'
      ? 'plan-preview'
      : selectedPreview === 'letter'
        ? 'letter-preview'
        : 'application-preview'

  return (
    <div className="view-stack">
      <section className="document-grid">
        <article className="document-card">
          <h2>전기요금제 변경 계획(안)</h2>
          <div className="paper-mini">
            <span />
            <strong>예산절감 계획</strong>
            <p>요금제 비교·추진일정·기대효과</p>
          </div>
          <div className="document-actions">
            <button type="button" onClick={() => setSelectedPreview('plan')}>
              <Eye size={16} /> PDF 미리보기
            </button>
            <button
              type="button"
              onClick={() => void copyText(bundle.planText).then(() => setStatus('계획안 문안을 복사했습니다.'))}
            >
              <ClipboardCopy size={16} /> 문안 복사
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf('plan-preview', '전기요금제_변경계획안.pdf')}
            >
              <Download size={16} /> 다운로드
            </button>
          </div>
        </article>

        <article className="document-card">
          <h2>한전 제출 공문</h2>
          <div className="paper-mini stamped">
            <span />
            <strong>전기요금 변경 신청</strong>
            <p>수신·관련근거·붙임 목록</p>
          </div>
          <div className="document-actions">
            <button type="button" onClick={() => setSelectedPreview('letter')}>
              <Eye size={16} /> PDF 미리보기
            </button>
            <button
              type="button"
              onClick={() => void copyText(bundle.kepcoLetterText).then(() => setStatus('공문 문안을 복사했습니다.'))}
            >
              <ClipboardCopy size={16} /> 문안 복사
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf('letter-preview', '한전_제출공문.pdf')}
            >
              <Download size={16} /> 다운로드
            </button>
          </div>
        </article>

        <article className="document-card">
          <h2>전기사용계약 변경신청서</h2>
          <div className="paper-mini form">
            <span />
            <strong>자동 입력 항목</strong>
            <p>수기 확인 필요 항목 표시</p>
          </div>
          <div className="document-actions">
            <button type="button" onClick={() => setSelectedPreview('application')}>
              <Eye size={16} /> PDF 미리보기
            </button>
            <button
              type="button"
              onClick={() =>
                void copyText(JSON.stringify(bundle.applicationPreviewData, null, 2)).then(() =>
                  setStatus('신청서 자동입력 항목을 복사했습니다.'),
                )
              }
            >
              <ClipboardCopy size={16} /> 문안 복사
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf('application-preview', '전기사용계약_변경신청서_미리보기.pdf')}
            >
              <Download size={16} /> 다운로드
            </button>
          </div>
        </article>

        <article className="checklist-card">
          <h2>붙임 체크리스트</h2>
          <ul className="check-list">
            {bundle.checklist.map((item) => (
              <li key={item.label}>
                <CheckCircle2 size={18} />
                {item.label}
              </li>
            ))}
          </ul>
          <button type="button" className="outline-download" onClick={() => void downloadZip()}>
            <FileArchive size={16} />
            전체 다운로드 (ZIP)
          </button>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>PDF 미리보기</h2>
          <span>실제 제출 전 담당자 검토 필요</span>
        </div>
        <div className="preview-switch">
          {[
            ['plan', '계획안'],
            ['letter', '한전 공문'],
            ['application', '변경신청서'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={selectedPreview === key ? 'active' : ''}
              onClick={() => setSelectedPreview(key as typeof selectedPreview)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="document-preview-stage">
          <div
            id="plan-preview"
            className={selectedId === 'plan-preview' ? 'document-preview visible' : 'document-preview'}
          >
            {bundle.planText.split('\n').map((line, index) =>
              line ? <p key={`${line}-${index}`}>{line}</p> : <br key={index} />,
            )}
            <footer>{rateChangeCaution} 실제 제출 전 담당자 검토 필요.</footer>
          </div>
          <div
            id="letter-preview"
            className={selectedId === 'letter-preview' ? 'document-preview visible' : 'document-preview'}
          >
            {bundle.kepcoLetterText.split('\n').map((line, index) =>
              line ? <p key={`${line}-${index}`}>{line}</p> : <br key={index} />,
            )}
          </div>
          <div
            id="application-preview"
            className={selectedId === 'application-preview' ? 'document-preview visible' : 'document-preview'}
          >
            <h3>전기사용계약 변경신청서 PDF 미리보기</h3>
            <table>
              <tbody>
                {Object.entries(bundle.applicationPreviewData).map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer>{rateChangeCaution} 서명, 직인, 개인정보동의는 수기 확인 필요.</footer>
          </div>
        </div>
        {status && <p className="status-line">{status}</p>}
      </section>
    </div>
  )
}
