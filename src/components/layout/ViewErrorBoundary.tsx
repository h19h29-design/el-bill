import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface ViewErrorBoundaryProps {
  children: ReactNode
  onReload?: () => void
}

interface ViewErrorBoundaryState {
  hasError: boolean
}

export class ViewErrorBoundary extends Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  state: ViewErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ViewErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // The recovery panel intentionally avoids exposing technical error details.
  }

  private reloadView = () => {
    if (this.props.onReload) {
      this.props.onReload()
      this.setState({ hasError: false })
      return
    }

    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="view-error" role="alert">
          <TriangleAlert size={28} />
          <div>
            <h3>화면을 불러오지 못했습니다.</h3>
            <p>네트워크 상태를 확인한 뒤 페이지를 새로고침해 다시 시도해 주세요.</p>
          </div>
          <button type="button" onClick={this.reloadView}>
            <RefreshCw size={16} /> 페이지 새로고침
          </button>
        </section>
      )
    }

    return this.props.children
  }
}
