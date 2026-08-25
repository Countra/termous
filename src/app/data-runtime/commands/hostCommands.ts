import type { ConnectionProxyInput } from '#entities/connection-proxy'
import type { FileAccessProfileMetadataInput } from '#entities/file-access-profile'
import type { HostAssetInput } from '#entities/host-asset'
import type {
  Host,
  HostIconReorderItem,
  HostInput,
  HostReachabilityEvent,
} from '#entities/host'
import type { RemoteDesktopAccessProfileInput } from '#entities/remote-desktop'
import type { SSHAccessProfileInput } from '#entities/ssh-access-profile'
import type { GroupReorderItem } from '#shared/model'
import type { HostCommandGateway } from '../api/runtimeGatewayContracts'
import {
  mergeHostReachabilityEvent,
  mergeHostReachabilityStates,
  removeHostIcon,
  sortHostGroups,
  sortHostIcons,
  upsertConnectionProxy,
  upsertHostGroup,
  upsertHostIcon,
  type LoadMode,
} from '../model/appDataState'
import type { SetAppData } from '../model/runtimeTypes'
import type { AppData } from '../model/appData'

interface HostCommandDependencies {
  api: HostCommandGateway
  hosts: AppData['hosts']
  load: (mode?: LoadMode) => Promise<void>
  setData: SetAppData
}

