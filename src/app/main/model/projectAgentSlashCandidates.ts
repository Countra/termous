import type {
  AgentSlashCandidate,
  AgentSlashCandidateCatalog,
  AgentSlashCandidateDisabledReason,
  AgentSlashFileProfileCandidate,
  AgentSlashFileSessionCandidate,
  AgentSlashFileSessionStatus,
  AgentSlashSSHProfileCandidate,
  AgentSlashSSHSessionCandidate,
  AgentSlashSSHSessionStatus,
} from '#entities/agent'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { FileSession } from '#entities/file'
import type { HostAsset } from '#entities/host-asset'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export interface ProjectAgentSlashCandidatesInput {
  sessions: readonly Session[]
  displayedFileSessions: readonly FileSession[]
  hosts: readonly Host[]
  hostAssets: readonly HostAsset[]
  sshAccessProfiles: readonly SSHAccessProfile[]
  fileAccessProfiles: readonly FileAccessProfile[]
  closingFileSessionIds: readonly string[] | ReadonlySet<string>
}

export function projectAgentSlashCandidates(
  input: ProjectAgentSlashCandidatesInput,
): AgentSlashCandidateCatalog {
  return {
    session: {
      ssh: projectAgentSlashSSHSessionCandidates(input),
      file: projectAgentSlashFileSessionCandidates(input),
    },
    profile: {
      ssh: projectAgentSlashSSHProfileCandidates(input),
      file: projectAgentSlashFileProfileCandidates(input),
    },
  }
}

export function projectAgentSlashSSHSessionCandidates(
  input: ProjectAgentSlashCandidatesInput,
): AgentSlashSSHSessionCandidate[] {
  const hosts = new Map(input.hosts.map((host) => [host.id, host]))
  const hostAssets = new Map(input.hostAssets.map((host) => [host.id, host]))
  const profiles = new Map(input.sshAccessProfiles.map((profile) => [profile.id, profile]))
  return input.sessions.flatMap((session): AgentSlashSSHSessionCandidate[] => {
    if (session.kind !== 'ssh' || !session.host_id || !session.ssh_profile_id) return []
    const host = hostAssets.get(session.host_id) ?? hosts.get(session.host_id)
    if (host && String(host.platform) !== 'linux') return []
    const profile = profiles.get(session.ssh_profile_id)
    const status = sshSessionStatus(session)
    const disabledReason: AgentSlashCandidateDisabledReason | undefined = !host
      ? 'host_missing'
      : !profile
        ? 'ssh_profile_missing'
        : profile.host_id !== session.host_id
          ? 'profile_host_mismatch'
          : sshProfileDisabledReason(profile, host, profiles)
            ?? (status === 'ready' ? undefined : 'session_not_ready')
    return [{
      id: `session:ssh:${session.id}`,
      kind: 'ssh_session',
      resource_kind: 'ssh',
      session_id: session.id,
      host_id: session.host_id,
      host_name: host?.name ?? session.host_id,
      profile_id: session.ssh_profile_id,
      profile_name: profile?.name ?? session.ssh_profile_id,
      ssh_profile_id: session.ssh_profile_id,
      started_at: session.started_at,
      status,
      current: false,
      ...(disabledReason ? { disabled_reason: disabledReason } : {}),
    }]
  }).sort(compareSessionCandidate)
}

