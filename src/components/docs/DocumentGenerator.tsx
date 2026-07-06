import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCopy, Download, Eye, FileArchive } from 'lucide-react'
import JSZip from 'jszip'
import type {
  AutoDiagnosisResult,
  MonthlyBill,
  PeakScenario,
  PlanComparison,
  SchoolProfile,
} from '../../types'
import { buildDocumentBundle, rateChangeCaution } from '../../lib/documentTemplates'
import type { PeakOperationPlan } from '../../lib/peakOperations'

interface DocumentGeneratorProps {
  profile: SchoolProfile
  latestBill: MonthlyBill | undefined
  comparison: PlanComparison
  scenario: PeakScenario
  diagnosis: AutoDiagnosisResult
  peakOperationPlan: PeakOperationPlan
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

const renderTextDocument = (title: string, body: string) => {
  const [, ...rest] = body.split('\n')
  return (
    <>
      <div className="doc-masthead">
        <span>서울특별시교육청 전기요금 진단 자료</span>
        <strong>A고등학교</strong>
      </div>
      <h3>{title}</h3>
      <div className="doc-alert">
        공식 청구액 계산기가 아닌 학교 내부 진단용 추정입니다.
      </div>
      {rest.map((line, index) =>
        line ? <p key={`${line}-${index}`}>{line}</p> : <br key={index} />,
      )}
    </>
  )
}

export function DocumentGenerator({
  profile,
  latestBill,
  comparison,
  scenario,
  diagnosis,
  peakOperationPlan,
}: DocumentGeneratorProps) {
  const [selectedPreview, setSelectedPreview] = useState<'plan' | 'letter' | 'application'>('plan')
  const [status, setStatus] = useState('')
  const bundle = useMemo(
    () =>
      buildDocumentBundle(
        profile,
        latestBill,
        comparison,
        scenario,
        diagnosis,
        peakOperationPlan,
      ),
    [profile, latestBill, comparison, scenario, diagnosis, peakOperationPlan],
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

        <article className="checklist-card">
          <h2>계산 근거 요약표</h2>
          <p className="mini-document-text">{bundle.calculationSummaryText}</p>
        </article>

        <article className="checklist-card">
          <h2>계산 근거 분해표</h2>
          <div className="document-breakdown-mini">
            {bundle.calculationBreakdown.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <strong>{row.differenceWon.toLocaleString('ko-KR')}원</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="checklist-card">
          <h2>담당자 검토 필요 항목</h2>
          <ul className="check-list">
            {bundle.reviewItems.map((item) => (
              <li key={item}>
                <CheckCircle2 size={18} />
                {item}
              </li>
            ))}
          </ul>
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
            className={selectedId === 'plan-preview' ? 'document-preview official-document visible' : 'document-preview official-document'}
          >
            {renderTextDocument('예산절감을 위한 전기요금제 변경 계획(안)', bundle.planText)}
            <table className="document-summary-table">
              <tbody>
                {bundle.calculationBreakdown.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>현재 {row.currentWon.toLocaleString('ko-KR')}원</td>
                    <td>추천 {row.candidateWon.toLocaleString('ko-KR')}원</td>
                    <td>차액 {row.differenceWon.toLocaleString('ko-KR')}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer>{rateChangeCaution} 실제 제출 전 담당자 검토 필요.</footer>
          </div>
          <div
            id="letter-preview"
            className={selectedId === 'letter-preview' ? 'document-preview official-document visible' : 'document-preview official-document'}
          >
            {renderTextDocument(`${profile.displaySchoolName} 전기요금 변경 신청`, bundle.kepcoLetterText)}
            <footer>{rateChangeCaution} 붙임 서류와 원본 청구서 대조 후 제출.</footer>
          </div>
          <div
            id="application-preview"
            className={selectedId === 'application-preview' ? 'document-preview application-document visible' : 'document-preview application-document'}
          >
            <h3>전기사용계약 변경신청서 PDF 미리보기</h3>
            <div className="doc-alert">
              자동 입력 가능 항목과 수기 확인 필요 항목을 구분했습니다.
            </div>
            <table>
              <tbody>
                {Object.entries(bundle.applicationPreviewData).map(([key, value]) => (
                  <tr
                    key={key}
                    className={
                      value.includes('수기') || key.includes('서명') || key.includes('동의')
                        ? 'manual-check-row'
                        : ''
                    }
                  >
                    <th>{key}</th>
                    <td>
                      <span>{value}</span>
                      {(value.includes('수기') ||
                        key.includes('서명') ||
                        key.includes('동의')) && (
                        <em>수기 확인</em>
                      )}
                    </td>
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
