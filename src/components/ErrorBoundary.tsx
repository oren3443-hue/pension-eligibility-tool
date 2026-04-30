import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" dir="rtl">
          <div className="error-card">
            <h1>אירעה שגיאה לא צפויה</h1>
            <p>האפליקציה נתקלה בבעיה ולא יכולה להמשיך. נסו לטעון מחדש את הדף.</p>
            {this.state.error && (
              <details>
                <summary>פרטים טכניים</summary>
                <pre>{this.state.error.message}</pre>
              </details>
            )}
            <button type="button" onClick={this.handleReload}>
              טעינה מחדש
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