export function projectAgentSlashFileSessionCandidates(
  input: ProjectAgentSlashCandidatesInput,
): AgentSlashFileSessionCandidate[] {
  const closing = input.closingFileSessionIds instanceof Set
    ? input.closingFileSessionIds
    : new Set(input.closingFileSessionIds)
  const sessionsByProfile = new Map<string, FileSession[]>()
  for (const session of input.displayedFileSessions) {
    if (closing.has(session.id) || !session.file_access_profile_id) continue
    const sessions = sessionsByProfile.get(session.file_access_profile_id) ?? []
    sessions.push(session)
    sessionsByProfile.set(session.file_access_profile_id, sessions)
  }

  const hostAssets = new Map(input.hostAssets.map((host) => [host.id, host]))
  const fileProfiles = new Map(input.fileAccessProfiles.map((profile) => [profile.id, profile]))
  const sshProfiles = new Map(input.sshAccessProfiles.map((profile) => [profile.id, profile]))
  const startedAtByCandidateId = new Map<string, number>()
  const candidates = [...sessionsByProfile.entries()].map(([profileId, sessions]): AgentSlashFileSessionCandidate => {
    const ordered = [...sessions].sort(compareFileSession)
    const representative = ordered[0]!
    const profile = fileProfiles.get(profileId)
    const hostId = profile?.host_id ?? representative.host_id
    const host = hostAssets.get(hostId)
    const disabledReason = fileProfileDisabledReason(profile, host, sshProfiles)
      ?? (profile && representative.host_id !== profile.host_id ? 'profile_host_mismatch' : undefined)
    const candidateId = `session:file:${profileId}`
    startedAtByCandidateId.set(candidateId, timestamp(representative.started_at))
    return {
      id: candidateId,
      kind: 'file_session',
      resource_kind: 'file',
      host_id: hostId,
      host_name: host?.name ?? hostId,
      profile_id: profileId,
      profile_name: profile?.name ?? profileId,
      file_access_profile_id: profileId,
      representative_session_id: representative.id,
      session_count: sessions.length,
      status: fileSessionStatus(representative),
      current: false,
      ...(disabledReason ? { disabled_reason: disabledReason } : {}),
    }
  })
  return candidates.sort((left, right) => compareCandidatePriority(left, right)
    || (startedAtByCandidateId.get(right.id) ?? 0) - (startedAtByCandidateId.get(left.id) ?? 0)
    || left.id.localeCompare(right.id))
}

export function projectAgentSlashSSHProfileCandidates(
  input: ProjectAgentSlashCandidatesInput,
): AgentSlashSSHProfileCandidate[] {
  const hostAssets = new Map(input.hostAssets.map((host) => [host.id, host]))
  const profiles = new Map(input.sshAccessProfiles.map((profile) => [profile.id, profile]))
  return [...new Map(input.sshAccessProfiles.map((profile) => [profile.id, profile])).values()]
    .map((profile): AgentSlashSSHProfileCandidate => {
      const host = hostAssets.get(profile.host_id)
      const disabledReason = sshProfileDisabledReason(profile, host, profiles)
      return {
        id: `profile:ssh:${profile.id}`,
        kind: 'ssh_profile',
        resource_kind: 'ssh',
        host_id: profile.host_id,
        host_name: host?.name ?? profile.host_id,
        profile_id: profile.id,
        profile_name: profile.name || profile.id,
        ssh_profile_id: profile.id,
        sort_order: profile.sort_order,
        status: disabledReason ? 'unavailable' : 'ready',
        current: false,
        ...(disabledReason ? { disabled_reason: disabledReason } : {}),
      }
    }).sort(compareProfileCandidate)
}

export function projectAgentSlashFileProfileCandidates(
  input: ProjectAgentSlashCandidatesInput,
): AgentSlashFileProfileCandidate[] {
  const hostAssets = new Map(input.hostAssets.map((host) => [host.id, host]))
  const sshProfiles = new Map(input.sshAccessProfiles.map((profile) => [profile.id, profile]))
  return [...new Map(input.fileAccessProfiles.map((profile) => [profile.id, profile])).values()]
    .map((profile): AgentSlashFileProfileCandidate => {
      const host = hostAssets.get(profile.host_id)
      const disabledReason = fileProfileDisabledReason(profile, host, sshProfiles)
      return {
        id: `profile:file:${profile.id}`,
        kind: 'file_profile',
        resource_kind: 'file',
        host_id: profile.host_id,
        host_name: host?.name ?? profile.host_id,
        profile_id: profile.id,
        profile_name: profile.name || profile.id,
        file_access_profile_id: profile.id,
        sort_order: profile.sort_order,
        status: disabledReason ? 'unavailable' : 'ready',
        current: false,
        ...(disabledReason ? { disabled_reason: disabledReason } : {}),
      }
    }).sort(compareProfileCandidate)
}

