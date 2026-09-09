import { getAgentResourceBinding, resourceBindingMatchesSource, resourceReference, resourceReferenceId, sameAgentResourceSource,
  type AgentConnectionReferenceLaunch, type AgentConnectionReferenceSnapshot, type AgentFileResourceState,
  type AgentReferenceTarget, type AgentReferenceTargetsSnapshot, type AgentResourceReference, type AgentResourceState } from '#entities/agent'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export function projectAgentFileResources(profiles: FileAccessProfile[], hosts: HostAsset[], sshProfiles: SSHAccessProfile[]): AgentFileResourceState[] {
  const hostById = new Map(hosts.map((host) => [host.id, host]))
  const sshById = new Map(sshProfiles.map((profile) => [profile.id, profile]))
  // 文件引用的生命周期属于配置，不能受桌面标签连接状态影响。
  return [...new Map(profiles.map((profile) => [profile.id, profile])).values()].map((profile) => {
    const host = hostById.get(profile.host_id)
    const ssh = sshById.get(profile.sftp?.ssh_profile_id)
    return {
      file_access_profile_id: profile.id, file_access_profile_name: profile.name,
      host_id: profile.host_id, host_name: host?.name ?? profile.host_id,
      ssh_profile_id: profile.sftp?.ssh_profile_id ?? '', engine: profile.engine,
      status: host && ssh && ssh.host_id === host.id && profile.engine === 'sftp' && profile.engine_config_version === 1 ? 'ready' : 'unavailable',
    }
  })
}

export function projectConnectionReferenceSnapshot(reference: AgentResourceReference, resources: AgentResourceState[],
  sessions: AgentReferenceTargetsSnapshot, resourcesReady: boolean): AgentConnectionReferenceSnapshot {
  const source = resources.find((resource) => resourceReference(resource).kind === reference.kind
    && resourceReferenceId(resourceReference(resource)) === resourceReferenceId(reference))
  return {
    ready: resourcesReady && sessions.ready,
    source: source ? { ...source } : undefined,
    targets: sessions.targets.map((target) => {
      const same = source && resourceBindingMatchesSource(getAgentResourceBinding(target.resource_bindings, reference.kind), source)
      const disabled = target.binding_locked && !same
      return { ...target, disabled, disabled_reason: disabled ? 'binding_locked' : undefined }
    }),
  }
}

export function buildConnectionReferenceLaunch(source: AgentResourceState, target: AgentReferenceTarget,
  resources: AgentResourceState[]): AgentConnectionReferenceLaunch {
  if (!resources.some((current) => sameAgentResourceSource(source, current))) throw new Error('AGENT_TERMINAL_REFERENCE_SOURCE_UNAVAILABLE')
  return { source: 'connection_reference', target, source_resource: { ...source }, resource_reference: resourceReference(source) }
}
