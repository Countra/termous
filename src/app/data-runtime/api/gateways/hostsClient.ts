import type { AppConfig } from '#common/contracts';
import type { ConnectionProxy, ConnectionProxyInput } from '#entities/connection-proxy';
import type {
  Host,
  HostGroup,
  HostIcon,
  HostIconReorderItem,
  HostInput,
  HostReachability,
} from '#entities/host';
import type { GroupReorderItem } from '#shared/model';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

export class HostClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  hostIconFileUrl(id: string, sha256?: string) {
    const url = new URL(`/api/v1/host-icons/${encodeURIComponent(id)}/file`, this.config.apiBaseUrl)
    if (this.config.apiToken) {
      url.searchParams.set('token', this.config.apiToken)
    }
    if (sha256) {
      url.searchParams.set('sha256', sha256)
    }
    return url.toString()
  }

  uploadHostIcon(file: File) {
    const body = new FormData()
    body.append('file', file, file.name)
    return this.request<HostIcon>('/api/v1/host-icons', {
      method: 'POST',
      body,
    })
  }

  hostIcons() {
    return this.request<HostIcon[]>('/api/v1/host-icons')
  }

  renameHostIcon(id: string, displayName: string) {
    return this.request<HostIcon>(`/api/v1/host-icons/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { display_name: displayName },
    })
  }

  reorderHostIcons(items: HostIconReorderItem[]) {
    return this.request<HostIcon[]>('/api/v1/host-icons/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

  deleteHostIcon(id: string) {
    return this.request<void>(`/api/v1/host-icons/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

hostGroups() {
    return this.request<HostGroup[]>('/api/v1/host-groups')
  }

createHostGroup(name: string) {
    return this.request<HostGroup>('/api/v1/host-groups', {
      method: 'POST',
      body: { name },
    })
  }

updateHostGroup(id: string, name: string) {
    return this.request<HostGroup>(`/api/v1/host-groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { name },
    })
  }

deleteHostGroup(id: string) {
    return this.request<void>(`/api/v1/host-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

reorderHostGroups(items: GroupReorderItem[]) {
    return this.request<HostGroup[]>('/api/v1/host-groups/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

connectionProxies() {
    return this.request<ConnectionProxy[]>('/api/v1/proxies')
  }

createConnectionProxy(input: ConnectionProxyInput) {
    return this.request<ConnectionProxy>('/api/v1/proxies', {
      method: 'POST',
      body: input,
    })
  }

updateConnectionProxy(id: string, input: ConnectionProxyInput) {
    return this.request<ConnectionProxy>(`/api/v1/proxies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteConnectionProxy(id: string) {
    return this.request<void>(`/api/v1/proxies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

hosts() {
    return this.request<Host[]>('/api/v1/hosts')
  }

hostReachability() {
    return this.request<HostReachability[]>('/api/v1/hosts/reachability')
  }

refreshHostReachability(hostIds: string[] = [], force = false) {
    return this.request<HostReachability[]>('/api/v1/hosts/reachability/refresh', {
      method: 'POST',
      body: { host_ids: hostIds, force },
      timeoutMs: 4_000,
    })
  }

hostReachabilityEventsUrl() {
    return this.websocketUrl('/api/v1/hosts/reachability/events')
  }

createHost(input: HostInput) {
    return this.request<Host>('/api/v1/hosts', {
      method: 'POST',
      body: input,
    })
  }

updateHost(id: string, input: HostInput) {
    return this.request<Host>(`/api/v1/hosts/${id}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteHost(id: string) {
    return this.request<void>(`/api/v1/hosts/${id}`, { method: 'DELETE' })
  }
}
