import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react'
import type { SessionCwdState } from '../../types/domain'
import type {
  SessionCwdRequestError,
  SessionCwdRequestScope,
  TerminalCwdRuntime,
} from './terminalCwdRuntime'
import type { TerminalTransportState } from './terminalTransport'

export const TerminalCwdRuntimeContext = createContext<TerminalCwdRuntime | null>(null)

export function useTerminalCwdRuntime() {
  const runtime = useContext(TerminalCwdRuntimeContext)
  if (!runtime) {
    throw new Error('useTerminalCwdRuntime 必须在 TerminalCwdRuntimeProvider 内使用')
  }
  return runtime
}

export function useSessionCwdState(sessionId: string | null): SessionCwdState | null {
  const runtime = useTerminalCwdRuntime()
  return useSyncExternalStore(
    (listener) => sessionId ? runtime.subscribe(sessionId, listener) : () => undefined,
    () => sessionId ? runtime.getSnapshot(sessionId) : null,
    () => sessionId ? runtime.getSnapshot(sessionId) : null,
  )
}

export function useSessionCwdRequestError(
  sessionId: string | null,
  scope: SessionCwdRequestScope = 'cwd_change',
): SessionCwdRequestError | null {
  const runtime = useTerminalCwdRuntime()
  const subscribe = useCallback(
    (listener: () => void) => (
      sessionId ? runtime.subscribe(sessionId, listener) : () => undefined
    ),
    [runtime, sessionId],
  )
  const getSnapshot = useCallback(
    () => (sessionId ? runtime.getRequestErrorSnapshot(sessionId, scope) : null),
    [runtime, scope, sessionId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useSessionCwdTransportState(
  sessionId: string | null,
): TerminalTransportState {
  const runtime = useTerminalCwdRuntime()
  return useSyncExternalStore(
    (listener) => sessionId ? runtime.subscribe(sessionId, listener) : () => undefined,
    () => sessionId ? runtime.getTransportStateSnapshot(sessionId) : 'idle',
    () => sessionId ? runtime.getTransportStateSnapshot(sessionId) : 'idle',
  )
}
