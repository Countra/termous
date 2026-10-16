import type { AgentSurfaceModel } from '../surface/agentSurfaceModel.ts'

interface Context {
  selected: import('#entities/agent').AgentSession | undefined
  controller: import('#features/agent-runtime').AgentWorkspaceController
  readiness: import('#entities/agent').AgentReadiness
  connectSSHProfileBinding: (sessionId: string, sshProfileId: string) => Promise<boolean>
  performResourceMutation: (sessionId: string, operation: () => Promise<unknown>) => Promise<boolean>
  recovery: ReturnType<typeof import('#features/agent-runtime').useAgentResourceRecovery>
}

export function createAgentResourceActions({ selected, controller, readiness, connectSSHProfileBinding, performResourceMutation, recovery }: Context) {
  const actions: Pick<NonNullable<AgentSurfaceModel['workspace']>, 'onReplaceResourceBinding' | 'onRecoverResourceBinding' | 'onCancelResourceRecovery'> = {
    onReplaceResourceBinding: async (reference) => {
      if (!selected) return false
      const latestSession = controller.getSnapshot().sessions.find((session) => session.id === selected.id)
      if (!latestSession || latestSession.archived_at) return false
      if (reference.kind === 'ssh_profile' && readiness.settings.connect_ssh_profile_on_bind) {
        return connectSSHProfileBinding(latestSession.id, reference.ssh_profile_id)
      }
      return await performResourceMutation(latestSession.id, async () => {
        await controller.replaceResourceBinding(latestSession.id, {
          ...reference,
          expected_revision: latestSession.revision,
        })
      })
    },
    onRecoverResourceBinding: async () => {
      const current = controller.getSnapshot().sessions.find(({ id }) => id === selected?.id)
      if (!current) return false
      const accepted = await recovery.coordinator.recover(current)
      if (!accepted && recovery.coordinator.getSnapshot()[current.id]?.error_code === 'AGENT_REVISION_CONFLICT') {
        try {
          await controller.reloadSession(current.id)
        } catch {
          // 保留原始冲突诊断，后续工作区事件或用户重试负责恢复权威版本。
        }
      }
      return accepted
    },
    onCancelResourceRecovery: async () => selected ? recovery.coordinator.cancel(selected.id) : false,
  }

  return actions
}
