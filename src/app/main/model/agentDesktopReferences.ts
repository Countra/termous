import type { AgentDesktopResourceState, AgentSlashCandidateCatalog, AgentSlashDesktopProfileCandidate, AgentSlashDesktopSessionCandidate, AgentSlashWorkflowCandidate } from '#entities/agent'
import type { Script } from '#entities/desktop-workflow'
import type { HostAsset } from '#entities/host-asset'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'

export function projectAgentDesktopReferences(sessions: readonly RemoteDesktopSession[], profiles: readonly RemoteDesktopAccessProfile[], hosts: readonly HostAsset[], scripts: readonly Script[]) {
  const hostById = new Map(hosts.map((host) => [host.id, host]))
  const desktopSessions: AgentSlashDesktopSessionCandidate[] = sessions.map((session) => {
    const ready = ['ready', 'streaming', 'reattach_wait'].includes(session.status) && session.connection_generation > 0
    return {
      id: `session:desktop:${session.id}`, kind: 'desktop_session', resource_kind: 'desktop', current: false,
      host_id: session.host_id, host_name: session.host_name, profile_id: session.profile_id, profile_name: session.profile_name,
      session_id: session.id, connection_generation: session.connection_generation, protocol: session.protocol, started_at: session.created_at,
      status: ready ? 'ready' : 'unavailable', ...(!ready ? { disabled_reason: 'session_not_ready' as const } : {}),
    }
  })
  const desktopProfiles: AgentSlashDesktopProfileCandidate[] = profiles.map((profile) => {
    const host = hostById.get(profile.host_id)
    return {
      id: `profile:desktop:${profile.id}`, kind: 'desktop_profile', resource_kind: 'desktop', current: false,
      host_id: profile.host_id, host_name: host?.name ?? profile.host_id, profile_id: profile.id, profile_name: profile.name,
      protocol: profile.protocol, status: host ? 'ready' : 'unavailable', ...(!host ? { disabled_reason: 'host_missing' as const } : {}),
    }
  })
  const workflows: AgentSlashWorkflowCandidate[] = scripts.map((script) => ({
    id: `workflow:${script.id}`, kind: 'desktop_workflow', resource_kind: 'workflow', current: false,
    workflow_id: script.id, workflow_name: script.name, workflow_version: script.revision, status: 'ready',
  }))
  const resources: AgentDesktopResourceState[] = [
    ...desktopSessions.map((c): AgentDesktopResourceState => ({ kind: c.kind, session_id: c.session_id, connection_generation: c.connection_generation,
      desktop_profile_id: c.profile_id, desktop_profile_name: c.profile_name, host_id: c.host_id, host_name: c.host_name, protocol: c.protocol, status: c.status })),
    ...desktopProfiles.map((c): AgentDesktopResourceState => ({ kind: c.kind, desktop_profile_id: c.profile_id,
      desktop_profile_name: c.profile_name, host_id: c.host_id, host_name: c.host_name, protocol: c.protocol, status: c.status })),
    ...workflows.map((c): AgentDesktopResourceState => ({ kind: c.kind, workflow_id: c.workflow_id, workflow_name: c.workflow_name, workflow_version: c.workflow_version, status: c.status })),
  ]
  return { resources, extend(catalog: AgentSlashCandidateCatalog): AgentSlashCandidateCatalog {
    return { session: { ...catalog.session, desktop: desktopSessions }, profile: { ...catalog.profile, desktop: desktopProfiles }, workflow: { workflow: workflows } }
  } }
}