function sshSessionStatus(session: Session): AgentSlashSSHSessionStatus {
  if (session.status === 'connected' && session.phase === 'ready') return 'ready'
  if (session.status === 'waiting_host_trust' || session.phase === 'waiting_host_trust') return 'waiting_host_trust'
  if (session.status === 'disconnected') return 'disconnected'
  if (session.status === 'failed') return 'failed'
  return 'connecting'
}

function fileSessionStatus(session: FileSession): AgentSlashFileSessionStatus {
  if (session.status === 'waiting_trust') return 'waiting_host_trust'
  return session.status
}

function sshProfileDisabledReason(
  profile: SSHAccessProfile,
  host: Pick<HostAsset, 'platform'> | undefined,
  profiles: ReadonlyMap<string, SSHAccessProfile>,
): AgentSlashCandidateDisabledReason | undefined {
  if (!host) return 'host_missing'
  if (String(host.platform) !== 'linux') return 'unsupported_platform'
  if (!profile.name.trim() || !profile.address.trim() || !profile.username.trim() || !profile.credential_id.trim()
    || !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65_535) {
    return 'profile_invalid'
  }
  if (profile.jump_ssh_profile_id && !profiles.has(profile.jump_ssh_profile_id)) return 'ssh_profile_missing'
  return undefined
}

function fileProfileDisabledReason(
  profile: FileAccessProfile | undefined,
  host: HostAsset | undefined,
  sshProfiles: ReadonlyMap<string, SSHAccessProfile>,
): AgentSlashCandidateDisabledReason | undefined {
  if (!profile) return 'profile_missing'
  if (String(profile.engine) !== 'sftp' || Number(profile.engine_config_version) !== 1) return 'unsupported_engine'
  if (!host) return 'host_missing'
  if (String(host.platform) !== 'linux') return 'unsupported_platform'
  if (!profile.name.trim()) return 'profile_invalid'
  const sshProfile = sshProfiles.get(profile.sftp.ssh_profile_id)
  if (!sshProfile) return 'ssh_profile_missing'
  if (sshProfile.host_id !== profile.host_id) return 'profile_host_mismatch'
  return sshProfileDisabledReason(sshProfile, host, sshProfiles)
}

function compareSessionCandidate(left: AgentSlashCandidate, right: AgentSlashCandidate) {
  return compareCandidatePriority(left, right)
    || sessionStartedAt(right) - sessionStartedAt(left)
    || left.id.localeCompare(right.id)
}

function compareFileSession(left: FileSession, right: FileSession) {
  return timestamp(right.started_at) - timestamp(left.started_at) || left.id.localeCompare(right.id)
}

function compareProfileCandidate(
  left: AgentSlashSSHProfileCandidate | AgentSlashFileProfileCandidate,
  right: AgentSlashSSHProfileCandidate | AgentSlashFileProfileCandidate,
) {
  return compareCandidatePriority(left, right)
    || left.host_name.localeCompare(right.host_name)
    || left.sort_order - right.sort_order
    || left.profile_name.localeCompare(right.profile_name)
    || left.id.localeCompare(right.id)
}

function compareCandidatePriority(left: AgentSlashCandidate, right: AgentSlashCandidate) {
  return Number(right.current) - Number(left.current)
    || Number(Boolean(left.disabled_reason)) - Number(Boolean(right.disabled_reason))
}

function sessionStartedAt(candidate: AgentSlashCandidate) {
  if (candidate.kind === 'ssh_session') return timestamp(candidate.started_at)
  if (candidate.kind === 'file_session') return 0
  return 0
}

function timestamp(value: string) {
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : 0
}
