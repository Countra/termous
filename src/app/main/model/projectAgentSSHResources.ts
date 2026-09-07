import type { AgentSSHResourceState } from '#entities/agent'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export function projectAgentSSHResources(
  sessions: Session[],
  hosts: Host[],
  profiles: SSHAccessProfile[],
): AgentSSHResourceState[] {
  const hostsById = new Map(hosts.map((host) => [host.id, host]))
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
  return sessions.flatMap((session) => {
    if (session.kind !== 'ssh' || !session.host_id || !session.ssh_profile_id) return []
    const host = hostsById.get(session.host_id)
    if (host && String(host.platform) !== 'linux') return []
    const profile = profilesById.get(session.ssh_profile_id)
    return [{
      session_id: session.id,
      host_id: session.host_id,
      ssh_profile_id: session.ssh_profile_id,
      host_name: host?.name ?? session.host_id,
      ssh_profile_name: profile?.name ?? session.ssh_profile_id,
      status: session.status === 'connected' && session.phase === 'ready'
        ? 'ready' as const
        : 'unavailable' as const,
      started_at: session.started_at,
    }]
  })
}
