import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardCopy, Download, Upload } from 'lucide-react'
import {
  externalAiPrivacyWarning,
  gptBillConversionPrompt,
  usageGuideSections,
} from '../../content/usageGuide'
import { createStandardBillCsv } from '../../lib/billInput'

interface UsageGuideProps {
  requestedSectionId?: string | null
  onOpenBills: () => void
}

const defaultSectionId = usageGuideSections[0].id

const resolveSectionId = (sectionId?: string | null) =>
  usageGuideSections.find((section) => section.id === sectionId)?.id ?? defaultSectionId

export function UsageGuide({ requestedSectionId, onOpenBills }: UsageGuideProps) {
  const [status, setStatus] = useState<{ id: number; message: string } | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string>(() => resolveSectionId(requestedSectionId))
  const statusInvocationId = useRef(0)
  const sectionHeadings = useRef<Record<string, HTMLHeadingElement | null>>({})

  const focusSection = useCallback((sectionId: string) => {
    const heading = sectionHeadings.current[sectionId]
    if (!heading) return
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
    heading.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!requestedSectionId) return
    const sectionId = resolveSectionId(requestedSectionId)
    setSelectedSectionId(sectionId)
    focusSection(sectionId)
  }, [focusSection, requestedSectionId])

  const announce = useCallback((message: string) => {
    statusInvocationId.current += 1
    setStatus({ id: statusInvocationId.current, message })
  }, [])

  const navigateToSection = useCallback((sectionId: string) => {
    setSelectedSectionId(sectionId)
    focusSection(sectionId)
  }, [focusSection])

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(gptBillConversionPrompt)
      announce('GPT 변환 프롬프트를 복사했습니다.')
    } catch {
      announce('프롬프트를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.')
    }
  }

  const handleDownloadTemplate = () => {
    let url: string | null = null
    try {
      const blob = new Blob([createStandardBillCsv()], { type: 'text/csv;charset=utf-8' })
      url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'el-bill-import.csv'
      link.click()
      announce('표준 CSV 양식 다운로드를 시작했습니다.')
    } catch {
      announce('CSV 양식을 만들지 못했습니다. 브라우저 설정을 확인해 주세요.')
    } finally {
      if (url) URL.revokeObjectURL(url)
    }
  }

  const sectionHeading = (id: string, title: string) => (
    <h3
      id={id}
      ref={(element) => { sectionHeadings.current[id] = element }}
      tabIndex={-1}
    >
      {title}
    </h3>
  )

  return (
    <div className="guide-layout">
      <aside className="guide-index" aria-label="사용 안내 목차">
        <strong>목차</strong>
        <nav aria-label="안내 항목">
          {usageGuideSections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(event) => {
                event.preventDefault()
                navigateToSection(section.id)
              }}
            >
              {section.title}
            </a>
          ))}
        </nav>
      </aside>

      <div className="guide-mobile-index">
        <label>
          안내 항목 선택
          <select
            value={selectedSectionId}
            onChange={(event) => setSelectedSectionId(event.target.value)}
          >
            {usageGuideSections.map((section) => (
              <option key={section.id} value={section.id}>{section.title}</option>
            ))}
          </select>
        </label>
        <button type="button" className="outline-action" onClick={() => focusSection(selectedSectionId)}>
          이동
        </button>
      </div>

      <div className="guide-content">
        <header className="guide-header">
          <h2>사용 방법 안내</h2>
          <p>자료 입력부터 결과 확인과 문서 생성까지, 실제 원본을 확인하며 순서대로 진행합니다.</p>
        </header>

        <section className="guide-section">
          {sectionHeading('file-upload', '파일을 그대로 올리기')}
          <ol>
            <li><strong>고지서 입력</strong>에서 <strong>파일 업로드</strong> 탭을 엽니다.</li>
            <li>한전 고지서 PDF, XLSX/CSV 또는 파워플래너 HTML 내보내기 <code>.xls</code>를 선택합니다.</li>
            <li>자동 인식 결과와 누락·중복 월을 확인한 뒤 <strong>이 데이터로 분석 시작</strong>을 선택합니다.</li>
          </ol>
          <p>PDF는 글자를 선택할 수 있는 한전 고지서와 이메일·인터넷 빌링 고지서를 브라우저에서 읽습니다. 청구 항목이 여러 쪽에 나뉘어 있어도 같은 청구월의 페이지를 결합합니다. 스캔 이미지형 PDF, 암호화된 PDF 또는 필수값을 찾지 못한 파일은 고지서 입력 화면의 무료 AI 변환 도우미를 사용하세요.</p>
          <p>다운로드 폴더 찾기는 Chrome 또는 Edge에서 사용자가 직접 폴더를 선택할 때만 동작합니다. 앱은 폴더를 자동으로 감시하거나 하위 폴더를 탐색하지 않습니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('paste-input', '표 복사·붙여넣기')}
          <ol>
            <li>Excel, Numbers, Google Sheets 또는 파워플래너 표에서 헤더와 월별 행을 함께 복사합니다.</li>
            <li><strong>표 붙여넣기</strong> 탭에 붙여넣고 인식 결과를 확인합니다.</li>
            <li>필수 컬럼인 연도, 월, 사용량, 총 전기요금을 확인하고 필요하면 컬럼 매핑을 수정합니다.</li>
          </ol>
          <p>붙여넣은 자료도 미리보기를 적용하기 전에는 현재 진단 데이터를 바꾸지 않으며, 최대 36행까지만 확인합니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('manual-input', '최근 12개월 직접 입력')}
          <ol>
            <li><strong>직접 입력</strong> 탭에서 마지막 청구월과 12개월 또는 36개월을 선택합니다.</li>
            <li>연월, 사용량(kWh), 총 전기요금(원)을 입력합니다.</li>
            <li>필요하면 최대수요전력과 상세 요금 항목을 추가한 뒤 미리보기를 적용합니다.</li>
          </ol>
          <p>직접 입력 초안은 분석에 쓰이지 않으며, 이 브라우저 로컬 저장소에서 최대 24시간만 보관됩니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('gpt-csv', 'GPT로 CSV 변환')}
          <p>스캔 PDF나 복잡한 자료는 아래 프롬프트를 ChatGPT 또는 Gemini 무료 화면에 넣어 표준 CSV로 만듭니다. 같은 도구를 <strong>고지서 입력</strong>의 첫 파일 업로드 화면에서도 바로 사용할 수 있습니다. 변환 결과는 한전 원본으로 취급하지 않으므로 앱의 미리보기와 누락·중복 검사를 확인한 뒤 적용합니다.</p>
          <div className="guide-action-feedback">
            <div className="guide-actions" role="group" aria-label="GPT 변환 도구">
              <button type="button" className="outline-action" aria-describedby="guide-action-status" onClick={() => void handleCopyPrompt()}>
                <ClipboardCopy size={17} aria-hidden="true" />
                GPT 변환 프롬프트 복사
              </button>
              <button type="button" className="outline-action" aria-describedby="guide-action-status" onClick={handleDownloadTemplate}>
                <Download size={17} aria-hidden="true" />
                표준 CSV 양식 다운로드
              </button>
              <button type="button" className="primary-button" onClick={onOpenBills}>
                <Upload size={17} aria-hidden="true" />
                변환 결과 업로드
              </button>
            </div>
            <p id="guide-action-status" className="guide-action-status" role="status" aria-live="polite" aria-atomic="true">
              {status && <span key={status.id} data-invocation-id={status.id}>{status.message}</span>}
            </p>
          </div>
          <p className="guide-warning"><strong>외부 AI 서비스 주의</strong>{externalAiPrivacyWarning}</p>
          <pre className="guide-prompt" aria-label="GPT 변환 프롬프트">{gptBillConversionPrompt}</pre>
        </section>

        <section className="guide-section">
          {sectionHeading('power-planner', '파워플래너에서 자료 내려받기')}
          <ol>
            <li>한전 파워플래너에서 월별·일별·시간대별 자료 또는 최대수요전력 자료를 직접 내려받습니다.</li>
            <li><strong>파워플래너</strong> 메뉴에서 파일 유형과 컬럼을 확인한 뒤 보조 분석 자료로 적용합니다.</li>
            <li>월별청구요금 HTML <code>.xls</code>는 <strong>고지서 입력</strong>에서도 월별 고지서로 인식할 수 있습니다.</li>
          </ol>
          <p>이 앱은 한전 계정 자동 로그인, 크롤링, 비공식 API 호출을 하지 않습니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('diagnosis', '자동진단 결과 확인')}
          <p>최근 12개월의 연속성, 현재 계약조건과 요금표 일치 여부, 후보별 차액과 검토 항목을 확인합니다. 결과는 공식 청구액 계산기가 아닌 <strong>내부 진단용 추정</strong>이므로 실제 청구서와 담당자 검토를 함께 사용해야 합니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('peak', '피크관리 방안 확인')}
          <p>목표 피크와 예상 피크를 입력해 위험도를 확인하고, 본관·별관 EHP와 급식실·강당·특별실의 동시 가동을 줄이는 운영안을 검토합니다. 파워플래너 시간대 자료가 있으면 최대부하 시간대 판단을 보강합니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('documents', '변경신청 문서 생성')}
          <p>최근 12개월 자료와 현재 계약조건이 확인되어 변경 추천이 나온 경우에만 내부 계획안, 한전 제출 공문, 신청서 미리보기와 검토 항목을 생성합니다. 신청서 미리보기는 한전 공식 양식이 아니며 실제 제출 전 담당자 검토가 필요합니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('security', '데이터 보안과 24시간 삭제')}
          <p>고지서 입력, 직접 입력 초안, 적용한 분석 자료는 이 브라우저 로컬 저장소에만 보관하고 최대 24시간 후 삭제합니다. 서버로 원본 파일이나 수기 입력을 전송하지 않습니다.</p>
          <p>{externalAiPrivacyWarning}</p>
          <p>개인 사용자는 공식 API 자동연동을 기본 제공받지 않으며, 기관 또는 서비스 사업자 승인이 있을 때만 연동할 수 있습니다. 이 앱은 개인 EDS 자동연동이나 발급되지 않은 키의 연결 완료 상태를 제공하지 않습니다.</p>
        </section>

        <section className="guide-section">
          {sectionHeading('rate-change', '요금제 변경 신중 검토')}
          <p>요금제 변경 신청은 원칙적으로 1년에 한 번만 가능하므로 예상 절감액, 피크 시나리오, 향후 사용량 변동과 실제 계약조건을 신중히 검토한 뒤 진행하세요.</p>
        </section>
      </div>

    </div>
  )
}
