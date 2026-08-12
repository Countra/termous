import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react'
import type {
  CommandDispatchTask,
  CommandDispatchTaskInput,
} from '#entities/command-dispatch'
import type { CommandDispatchOutputSnapshot } from '../model/commandDispatchOutputStore'
import type { CommandDispatchTaskViewState } from '../model/commandDispatchTaskState'

export interface CommandDispatchRuntimeContextValue {
  state: CommandDispatchTaskViewState
  start: (input: CommandDispatchTaskInput) => Promise<CommandDispatchTask>
  interruptTask: () => Promise<CommandDispatchTask | null>
  interruptTarget: (sessionId: string) => Promise<CommandDispatchTask | null>
  subscribeTargetOutput: (taskId: string, sessionId: string, listener: () => void) => () => void
  getTargetOutputSnapshot: (taskId: string, sessionId: string) => CommandDispatchOutputSnapshot
}

export const CommandDispatchRuntimeContext =
  createContext<CommandDispatchRuntimeContextValue | null>(null)

export function useCommandDispatchRuntime() {
  const context = useContext(CommandDispatchRuntimeContext)
  if (!context) {
    throw new Error('useCommandDispatchRuntime 必须在 CommandDispatchRuntimeProvider 内使用')
  }
  return context
}

export function useCommandDispatchTargetOutput(
  taskId: string | undefined,
  sessionId: string | undefined,
) {
  const runtime = useCommandDispatchRuntime()
  const subscribe = useCallback(
    (listener: () => void) => taskId && sessionId
      ? runtime.subscribeTargetOutput(taskId, sessionId, listener)
      : () => undefined,
    [runtime, sessionId, taskId],
  )
  const getSnapshot = useCallback(
    () => runtime.getTargetOutputSnapshot(taskId ?? '', sessionId ?? ''),
    [runtime, sessionId, taskId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
