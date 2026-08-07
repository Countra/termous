import type { ReactNode } from 'react'
import {
  TerminalCwdRuntimeContext,
  type TerminalCwdRuntime,
} from '#features/terminal'

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
