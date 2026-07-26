import { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  Eye,
  FileArchive,
  ShieldAlert,
} from 'lucide-react'
import type {
  AutoDiagnosisResult,
  MonthlyBill,
  PeakScenario,
  PlanComparison,
  SchoolProfile,
} from '../../types'
import { buildDocumentBundle, rateChangeCaution } from '../../lib/documentTemplates'
import {
  createDocumentPackage,
  createPdfBlob,
} from '../../lib/documentExport'
import { getDocumentFileNames } from '../../lib/downloadNames'
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

const renderTextDocument = (title: string, body: string, displaySchoolName: string) => {
  const [, ...rest] = body.split('\n')
  return (
    <>
      <div className="doc-masthead">
        <span>서울특별시교육청 전기요금 진단 자료</span>
        <strong>{displaySchoolName}</strong>
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
  const documentDisplayName = profile.displaySchoolName.trim() || '학교'
  const documentProfile = useMemo(
    () => ({ ...profile, displaySchoolName: documentDisplayName }),
    [documentDisplayName, profile],
  )
  const documentsUnavailable =
    diagnosis.configurationRequired ||
    !diagnosis.currentPlan ||
    !diagnosis.recommendedPlan ||
    !diagnosis.comparison.annualDataAvailable ||
    diagnosis.documentBlockReason.includes('고지서 기간 문제')
  const bundle = useMemo(
    () =>
      documentsUnavailable
        ? null
        : buildDocumentBundle(
            documentProfile,
            latestBill,
            comparison,
            scenario,
            diagnosis,
            peakOperationPlan,
          ),
    [
      documentsUnavailable,
      documentProfile,
      latestBill,
      comparison,
      scenario,
      diagnosis,
      peakOperationPlan,
    ],
  )
  const canGenerateChangeDocuments = diagnosis.canGenerateChangeDocuments
  const documentFileNames = getDocumentFileNames(profile.displaySchoolName)

  const copyDocumentText = async (text: string, successMessage: string) => {
    if (!canGenerateChangeDocuments) {
      setStatus(diagnosis.documentBlockReason)
      return
    }
    await copyText(text)
    setStatus(successMessage)
  }

  if (!bundle) {
    return (
      <div className="view-stack">
        <section className="document-block-notice" role="status">
          <ShieldAlert size={22} />
          <div>
            <strong>변경신청 문서 생성 보류</strong>
            <p>{diagnosis.documentBlockReason}</p>
          </div>
        </section>
      </div>
    )
  }

  const downloadPdf = async (targetId: string, filename: string) => {
    if (!canGenerateChangeDocuments) {
      setStatus(diagnosis.documentBlockReason)
      return
    }
    const element = document.getElementById(targetId)
    if (!element) return
    setStatus(`${filename} 생성 중입니다.`)
    try {
      const blob = await createPdfBlob(element)
      saveBlob(blob, filename)
      setStatus(`${filename} 다운로드를 시작했습니다.`)
    } catch {
      setStatus(`${filename} 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.`)
    }
  }

  const downloadZip = async () => {
    if (!canGenerateChangeDocuments) {
      setStatus(diagnosis.documentBlockReason)
      return
    }
    const plan = document.getElementById('plan-preview')
    const letter = document.getElementById('letter-preview')
    const application = document.getElementById('application-preview')
    if (!plan || !letter || !application) return

    setStatus('PDF 3종과 검토 자료를 묶는 중입니다.')
    try {
      const planPdf = await createPdfBlob(plan)
      const letterPdf = await createPdfBlob(letter)
      const applicationPdf = await createPdfBlob(application)
      const blob = await createDocumentPackage(bundle, {
        plan: planPdf,
        letter: letterPdf,
        application: applicationPdf,
      }, documentFileNames)
      saveBlob(blob, documentFileNames.zip)
      setStatus('PDF 3종이 포함된 문서 묶음 ZIP 다운로드를 시작했습니다.')
    } catch {
      setStatus('문서 묶음 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  const selectedId =
    selectedPreview === 'plan'
      ? 'plan-preview'
      : selectedPreview === 'letter'
        ? 'letter-preview'
        : 'application-preview'

  return (
    <div className="view-stack">
      {!canGenerateChangeDocuments && (
        <section className="document-block-notice" role="status">
          <ShieldAlert size={22} />
          <div>
            <strong>변경신청 문서 생성 보류</strong>
            <p>{diagnosis.documentBlockReason}</p>
          </div>
        </section>
      )}
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
              disabled={!canGenerateChangeDocuments}
              onClick={() => void copyDocumentText(bundle.planText, '계획안 문안을 복사했습니다.')}
            >
              <ClipboardCopy size={16} /> 문안 복사
            </button>
            <button
              type="button"
              disabled={!canGenerateChangeDocuments}
              onClick={() => void downloadPdf('plan-preview', documentFileNames.planPdf)}
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
              disabled={!canGenerateChangeDocuments}
              onClick={() => void copyDocumentText(bundle.kepcoLetterText, '공문 문안을 복사했습니다.')}
            >
              <ClipboardCopy size={16} /> 문안 복사
            </button>
            <button
              type="button"
              disabled={!canGenerateChangeDocuments}
              onClick={() => void downloadPdf('letter-preview', documentFileNames.letterPdf)}
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
              disabled={!canGenerateChangeDocuments}
              onClick={() =>
                void copyDocumentText(
                  JSON.stringify(bundle.applicationPreviewData, null, 2),
                  '신청서 자동입력 항목을 복사했습니다.',
                )
              }
            >
              <ClipboardCopy size={16} /> 문안 복사
            </button>
            <button
              type="button"
              disabled={!canGenerateChangeDocuments}
              onClick={() => void downloadPdf('application-preview', documentFileNames.applicationPdf)}
            >
              <Download size={16} /> 다운로드
            </button>
          </div>
        </article>

        <article className="checklist-card">
          <h2>붙임 체크리스트</h2>
          <ul className="check-list">
            {bundle.checklist.map((item) => (
              <li key={item.label} className={item.ready ? 'ready' : 'pending'}>
                {item.ready ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                <span>{item.label}</span>
                <em>{item.ready ? '준비됨' : '첨부 확인'}</em>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="outline-download"
            disabled={!canGenerateChangeDocuments}
            onClick={() => void downloadZip()}
          >
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
        <p className="mobile-scroll-hint">
          문서를 좌우로 밀어 원본 크기로 확인하세요.
        </p>
        <div className="document-preview-stage">
          <div
            id="plan-preview"
            className={selectedId === 'plan-preview' ? 'document-preview official-document visible' : 'document-preview official-document'}
          >
            {renderTextDocument(
              '예산절감을 위한 전기요금제 변경 계획(안)',
              bundle.planText,
              documentDisplayName,
            )}
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
            {renderTextDocument(
              `${documentDisplayName} 전기요금 변경 신청`,
              bundle.kepcoLetterText,
              documentDisplayName,
            )}
            <footer>{rateChangeCaution} 붙임 서류와 원본 청구서 대조 후 제출.</footer>
          </div>
          <div
            id="application-preview"
            className={selectedId === 'application-preview' ? 'document-preview application-document visible' : 'document-preview application-document'}
          >
            <div className="doc-masthead">
              <span>서울특별시교육청 전기요금 진단 자료</span>
              <strong>{documentDisplayName}</strong>
            </div>
            <h3>전기사용계약 변경신청서 PDF 미리보기</h3>
            <div className="doc-alert">
              한전 공식 신청서가 아닌 작성 참고용 미리보기입니다.
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
