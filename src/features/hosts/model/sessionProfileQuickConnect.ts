import type { FileAccessProfile } from '#entities/file-access-profile'
import type { Host } from '#entities/host'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { buildHostLauncherProfileItems, type HostLauncherProfileMenuItem } from './hostLauncherProfiles.ts'

export type SessionProfileQuickConnectSource =
  | { intent: 'files'; profiles: FileAccessProfile[] }
  | { intent: 'remote_desktop'; profiles: RemoteDesktopAccessProfile[] }

export type SessionProfileQuickConnectHost = Pick<Host, 'id' | 'name' | 'icon_id'>

export interface SessionProfileQuickConnectItem {
  profile: HostLauncherProfileMenuItem
  host?: SessionProfileQuickConnectHost
  unavailableReason: 'route_missing' | 'host_missing' | null
}

export function buildSessionProfileQuickConnectItems(
  source: SessionProfileQuickConnectSource,
  hosts: readonly SessionProfileQuickConnectHost[],
  sshAccessProfiles: SSHAccessProfile[],
): SessionProfileQuickConnectItem[] {
  const hostById = new Map(hosts.map((host) => [host.id, host]))
  const items = buildHostLauncherProfileItems({
    sshAccessProfiles,
    fileAccessProfiles: source.intent === 'files' ? source.profiles : [],
    remoteDesktopProfiles: source.intent === 'remote_desktop' ? source.profiles : [],
  }, source.intent)
  return items.map((profile) => {
    const host = hostById.get(profile.hostId)
    return {
      profile,
      host,
      // 独立文件配置可以不绑定主机；已绑定但主机被移除时不能继续连接。
      unavailableReason: profile.hostId && !host ? 'host_missing'
        : profile.availability === 'ready' ? null : 'route_missing',
    }
  })
}

export function filterSessionProfileQuickConnectItems(
  items: readonly SessionProfileQuickConnectItem[],
  query: string,
): SessionProfileQuickConnectItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(({ profile, host }) => {
    const searchable = [profile.name, profile.endpoint, profile.technology, profile.route?.name, profile.route?.endpoint, host?.name]
      .join(' ').toLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
}
