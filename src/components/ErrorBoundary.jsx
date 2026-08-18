import { Component } from 'react'
import { PaceMark } from './Skeleton'

// Catches render-time errors anywhere below it (e.g. an unexpected
// Firebase payload shape) so the whole app doesn't white-screen with no
// way back — shows a calm recovery screen with a reload action instead.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Pace crashed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-svh flex flex-col items-center justify-center px-8 text-center gap-6">
          <PaceMark size={48} spinning={false} />
          <div>
            <div className="text-base font-semibold mb-1.5">Something went wrong</div>
            <p className="text-xs text-text-faint max-w-xs">
              Pace hit an unexpected error. Reloading usually fixes it — your data is safe.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-accent text-bg text-sm font-medium tracking-wide rounded-xl px-6 py-3 active:scale-[0.98] transition-transform"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
