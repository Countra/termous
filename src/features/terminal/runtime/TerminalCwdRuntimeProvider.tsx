import type { ReactNode } from 'react'
import type { TerminalCwdRuntime } from '../model/terminalCwdRuntime'
import { TerminalCwdRuntimeContext } from './terminalCwdContext'

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
