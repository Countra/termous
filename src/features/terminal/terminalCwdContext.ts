import {
  createContext,
  useContext,
  useSyncExternalStore,
} from 'react'
import type { SessionCwdState } from '../../types/domain'
import type { TerminalCwdRuntime } from './terminalCwdRuntime'

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
