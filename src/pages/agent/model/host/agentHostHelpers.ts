import { resourceBindingMatchesSource, resourceReference, type AgentResourceBinding, type AgentResourceState, type AgentSession, type AgentSlashCandidate, type AgentSlashCandidateCatalog } from '#entities/agent'
import { termousNotificationClassName } from '#shared/ui'
import type { AgentWorkspaceInspectorState, AgentWorkspaceResourceContext } from '#widgets/agent-workspace'
import type { App as AntdApp } from 'antd'
import { resolveAgentResourceError } from '../agentResourceError.ts'
import { slashCandidateMatchesBinding } from '../agentSlashExecution.ts'

export type AgentOperationLane = 'workspace' | 'queue' | 'stop'

export interface AgentOperationBusy {
  workspace: boolean
  queue: boolean
  stop: boolean
}

export function createOperationBusy(): AgentOperationBusy {
  return { workspace: false, queue: false, stop: false }
}

export function updateInput(session: AgentSession, archived: boolean) {
  return {
    title: session.title,
    model_id: session.model_id,
    reasoning_level: session.reasoning_level,
    archived,
    expected_revision: session.revision,
  }
}

export function projectResourceContext(
  binding: AgentResourceBinding,
  resources: AgentResourceState[],
  snapshotReady: boolean,
): AgentWorkspaceResourceContext {
  const currentWorkflow = binding.kind === 'desktop_workflow' && resources.find((source) => 'workflow_id' in source && source.workflow_id === binding.workflow_id && source.workflow_version >= binding.workflow_version)
  // 历史版本不可变；脚本更新不使已固定的旧版本失效，也不悄悄跟随最新版。
  const live = currentWorkflow ? { ...binding, status: currentWorkflow.status } as AgentResourceState
    : resources.find((source) => resourceBindingMatchesSource(binding, source))
  const identityMatches = Boolean(live)
  return {
    binding,
    status: !snapshotReady ? 'checking' : !live ? 'stale' : live.status,
    ...(identityMatches ? { live_resource: live } : {}),
    candidates: resources
      .filter((source) => source.status === 'ready' && resourceReference(source).kind === binding.kind)
      .sort((left, right) => 'started_at' in left && 'started_at' in right
        ? Date.parse(right.started_at) - Date.parse(left.started_at) : (left.host_name ?? '').localeCompare(right.host_name ?? '')),
  }
}

export function slashCandidateMatchesExpectedBinding(
  candidate: AgentSlashCandidate,
  binding: AgentResourceBinding | undefined,
) {
  return candidate.kind === 'ssh_profile'
    ? binding?.kind === 'ssh_profile' && slashCandidateMatchesBinding(candidate, binding)
    : slashCandidateMatchesBinding(candidate, binding)
}

export function slashBindingLabel(binding: AgentResourceBinding, catalog: AgentSlashCandidateCatalog) {
  if (binding.kind === 'desktop_workflow') return `${binding.workflow_name} · v${binding.workflow_version}`
  if (binding.kind === 'desktop_session' || binding.kind === 'desktop_profile') return `${binding.host_name} / ${binding.desktop_profile_name}`
  const profileName = binding.kind === 'file_profile'
    ? binding.file_access_profile_name
    : binding.kind === 'ssh_profile'
      ? binding.ssh_profile_name
      : catalog.profile.ssh.find((candidate) => (
        candidate.host_id === binding.host_id
        && candidate.ssh_profile_id === binding.ssh_profile_id
      ))?.profile_name ?? shortResourceID(binding.ssh_profile_id)
  return `${binding.host_name} / ${profileName}`
}

export function slashCandidateLabel(candidate: AgentSlashCandidate) {
  if (candidate.kind === 'desktop_workflow') return `${candidate.workflow_name} · v${candidate.workflow_version}`
  return `${candidate.host_name} / ${candidate.profile_name}`
}

export function shortResourceID(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`
}

export function requireSession(sessions: AgentSession[], id: string) {
  const session = sessions.find((item) => item.id === id)
  if (!session) throw new Error('AGENT_SESSION_NOT_FOUND')
  return session
}

export function createSessionTitle(prompt: string, fallback: string) {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || fallback
  return Array.from(firstLine).slice(0, 48).join('')
}

export function projectMcpConnection(
  hasActiveRun: boolean,
  runtimeState: 'offline' | 'ready' | 'starting' | 'running' | 'stopping' | undefined,
): AgentWorkspaceInspectorState['mcp']['connection'] {
  if (!hasActiveRun) return runtimeState === 'offline' ? 'disconnected' : 'on_demand'
  return runtimeState === 'running' || runtimeState === 'stopping'
    ? 'connected'
    : runtimeState === 'starting' || runtimeState === 'ready'
      ? 'connecting'
      : 'disconnected'
}

export function notifyError(
  notification: Pick<ReturnType<typeof AntdApp.useApp>['notification'], 'error' | 'warning' | 'success'>,
  t: (key: string) => string,
  error?: unknown,
  context: 'generic' | 'resource' = 'generic',
  remote = false,
) {
  const feedback = remote ? { key: `remote-agent-operation-${context}`, duration: 0 } : {}
  if (remote && error && typeof error === 'object' && 'uncertain' in error && error.uncertain) {
    notification.warning({
      ...feedback,
      title: t('agent.error.uncertain'), description: t('agent.error.uncertainDescription'),
      className: termousNotificationClassName,
    })
    return
  }
  if (context === 'resource' || remote) {
    const resourceError = resolveAgentResourceError(error)
    if (resourceError.kind === 'unavailable') {
      notification.error({
        ...feedback,
        title: t(resourceError.resourceKind?.startsWith('desktop_') ? 'agent.desktopResource.errorTitle' : resourceError.resourceKind === 'file_profile' ? 'agent.fileResource.errorTitle' : 'agent.resource.error.unavailableTitle'),
        description: t(resourceError.resourceKind?.startsWith('desktop_') ? 'agent.desktopResource.unavailable' : resourceError.resourceKind === 'file_profile' ? 'agent.fileResource.hint.stale' : `agent.resource.error.reason.${resourceError.reason}`),
        className: termousNotificationClassName,
      })
      return
    }
    if (resourceError.kind === 'revision_conflict') {
      notification.warning({
        ...feedback,
        title: t(context === 'resource' ? 'agent.resource.error.conflictTitle' : 'agent.error.conflict'),
        description: t(context === 'resource' ? 'agent.resource.error.conflictDescription' : 'agent.error.conflictDescription'),
        className: termousNotificationClassName,
      })
      return
    }
    if (resourceError.kind === 'run_conflict') {
      notification.warning({
        ...feedback,
        title: t('agent.resource.error.activeRunTitle'),
        description: t('agent.resource.error.activeRunDescription'),
        className: termousNotificationClassName,
      })
      return
    }
  }
  notification.error({
    ...feedback,
    title: t('agent.error.operation'),
    description: t('agent.error.operationDescription'),
    className: termousNotificationClassName,
  })
}
