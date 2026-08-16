import {
  ClipboardPaste,
  FileSpreadsheet,
  FileText,
  Keyboard,
} from 'lucide-react'
import type { EasyDiagnosisSource } from '../../lib/easyDiagnosis'

interface EasyDiagnosisSourceStepProps {
  onSelect: (source: EasyDiagnosisSource) => void
}

const sources = [
  {
    id: 'pdf',
    title: '고지서 PDF',
    description: '한전 전기요금 청구서 PDF 12개월분',
    icon: FileText,
  },
  {
    id: 'table',
    title: '요금 정리표',
    description: '학교에서 정리한 12개월 XLSX 또는 CSV',
    icon: FileSpreadsheet,
  },
  {
    id: 'paste',
    title: '표 붙여넣기',
    description: 'Excel이나 무료 AI가 만든 표를 그대로 붙여넣기',
    icon: ClipboardPaste,
  },
  {
    id: 'manual',
    title: '직접 입력',
    description: '월별 사용량과 총 전기요금만 12줄 입력',
    icon: Keyboard,
  },
] as const

export function EasyDiagnosisSourceStep({
  onSelect,
}: EasyDiagnosisSourceStepProps) {
  return (
    <section className="easy-diagnosis-page" aria-labelledby="easy-source-title">
      <div className="easy-diagnosis-page-heading">
        <span>1단계</span>
        <h2 id="easy-source-title">어떤 자료를 가지고 계신가요?</h2>
        <p>가장 편한 방법 하나만 선택하세요. 원본은 서버로 전송하지 않고 이 브라우저에서 읽습니다.</p>
      </div>
      <div className="easy-source-grid">
        {sources.map(({ id, title, description, icon: Icon }) => (
          <button key={id} type="button" onClick={() => onSelect(id)}>
            <span className="easy-source-icon" aria-hidden="true">
              <Icon size={25} />
            </span>
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <p className="easy-diagnosis-requirement">
        연속된 12개월 자료가 있어야 진단할 수 있습니다.
      </p>
    </section>
  )
}
