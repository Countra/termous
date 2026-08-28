import {
  projectFileAccessProfile,
  selectCompanionSFTPFileAccessProfile,
  sortFileAccessProfiles,
  type FileAccessEngine,
  type FileAccessProfileProjection,
} from '#entities/file-access-profile'
import {
  projectRemoteDesktopAccessProfile,
  sortRemoteDesktopAccessProfiles,
  type RemoteDesktopAccessProfileProjection,
  type RemoteDesktopProtocol,
} from '#entities/remote-desktop'
import {
  sortSSHAccessProfiles,
  type SSHAccessProfile,
} from '#entities/ssh-access-profile'
import { formatSSHProfileEndpoint } from './hostDirectory.ts'
import type { HostLauncherIntent } from './hostLauncherIntent.ts'
import type { HostLauncherProfileData } from './types.ts'

export type HostLauncherProfileTechnology = 'ssh' | FileAccessEngine | RemoteDesktopProtocol

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
  technology: FileAccessEngine
}

export interface HostLauncherRemoteDesktopProfileMenuItem
  extends HostLauncherProfileMenuItemBase {
  intent: 'remote_desktop'
  actionId: 'openRemoteDesktop'
  technology: RemoteDesktopProtocol
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

export function selectCompanionHostLauncherFileProfile(
  data: HostLauncherProfileData,
  hostId: string,
  sshProfileId: string,
): HostLauncherFileProfileMenuItem | null {
  const companion = selectCompanionSFTPFileAccessProfile(
    data.fileAccessProfiles,
    hostId,
    sshProfileId,
  )
  if (!companion) return null

  const matches = buildHostLauncherProfileMenu(data, hostId, 'files').items.filter(
    (item): item is HostLauncherFileProfileMenuItem => (
      item.intent === 'files'
      && item.profileId === companion.id
      && item.route?.profileId === sshProfileId
      && item.availability === 'ready'
    ),
  )
  return matches.length === 1 ? matches[0] ?? null : null
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
      .map(projectFileAccessProfile)
      .map((profile) => toFileMenuItem(profile, sshProfiles))
  }
  return sortRemoteDesktopAccessProfiles(data.remoteDesktopProfiles)
    .filter((profile) => profile.host_id === hostId)
    .map(projectRemoteDesktopAccessProfile)
    .map((profile) => toRemoteDesktopMenuItem(profile, sshProfiles))
}

function toSSHMenuItem(profile: SSHAccessProfile): HostLauncherSSHProfileMenuItem {
  const endpoint = formatSSHProfileEndpoint(profile)
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
  profile: FileAccessProfileProjection,
  sshProfiles: SSHAccessProfile[],
): HostLauncherFileProfileMenuItem {
  const route = resolveRouteInfo(
    sshProfiles,
    profile.hostId,
    profile.routeDependency.profileId,
  )
  return {
    profileId: profile.profileId,
    hostId: profile.hostId,
    intent: 'files',
    actionId: 'openFiles',
    technology: profile.technology.id,
    name: displayName(profile.name, route?.endpoint ?? profile.technology.label),
    endpoint: route?.endpoint ?? '',
    route,
    isDefault: profile.isDefault,
    sortOrder: profile.sortOrder,
    availability: route ? 'ready' : 'route_missing',
  }
}

function toRemoteDesktopMenuItem(
  profile: RemoteDesktopAccessProfileProjection,
  sshProfiles: SSHAccessProfile[],
): HostLauncherRemoteDesktopProfileMenuItem {
  const route = profile.routeDependency
    ? resolveRouteInfo(
        sshProfiles,
        profile.hostId,
        profile.routeDependency.profileId,
      )
    : null
  return {
    profileId: profile.profileId,
    hostId: profile.hostId,
    intent: 'remote_desktop',
    actionId: 'openRemoteDesktop',
    technology: profile.technology.id,
    name: displayName(profile.name, profile.endpoint),
    endpoint: profile.endpoint,
    route,
    isDefault: profile.isDefault,
    sortOrder: profile.sortOrder,
    availability: profile.routeDependency && !route ? 'route_missing' : 'ready',
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
  const endpoint = formatSSHProfileEndpoint(profile)
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

function displayName(name: string, fallback: string) {
  return name.trim() || fallback
}
