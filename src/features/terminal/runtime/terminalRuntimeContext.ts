import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'
import type {
  TerminalCompletionExpectedSelection,
  TerminalCompletionSessionSnapshot,
} from '../model/terminalCompletionRuntime'
import type {
  TerminalContextPointer,
  TerminalContextSelectionRange,
  TerminalContextSnapshot,
} from '../model/terminalContextTarget'
import type {
  TerminalSearchDirection,
  TerminalSearchOptions,
  TerminalSearchResult,
} from '../model/terminalSearch'
import type { TerminalInputLock } from '../model/terminalProtocol'

export type {
  TerminalContextPointer,
  TerminalContextSelectionRange,
  TerminalContextSnapshot,
  TerminalContextTarget,
  TerminalMouseTrackingMode,
} from '../model/terminalContextTarget'
export type {
  TerminalSearchDirection,
  TerminalSearchOptions,
  TerminalSearchResult,
} from '../model/terminalSearch'

export type TerminalCompletionRetryResult = 'succeeded' | 'failed' | 'cancelled'

export type TerminalClipboardAction = 'copied' | 'pasted' | 'empty' | 'none' | 'failed'

export type TerminalSendResult = 'sent' | 'missing_session' | 'not_ready' | 'failed'

export type TerminalInputLockSnapshot = TerminalInputLock

export interface TerminalViewportOptions {
  viewportId?: string
  sessionId: string | null
  host: HTMLDivElement | null
  active?: boolean
  onResize?: (cols: number, rows: number) => void
}

export interface TerminalCompletionCursorGeometry {
  screenRect: {
    left: number
    top: number
    width: number
    height: number
  }
  cursorX: number
  cursorY: number
  columns: number
  rows: number
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
  subscribeSessionInputLock: (sessionId: string, listener: () => void) => () => void
  getSessionInputLockSnapshot: (sessionId: string) => TerminalInputLockSnapshot
  subscribeSessionCompletion: (sessionId: string, listener: () => void) => () => void
  getSessionCompletionSnapshot: (sessionId: string) => TerminalCompletionSessionSnapshot
  subscribeSessionCompletionLayout: (sessionId: string, listener: () => void) => () => void
  captureSessionCompletionCursor: (sessionId: string) => TerminalCompletionCursorGeometry | null
  setViewportCompletionActive: (viewportId: string, sessionId: string | null, active: boolean) => void
  setViewportCompletionVisible: (viewportId: string, sessionId: string | null, visible: boolean) => void
  moveSessionCompletionSelection: (sessionId: string, delta: number) => boolean
  selectSessionCompletion: (sessionId: string, index: number) => boolean
  acceptSessionCompletion: (
    sessionId: string,
    expected?: TerminalCompletionExpectedSelection,
  ) => boolean
  retrySessionCompletion: (sessionId: string) => Promise<TerminalCompletionRetryResult>
  closeSessionCompletion: (sessionId: string) => void
}

export const TerminalRuntimeContext = createContext<TerminalRuntimeContextValue | null>(null)

export function useTerminalRuntime() {
  const context = useContext(TerminalRuntimeContext)
  if (!context) {
    throw new Error('useTerminalRuntime must be used within TerminalRuntimeProvider')
  }
  return context
}

export function useSessionCompletionSnapshot(sessionId: string | null) {
  const runtime = useTerminalRuntime()
  const fallback = useMemo<TerminalCompletionSessionSnapshot>(() => ({
    sessionId: sessionId ?? '',
    readiness: 'waiting_prompt',
    promptObservation: {
      status: 'waiting',
    },
    boundary: null,
    input: {
      trust: 'uncertain',
      line: '',
      cursorUtf16: 0,
      revision: 0,
      composing: false,
    },
    queryState: 'idle',
    items: [],
    selectedIndex: 0,
    isIncomplete: false,
    indexGeneration: 0,
    providerStates: [],
  }), [sessionId])
  const subscribe = useCallback(
    (listener: () => void) => sessionId
      ? runtime.subscribeSessionCompletion(sessionId, listener)
      : () => undefined,
    [runtime, sessionId],
  )
  const getSnapshot = useCallback(
    () => sessionId ? runtime.getSessionCompletionSnapshot(sessionId) : fallback,
    [fallback, runtime, sessionId],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const unlockedInputLock: TerminalInputLockSnapshot = { locked: false }

export function useSessionInputLock(sessionId: string | null) {
  const runtime = useTerminalRuntime()
  const fallback = unlockedInputLock
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => (
        sessionId ? runtime.subscribeSessionInputLock(sessionId, listener) : () => undefined
      ),
      [runtime, sessionId],
    ),
    useCallback(
      () => sessionId ? runtime.getSessionInputLockSnapshot(sessionId) : fallback,
      [fallback, runtime, sessionId],
    ),
    () => fallback,
  )
}
