import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { AgentSession } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { AgentResourceBindingConnectionCoordinator } from '../runtime/AgentResourceBindingConnectionCoordinator.ts'

export function useAgentResourceBindingConnection(
  gateway: AgentWorkspaceGateway,
  controller: AgentWorkspaceController,
  session: AgentSession | undefined,
  active: boolean,
  observationRevision: string,
  onCompleted?: (session: AgentSession) => void,
) {
  const onCompletedRef = useRef(onCompleted)
  onCompletedRef.current = onCompleted
  const coordinator = useMemo(() => new AgentResourceBindingConnectionCoordinator(
    gateway,
    (connected) => controller.acceptResourceConnectionSession(connected),
    undefined,
    (connected) => onCompletedRef.current?.(connected),
  ), [gateway, controller])
  const states = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot)
  useEffect(() => {
    const observe = () => coordinator.observe(session, active && document.visibilityState !== 'hidden')
    observe()
    document.addEventListener('visibilitychange', observe)
    window.addEventListener('online', observe)
    return () => {
      document.removeEventListener('visibilitychange', observe)
      window.removeEventListener('online', observe)
    }
  }, [coordinator, session, active, observationRevision])
  useEffect(() => () => coordinator.dispose(), [coordinator])
  return { coordinator, state: session ? states[session.id] : undefined }
}
