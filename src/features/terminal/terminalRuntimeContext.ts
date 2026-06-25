import { createContext, useContext } from 'react'

export interface TerminalViewportOptions {
  sessionId: string | null
  host: HTMLDivElement | null
  onResize?: (cols: number, rows: number) => void
}

export interface TerminalRuntimeContextValue {
  registerViewport: (options: TerminalViewportOptions) => () => void
  focusActive: () => void
  resizeActive: () => void
  disposeSession: (sessionId: string) => void
  disposeAll: () => void
}

export const TerminalRuntimeContext = createContext<TerminalRuntimeContextValue | null>(null)

export function useTerminalRuntime() {
  const context = useContext(TerminalRuntimeContext)
  if (!context) {
    throw new Error('useTerminalRuntime must be used within TerminalRuntimeProvider')
  }
  return context
}
