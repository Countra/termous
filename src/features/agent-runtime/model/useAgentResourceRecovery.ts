import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { AgentReadiness, AgentSession, AgentSSHResourceState } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { AgentResourceRecoveryCoordinator } from '../runtime/AgentResourceRecoveryCoordinator.ts'

export function useAgentResourceRecovery(gateway: AgentWorkspaceGateway, controller: AgentWorkspaceController,
  session: AgentSession | undefined, active: boolean, queueRevision: number | undefined, sshResources?: readonly AgentSSHResourceState[],
  readiness?: AgentReadiness | null, onCompleted?: (session: AgentSession) => void) {
  const onCompletedRef = useRef(onCompleted)
  onCompletedRef.current = onCompleted
  const coordinator = useMemo(() => new AgentResourceRecoveryCoordinator(gateway,
    (recovered) => controller.acceptRecoveredResourceSession(recovered), undefined,
    (recovered) => onCompletedRef.current?.(recovered)), [gateway, controller])
  const states = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot)
  useEffect(() => {
    const observe = () => coordinator.observe(session, active && document.visibilityState !== 'hidden')
    observe()
    document.addEventListener('visibilitychange', observe)
    return () => document.removeEventListener('visibilitychange', observe)
  }, [coordinator, session, active, queueRevision, sshResources, readiness])
  useEffect(() => () => coordinator.dispose(), [coordinator])
  return { coordinator, state: session ? states[session.id] : undefined }
}
