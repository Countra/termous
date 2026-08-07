import type { ConnectionProxyInput } from '#entities/connection-proxy'
import type { HostInput, HostReachabilityEvent } from '#entities/host'
import type { GroupReorderItem } from '#shared/model'
import type { TermousApi } from '../api/runtimeApi'
import { hostToInput } from '#entities/host'
import {
  mergeHostReachabilityEvent,
  mergeHostReachabilityStates,
  sortHostGroups,
  upsertConnectionProxy,
  upsertHostGroup,
  type LoadMode,
} from '../model/appDataState'
import type { SetAppData } from '../model/runtimeTypes'
import type { AppData } from '../model/appData'

interface HostCommandDependencies {
  api: TermousApi
  hosts: AppData['hosts']
  load: (mode?: LoadMode) => Promise<void>
  setData: SetAppData
}

export function createHostCommands({ api, hosts, load, setData }: HostCommandDependencies) {
  return {
    async uploadHostIcon(file: File) {
      return api.uploadHostIcon(file)
    },
    async deleteHostIcon(id: string) {
      await api.deleteHostIcon(id)
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
      const nextHost = await api.updateHost(host.id, { ...hostToInput(host), favorite: !host.favorite })
      setData((current) => ({
        ...current,
        hosts: current.hosts.map((item) => (item.id === nextHost.id ? nextHost : item)),
      }))
    },
    async deleteHost(id: string) {
      await api.deleteHost(id)
      await load('silent')
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
