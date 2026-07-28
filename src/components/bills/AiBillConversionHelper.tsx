import { useState } from 'react'
import {
  ClipboardCopy,
  ClipboardPaste,
  Download,
  Sparkles,
} from 'lucide-react'
import {
  externalAiPrivacyWarning,
  gptBillConversionPrompt,
} from '../../content/usageGuide'
import { createStandardBillCsv } from '../../lib/billInput'

interface AiBillConversionHelperProps {
  onOpenPaste: () => void
}

export function AiBillConversionHelper({
  onOpenPaste,
}: AiBillConversionHelperProps) {
  const [status, setStatus] = useState('')

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(gptBillConversionPrompt)
      setStatus('무료 AI용 변환 프롬프트를 복사했습니다.')
    } catch {
      setStatus('프롬프트를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.')
    }
  }

  const downloadTemplate = () => {
    let url: string | null = null
    try {
      const blob = new Blob([createStandardBillCsv()], {
        type: 'text/csv;charset=utf-8',
      })
      url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'el-bill-import.csv'
      link.click()
      setStatus('표준 CSV 양식 다운로드를 시작했습니다.')
    } catch {
      setStatus('CSV 양식을 만들지 못했습니다. 브라우저 설정을 확인해 주세요.')
    } finally {
      if (url) URL.revokeObjectURL(url)
    }
  }

  return (
    <section className="panel ai-conversion-panel" aria-labelledby="ai-conversion-title">
      <div className="ai-conversion-heading">
        <Sparkles size={22} aria-hidden="true" />
        <div>
          <h2 id="ai-conversion-title">무료 AI로 고지서 변환</h2>
          <p>
            자동 인식이 어려우면 ChatGPT 또는 Gemini 무료 화면에 고지서와
            변환 프롬프트를 함께 넣어 앱 표준 CSV로 바꿀 수 있습니다.
          </p>
        </div>
      </div>
      <ol className="ai-conversion-steps">
        <li>고지서에서 고객번호·주소·담당자·계좌 정보를 가립니다.</li>
        <li>프롬프트를 복사해 무료 AI에 고지서와 함께 입력합니다.</li>
        <li>AI가 만든 CSV를 내려받거나 붙여넣어 미리보기를 확인합니다.</li>
      </ol>
      <div className="ai-conversion-actions" role="group" aria-label="무료 AI 변환 도구">
        <button
          type="button"
          className="outline-action"
          onClick={() => void copyPrompt()}
        >
          <ClipboardCopy size={17} aria-hidden="true" />
          무료 AI 변환 프롬프트 복사
        </button>
        <button
          type="button"
          className="outline-action"
          onClick={downloadTemplate}
        >
          <Download size={17} aria-hidden="true" />
          표준 CSV 양식 다운로드
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={onOpenPaste}
        >
          <ClipboardPaste size={17} aria-hidden="true" />
          AI 변환 결과 붙여넣기
        </button>
      </div>
      <p className="ai-conversion-status" role="status" aria-live="polite">
        {status}
      </p>
      <p className="ai-conversion-warning">{externalAiPrivacyWarning}</p>
    </section>
  )
}
