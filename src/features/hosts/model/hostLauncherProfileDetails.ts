import type { ConnectionProxyType } from '#entities/connection-proxy'
import type { CredentialType } from '#entities/credential'
import type { RemoteDesktopDisplayMode } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { formatSSHProfileEndpoint } from './hostDirectory.ts'
import type { HostLauncherProfileMenuItem } from './hostLauncherProfiles.ts'
import type { HostLauncherData } from './types.ts'

type HostLauncherProfileDetailData = Pick<
  HostLauncherData,
  | 'credentials'
  | 'fileAccessProfiles'
  | 'hostAssets'
  | 'proxies'
  | 'remoteDesktopProfiles'
  | 'sshAccessProfiles'
>

export interface HostLauncherCredentialSummary {
  name: string
  type: CredentialType
}

export interface HostLauncherProxySummary {
  name: string
  type: ConnectionProxyType
}

export interface HostLauncherJumpSummary {
  hostName: string
  profileName: string
  endpoint: string
  credential: HostLauncherCredentialSummary | null
}

export interface HostLauncherRemoteDesktopSummary {
  description: string
  targetCredential: HostLauncherCredentialSummary | null
  shared: boolean
  viewOnly: boolean
  displayMode: RemoteDesktopDisplayMode
}

export interface HostLauncherResolvedProfileDetails {
  endpoint: string
  sshProfileId: string | null
  sshCredential: HostLauncherCredentialSummary | null
  primaryCredential: HostLauncherCredentialSummary | null
  proxy: HostLauncherProxySummary | null
  jump: HostLauncherJumpSummary | null
  fingerprint: string
  lastConnectedAt: string
  lastDirectory: string
  remoteDesktop: HostLauncherRemoteDesktopSummary | null
}

export function resolveHostLauncherProfileDetails(
  data: HostLauncherProfileDetailData,
  item: HostLauncherProfileMenuItem | null,
): HostLauncherResolvedProfileDetails | null {
  if (!item) return null

  const sshProfileId = effectiveSSHProfileId(item)
  const sshProfile = sshProfileId
    ? findUnique(data.sshAccessProfiles, (profile) => (
        profile.id === sshProfileId && profile.host_id === item.hostId
      ))
    : undefined
  const sshCredential = credentialSummary(data, sshProfile?.credential_id)
  const fileProfile = item.intent === 'files'
    ? findUnique(data.fileAccessProfiles, (profile) => (
        profile.id === item.profileId && profile.host_id === item.hostId
      ))
    : undefined
  const desktopProfile = item.intent === 'remote_desktop'
    ? findUnique(data.remoteDesktopProfiles, (profile) => (
        profile.id === item.profileId && profile.host_id === item.hostId
      ))
    : undefined
  const targetCredential = credentialSummary(
    data,
    desktopProfile?.target_auth?.credential_id,
  )

  return {
    endpoint: item.endpoint || (sshProfile ? formatSSHProfileEndpoint(sshProfile) : ''),
    sshProfileId: sshProfile?.id ?? null,
    sshCredential,
    primaryCredential: targetCredential ?? sshCredential,
    proxy: proxySummary(data, sshProfile?.proxy_id),
    jump: jumpSummary(data, sshProfile),
    fingerprint: sshProfile?.fingerprint?.trim() ?? '',
    lastConnectedAt: sshProfile?.last_connected_at ?? '',
    lastDirectory: fileProfile?.last_directory?.trim() ?? '',
    remoteDesktop: desktopProfile ? {
      description: desktopProfile.description.trim(),
      targetCredential,
      shared: desktopProfile.vnc.shared,
      viewOnly: desktopProfile.vnc.default_view_only,
      displayMode: desktopProfile.vnc.default_display_mode,
    } : null,
  }
}

export function effectiveSSHProfileId(item: HostLauncherProfileMenuItem | null) {
  if (!item || item.availability !== 'ready') return null
  if (item.intent === 'terminal') return item.profileId
  return item.route?.profileId ?? null
}

function credentialSummary(
  data: HostLauncherProfileDetailData,
  credentialId: string | undefined,
): HostLauncherCredentialSummary | null {
  if (!credentialId) return null
  const credential = findUnique(
    data.credentials,
    (candidate) => candidate.id === credentialId,
  )
  return credential ? { name: credential.name, type: credential.type } : null
}

function proxySummary(
  data: HostLauncherProfileDetailData,
  proxyId: string | undefined,
): HostLauncherProxySummary | null {
  if (!proxyId) return null
  const proxy = findUnique(data.proxies, (candidate) => candidate.id === proxyId)
  return proxy ? { name: proxy.name, type: proxy.type } : null
}

function jumpSummary(
  data: HostLauncherProfileDetailData,
  profile: SSHAccessProfile | undefined,
): HostLauncherJumpSummary | null {
  if (!profile?.jump_ssh_profile_id) return null
  const jumpProfile = findUnique(
    data.sshAccessProfiles,
    (candidate) => candidate.id === profile.jump_ssh_profile_id,
  )
  if (!jumpProfile) return null
  const jumpHost = findUnique(
    data.hostAssets,
    (candidate) => candidate.id === jumpProfile.host_id,
  )
  return {
    hostName: jumpHost?.name ?? '',
    profileName: jumpProfile.name.trim() || formatSSHProfileEndpoint(jumpProfile),
    endpoint: formatSSHProfileEndpoint(jumpProfile),
    credential: credentialSummary(data, jumpProfile.credential_id),
  }
}

function findUnique<T>(items: readonly T[], matches: (item: T) => boolean) {
  const matching = items.filter(matches)
  return matching.length === 1 ? matching[0] : undefined
}
