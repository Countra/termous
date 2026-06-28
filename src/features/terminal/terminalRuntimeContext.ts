import { createContext, useContext } from 'react'

export interface TerminalSearchOptions {
  caseSensitive: boolean
  regex: boolean
}

export interface TerminalSearchResult {
  found: boolean
  resultIndex: number
  resultCount: number
  error?: 'invalid_regex'
}

export type TerminalSearchDirection = 'next' | 'previous'

export type TerminalClipboardAction = 'copied' | 'pasted' | 'empty' | 'none' | 'failed'

export type TerminalSendResult = 'sent' | 'missing_session' | 'not_ready' | 'failed'

export interface TerminalClipboardOptions {
  clearSelectionAfterCopy?: boolean
}

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
  searchActive: (
    term: string,
    options: TerminalSearchOptions,
    direction: TerminalSearchDirection,
    sessionId?: string,
  ) => TerminalSearchResult
  clearActiveSearch: (sessionId?: string) => void
  copyActiveSelection: () => Promise<TerminalClipboardAction>
  pasteActiveClipboard: () => Promise<TerminalClipboardAction>
  copyOrPasteActive: (options?: TerminalClipboardOptions) => Promise<TerminalClipboardAction>
  sendTextToSession: (sessionId: string, text: string, options?: { execute?: boolean }) => TerminalSendResult
  sendTextToActive: (text: string, options?: { execute?: boolean }) => TerminalSendResult
}

export const TerminalRuntimeContext = createContext<TerminalRuntimeContextValue | null>(null)

export function useTerminalRuntime() {
  const context = useContext(TerminalRuntimeContext)
  if (!context) {
    throw new Error('useTerminalRuntime must be used within TerminalRuntimeProvider')
  }
  return context
}
