import {
  sortFileAccessProfiles,
  type FileAccessProfile,
} from '#entities/file-access-profile'
import {
  sortRemoteDesktopAccessProfiles,
  type RemoteDesktopAccessProfile,
} from '#entities/remote-desktop'
import {
  sortSSHAccessProfiles,
  type SSHAccessProfile,
} from '#entities/ssh-access-profile'
import type { HostLauncherIntent } from './hostLauncherIntent.ts'
import type { HostLauncherProfileData } from './types.ts'

export type HostLauncherProfileTechnology = 'ssh' | 'sftp' | 'vnc'

export type HostLauncherProfileAvailability = 'ready' | 'route_missing'

export type HostLauncherDefaultResolution =
  | 'empty'
  | 'missing'
  | 'ambiguous'
  | 'unavailable'
  | 'resolved'

export interface HostLauncherProfileRouteInfo {
  profileId: string
  name: string
  endpoint: string
}

interface HostLauncherProfileMenuItemBase {
  profileId: string
  hostId: string
  name: string
  technology: HostLauncherProfileTechnology
  endpoint: string
  route: HostLauncherProfileRouteInfo | null
  isDefault: boolean
  sortOrder: number
  availability: HostLauncherProfileAvailability
}

export interface HostLauncherSSHProfileMenuItem extends HostLauncherProfileMenuItemBase {
  intent: 'terminal'
  actionId: 'connect'
  technology: 'ssh'
  route: null
  availability: 'ready'
}

export interface HostLauncherFileProfileMenuItem extends HostLauncherProfileMenuItemBase {
  intent: 'files'
  actionId: 'openFiles'
  technology: 'sftp'
}

export interface HostLauncherRemoteDesktopProfileMenuItem
  extends HostLauncherProfileMenuItemBase {
  intent: 'remote_desktop'
  actionId: 'openRemoteDesktop'
  technology: 'vnc'
}

export type HostLauncherProfileMenuItem =
  | HostLauncherSSHProfileMenuItem
  | HostLauncherFileProfileMenuItem
  | HostLauncherRemoteDesktopProfileMenuItem

export interface HostLauncherProfileMenu {
  hostId: string
  intent: HostLauncherIntent
  items: readonly HostLauncherProfileMenuItem[]
  defaultItem: HostLauncherProfileMenuItem | null
  defaultResolution: HostLauncherDefaultResolution
}

export function buildHostLauncherProfileMenu(
  data: HostLauncherProfileData,
  hostId: string,
  intent: HostLauncherIntent,
): HostLauncherProfileMenu {
  const sshProfiles = data.sshAccessProfiles
  const items = buildItems(data, sshProfiles, hostId, intent)
  const defaultItem = selectUniqueDefaultHostLauncherProfile(items) ?? null
  return {
    hostId,
    intent,
    items,
    defaultItem,
    defaultResolution: resolveDefaultState(items, defaultItem),
  }
}

export function selectUniqueDefaultHostLauncherProfile<
  Item extends Pick<HostLauncherProfileMenuItem, 'isDefault'>,
>(items: readonly Item[]): Item | undefined {
  const defaults = items.filter((item) => item.isDefault)
  return defaults.length === 1 ? defaults[0] : undefined
}

function buildItems(
  data: HostLauncherProfileData,
  sshProfiles: SSHAccessProfile[],
  hostId: string,
  intent: HostLauncherIntent,
): HostLauncherProfileMenuItem[] {
  if (intent === 'terminal') {
    return sortSSHAccessProfiles(sshProfiles)
      .filter((profile) => profile.host_id === hostId)
      .map(toSSHMenuItem)
  }
  if (intent === 'files') {
    return sortFileAccessProfiles(data.fileAccessProfiles)
      .filter((profile) => profile.host_id === hostId)
      .map((profile) => toFileMenuItem(profile, sshProfiles))
  }
  return sortRemoteDesktopAccessProfiles(data.remoteDesktopProfiles)
    .filter((profile) => profile.host_id === hostId)
    .map((profile) => toRemoteDesktopMenuItem(profile, sshProfiles))
}

function toSSHMenuItem(profile: SSHAccessProfile): HostLauncherSSHProfileMenuItem {
  const endpoint = formatSSHEndpoint(profile)
  return {
    profileId: profile.id,
    hostId: profile.host_id,
    intent: 'terminal',
    actionId: 'connect',
    technology: 'ssh',
    name: displayName(profile.name, endpoint),
    endpoint,
    route: null,
    isDefault: profile.is_default,
    sortOrder: profile.sort_order,
    availability: 'ready',
  }
}

function toFileMenuItem(
  profile: FileAccessProfile,
  sshProfiles: SSHAccessProfile[],
): HostLauncherFileProfileMenuItem {
  const route = resolveRouteInfo(sshProfiles, profile.host_id, profile.sftp.ssh_profile_id)
  return {
    profileId: profile.id,
    hostId: profile.host_id,
    intent: 'files',
    actionId: 'openFiles',
    technology: 'sftp',
    name: displayName(profile.name, route?.endpoint ?? 'SFTP'),
    endpoint: route?.endpoint ?? '',
    route,
    isDefault: profile.is_default,
    sortOrder: profile.sort_order,
    availability: route ? 'ready' : 'route_missing',
  }
}

function toRemoteDesktopMenuItem(
  profile: RemoteDesktopAccessProfile,
  sshProfiles: SSHAccessProfile[],
): HostLauncherRemoteDesktopProfileMenuItem {
  const endpoint = formatHostPort(profile.vnc.loopback_host, profile.vnc.port)
  const route = resolveRouteInfo(sshProfiles, profile.host_id, profile.ssh_profile_id)
  return {
    profileId: profile.id,
    hostId: profile.host_id,
    intent: 'remote_desktop',
    actionId: 'openRemoteDesktop',
    technology: 'vnc',
    name: displayName(profile.name, endpoint),
    endpoint,
    route,
    isDefault: profile.is_default,
    sortOrder: profile.sort_order,
    availability: route ? 'ready' : 'route_missing',
  }
}

function resolveRouteInfo(
  profiles: SSHAccessProfile[],
  hostId: string,
  profileId: string,
): HostLauncherProfileRouteInfo | null {
  const matches = profiles.filter((profile) => (
    profile.id === profileId && profile.host_id === hostId
  ))
  if (matches.length !== 1) return null
  const profile = matches[0]
  if (!profile) return null
  const endpoint = formatSSHEndpoint(profile)
  return {
    profileId: profile.id,
    name: displayName(profile.name, endpoint),
    endpoint,
  }
}

function resolveDefaultState(
  items: readonly HostLauncherProfileMenuItem[],
  defaultItem: HostLauncherProfileMenuItem | null,
): HostLauncherDefaultResolution {
  if (items.length === 0) return 'empty'
  const defaultCount = items.filter((item) => item.isDefault).length
  if (defaultCount === 0) return 'missing'
  if (defaultCount > 1) return 'ambiguous'
  return defaultItem?.availability === 'ready' ? 'resolved' : 'unavailable'
}

function formatSSHEndpoint(profile: SSHAccessProfile) {
  return `${profile.username}@${formatHostPort(profile.address, profile.port)}`
}

function formatHostPort(host: string, port: number) {
  const normalizedHost = host.includes(':') && !host.startsWith('[')
    ? `[${host}]`
    : host
  return `${normalizedHost}:${port}`
}

function displayName(name: string, fallback: string) {
  return name.trim() || fallback
}
