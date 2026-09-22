import React from 'react'
import ReactDOM from 'react-dom/client'
import '@mantine/core/styles.css'
import './styles.css'
import { MantineProvider } from '@mantine/core'
import { App } from './App'
import { theme } from './theme'

const reportRendererError = (
  kind: string,
  error: unknown,
  componentStack?: string,
): void => {
  const details = error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: String(error) }
  window.desktop?.diagnostics.reportRendererError({
    kind,
    ...details,
    componentStack,
    url: window.location.href,
  })
}

window.addEventListener('error', (event) => {
  reportRendererError('window.error', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('window.unhandledrejection', event.reason)
})

class AppCrashBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null; logPath: string | null }
> {
  state: { error: string | null; logPath: string | null } = { error: null, logPath: null }

  static getDerivedStateFromError(error: unknown): { error: string; logPath: null } {
    return { error: error instanceof Error ? error.message : String(error), logPath: null }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportRendererError('react.error-boundary', error, info.componentStack ?? undefined)
    void window.desktop?.diagnostics.crashLogPath().then((logPath) => this.setState({ logPath }))
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        minHeight: '100vh',
        padding: 32,
        color: '#e6edf3',
        background: '#0d1117',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <h1>MyRepos hit a renderer error</h1>
        <p>{this.state.error}</p>
        {this.state.logPath && <p>Crash log: <code>{this.state.logPath}</code></p>}
        <button type="button" onClick={() => window.location.reload()}>Reload MyRepos</button>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppCrashBoundary>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <App />
      </MantineProvider>
    </AppCrashBoundary>
  </React.StrictMode>,
)
