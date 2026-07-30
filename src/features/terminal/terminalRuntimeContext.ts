import { createContext, useContext } from 'react'
import type {
  TerminalContextPointer,
  TerminalContextSelectionRange,
  TerminalContextSnapshot,
} from './terminalContextTarget'

export type {
  TerminalContextPointer,
  TerminalContextSelectionRange,
  TerminalContextSnapshot,
  TerminalContextTarget,
  TerminalMouseTrackingMode,
} from './terminalContextTarget'

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

export interface TerminalViewportOptions {
  viewportId?: string
  sessionId: string | null
  host: HTMLDivElement | null
  active?: boolean
  onResize?: (cols: number, rows: number) => void
}

export interface TerminalRuntimeContextValue {
  registerViewport: (options: TerminalViewportOptions) => () => void
  focusActive: () => void
  resizeActive: () => void
  resizeSession: (sessionId: string) => void
  disposeSession: (sessionId: string) => void
  disposeAll: () => void
  searchActive: (
    term: string,
    options: TerminalSearchOptions,
    direction: TerminalSearchDirection,
    sessionId?: string,
  ) => TerminalSearchResult
  clearActiveSearch: (sessionId?: string) => void
  captureSessionContext: (
    sessionId: string,
    pointer?: TerminalContextPointer,
  ) => TerminalContextSnapshot | null
  pasteSessionClipboard: (sessionId: string) => Promise<TerminalClipboardAction>
  copyText: (text: string) => Promise<TerminalClipboardAction>
  selectSessionContextRange: (
    sessionId: string,
    range: TerminalContextSelectionRange,
    expectedText: string,
  ) => boolean
  clearSessionContextSelection: (sessionId: string) => boolean
  selectAllSession: (sessionId: string) => boolean
  focusSession: (sessionId: string) => boolean
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
