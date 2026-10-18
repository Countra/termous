import { useCallback } from 'react'
import { resolveAgentResourceError } from '../agentResourceError.ts'
import { createOperationBusy, notifyError, type AgentOperationLane } from './agentHostHelpers.ts'

interface Context {
  controller: import('#features/agent-runtime').AgentWorkspaceController
  operationBusyRef: React.RefObject<Record<string, import('./agentHostHelpers.ts').AgentOperationBusy>>
  setOperationsBySession: React.Dispatch<React.SetStateAction<Record<string, import('./agentHostHelpers.ts').AgentOperationBusy>>>
  notificationRef: React.RefObject<import('../surface/agentFeedback.ts').AgentFeedback['notification']>
  tRef: React.RefObject<import('i18next').TFunction<"translation", undefined>>
  remote: boolean
}

export function useAgentOperationLanes({ controller, operationBusyRef, setOperationsBySession, notificationRef, tRef, remote }: Context) {
  const perform = useCallback(async (
    operation: () => Promise<unknown>,
    errorContext: 'generic' | 'resource' = 'generic',
    lane: AgentOperationLane = 'workspace',
  ) => {
    const sessionKey = controller.getSnapshot().selected_session_id ?? 'new'
    const busy = operationBusyRef.current[sessionKey] ?? createOperationBusy()
    if (busy[lane]) return false
    operationBusyRef.current = { ...operationBusyRef.current, [sessionKey]: { ...busy, [lane]: true } }
    setOperationsBySession(operationBusyRef.current)
    try {
      await operation()
      return true
    } catch (error) {
      notifyError(notificationRef.current, tRef.current, error, errorContext, remote)
      return false
    } finally {
      operationBusyRef.current = { ...operationBusyRef.current, [sessionKey]: { ...operationBusyRef.current[sessionKey]!, [lane]: false } }
      setOperationsBySession(operationBusyRef.current)
    }
  }, [remote, controller, notificationRef, operationBusyRef, setOperationsBySession, tRef])

  const performResourceMutation = useCallback(async (
    sessionId: string,
    operation: () => Promise<unknown>,
  ) => await perform(async () => {
    try {
      await operation()
    } catch (error) {
      if (resolveAgentResourceError(error).kind === 'revision_conflict') {
        try {
          await controller.reloadSession(sessionId)
        } catch {
          // Workspace 事件仍可恢复权威状态，保留原始冲突错误供用户判断。
        }
      }
      throw error
    }
  }, 'resource'), [controller, perform])

  return { perform, performResourceMutation }
}
