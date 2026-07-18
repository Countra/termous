import type { ReactNode } from 'react'
import { TerminalCwdRuntimeContext } from '../features/terminal/terminalCwdContext'
import type { TerminalCwdRuntime } from '../features/terminal/terminalCwdRuntime'

interface TerminalCwdRuntimeProviderProps {
  runtime: TerminalCwdRuntime
  children: ReactNode
}

export function TerminalCwdRuntimeProvider({
  runtime,
  children,
}: TerminalCwdRuntimeProviderProps) {
  return (
    <TerminalCwdRuntimeContext.Provider value={runtime}>
      {children}
    </TerminalCwdRuntimeContext.Provider>
  )
}