export function createHostCommands({ api, hosts, load, setData }: HostCommandDependencies) {
  return {
    async uploadHostIcon(file: File) {
      const icon = await api.uploadHostIcon(file)
      setData((current) => ({ ...current, hostIcons: upsertHostIcon(current.hostIcons, icon) }))
      return icon
    },
    async renameHostIcon(id: string, displayName: string) {
      const icon = await api.renameHostIcon(id, displayName)
      setData((current) => ({ ...current, hostIcons: upsertHostIcon(current.hostIcons, icon) }))
      return icon
    },
    async reorderHostIcons(items: HostIconReorderItem[]) {
      const icons = await api.reorderHostIcons(items)
      setData((current) => ({ ...current, hostIcons: sortHostIcons(icons) }))
      return icons
    },
    async deleteHostIcon(id: string) {
      await api.deleteHostIcon(id)
      setData((current) => ({
        ...current,
        hostIcons: removeHostIcon(current.hostIcons, id),
      }))
    },
    async createHost(input: HostInput) {
      const host = await api.createHost(input)
      await load('silent')
      return host
    },
    async createHostGroup(name: string) {
      const group = await api.createHostGroup(name)
      setData((current) => ({ ...current, groups: upsertHostGroup(current.groups, group) }))
      return group
    },
    async updateHostGroup(id: string, name: string) {
      const group = await api.updateHostGroup(id, name)
      setData((current) => ({ ...current, groups: upsertHostGroup(current.groups, group) }))
      return group
    },
    async deleteHostGroup(id: string) {
      await api.deleteHostGroup(id)
      setData((current) => ({
        ...current,
        groups: current.groups.filter((group) => group.id !== id),
        hosts: current.hosts.map((host) => (host.group_id === id ? { ...host, group_id: '' } : host)),
      }))
    },
    async reorderHostGroups(items: GroupReorderItem[]) {
      const groups = await api.reorderHostGroups(items)
      setData((current) => ({ ...current, groups: [...groups].sort(sortHostGroups) }))
      return groups
    },
    async createConnectionProxy(input: ConnectionProxyInput) {
      const proxy = await api.createConnectionProxy(input)
      setData((current) => ({
        ...current,
        proxies: upsertConnectionProxy(current.proxies, proxy),
      }))
      return proxy
    },
    async updateConnectionProxy(id: string, input: ConnectionProxyInput) {
      const proxy = await api.updateConnectionProxy(id, input)
      setData((current) => ({
        ...current,
        proxies: upsertConnectionProxy(current.proxies, proxy),
      }))
      return proxy
    },
    async deleteConnectionProxy(id: string) {
      await api.deleteConnectionProxy(id)
      setData((current) => ({
        ...current,
        proxies: current.proxies.filter((proxy) => proxy.id !== id),
      }))
    },
    async updateHost(id: string, input: HostInput) {
      const host = await api.updateHost(id, input)
      await load('silent')
      return host
    },
    async toggleHostFavorite(hostId: string) {
      const host = hosts.find((item) => item.id === hostId)
      if (!host) {
        return
      }
      if (!host.updated_at) {
        throw new Error('主机资产不存在或缺少版本信息')
      }
      await api.updateHostAsset(
        host.id,
        host.updated_at,
        { ...legacyHostToAssetInput(host), favorite: !host.favorite },
      )
      await load('silent')
    },
    async deleteHost(id: string) {
      await api.deleteHost(id)
      await load('silent')
    },
    hostAssets: () => api.hostAssets(),
    hostAsset: (id: string) => api.hostAsset(id),
    hostAccessCatalog: (hostId: string) => api.hostAccessCatalog(hostId),
    sshAccessProfiles: (hostId?: string) => api.sshAccessProfiles(hostId),
    sshAccessProfile: (id: string) => api.sshAccessProfile(id),
    inspectSSHAccessProfileReferences: (id: string) => (
      api.inspectSSHAccessProfileReferences(id)
    ),
    fileAccessProfiles: (hostId?: string) => api.fileAccessProfiles(hostId),
    fileAccessProfile: (id: string) => api.fileAccessProfile(id),
    remoteDesktopAccessProfiles: (hostId?: string) => api.remoteDesktopAccessProfiles(hostId),
    remoteDesktopAccessProfile: (id: string) => api.remoteDesktopAccessProfile(id),
    async updateHostAsset(id: string, expectedUpdatedAt: string, input: HostAssetInput) {
      const asset = await api.updateHostAsset(id, expectedUpdatedAt, input)
      await load('silent')
      return asset
    },
    async createSSHAccessProfile(hostId: string, input: SSHAccessProfileInput) {
      const provisioned = await api.createSSHAccessProfile(hostId, input)
      await load('silent')
      return provisioned
    },
    async updateSSHAccessProfile(
      id: string,
      expectedUpdatedAt: string,
      input: SSHAccessProfileInput,
    ) {
      const profile = await api.updateSSHAccessProfile(id, expectedUpdatedAt, input)
      await load('silent')
      return profile
    },
    async deleteSSHAccessProfile(id: string, expectedUpdatedAt: string) {
      await api.deleteSSHAccessProfile(id, expectedUpdatedAt)
      await load('silent')
    },
    async setDefaultSSHAccessProfile(id: string, expectedUpdatedAt: string) {
      const profile = await api.setDefaultSSHAccessProfile(id, expectedUpdatedAt)
      await load('silent')
      return profile
    },
    async updateFileAccessProfile(
      id: string,
      expectedUpdatedAt: string,
      input: FileAccessProfileMetadataInput,
    ) {
      const profile = await api.updateFileAccessProfile(id, expectedUpdatedAt, input)
      await load('silent')
      return profile
    },
    async setDefaultFileAccessProfile(id: string, expectedUpdatedAt: string) {
      const profile = await api.setDefaultFileAccessProfile(id, expectedUpdatedAt)
      await load('silent')
      return profile
    },
    async createRemoteDesktopAccessProfile(input: RemoteDesktopAccessProfileInput) {
      const profile = await api.createRemoteDesktopAccessProfile(input)
      await load('silent')
      return profile
    },
    async updateRemoteDesktopAccessProfile(
      id: string,
      expectedUpdatedAt: string,
      input: RemoteDesktopAccessProfileInput,
    ) {
      const profile = await api.updateRemoteDesktopAccessProfile(id, expectedUpdatedAt, input)
      await load('silent')
      return profile
    },
    async deleteRemoteDesktopAccessProfile(id: string, expectedUpdatedAt: string) {
      await api.deleteRemoteDesktopAccessProfile(id, expectedUpdatedAt)
      await load('silent')
    },
    async setDefaultRemoteDesktopAccessProfile(id: string, expectedUpdatedAt: string) {
      const profile = await api.setDefaultRemoteDesktopAccessProfile(id, expectedUpdatedAt)
      await load('silent')
      return profile
    },
    async refreshHostReachability(hostIds: string[] = [], force = false) {
      const states = await api.refreshHostReachability(hostIds, force)
      setData((current) => ({
        ...current,
        hostReachability: mergeHostReachabilityStates(current.hostReachability, states ?? []),
      }))
    },
    updateHostReachability(event: HostReachabilityEvent) {
      setData((current) => ({
        ...current,
        hostReachability: mergeHostReachabilityEvent(current.hostReachability, event),
      }))
    },
  }
}

function legacyHostToAssetInput(host: Host): HostAssetInput {
  return {
    name: host.name,
    platform: host.platform,
    icon_id: host.icon_id ?? '',
    group_id: host.group_id,
    tags: [...(host.tags ?? [])],
    favorite: host.favorite,
    note: host.note ?? '',
  }
}
