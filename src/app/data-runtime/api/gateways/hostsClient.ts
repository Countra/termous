import type { AppConfig } from '#common/contracts'
import type { ConnectionProxy, ConnectionProxyInput } from '#entities/connection-proxy'
import {
  decodeFileAccessEngineDescriptors,
  decodeFileAccessProfile,
  decodeFileAccessProfileReferences,
  decodeFileAccessProfiles,
  sortFileAccessProfiles,
  type FileAccessEngineDescriptor,
  type FileAccessProfileCreateInput,
  type FileAccessProfilePatchInput,
  type FileAccessProfileReferences,
} from '#entities/file-access-profile'
import {
  normalizeHostAccessCatalog,
  sortHostAssets,
  type HostAccessCatalog,
  type HostAsset,
  type HostAssetInput,
  type HostProvisionInput,
} from '#entities/host-asset'
import type {
  Host,
  HostGroup,
  HostIcon,
  HostIconReorderItem,
  HostInput,
  HostReachability,
} from '#entities/host'
import {
  sortRemoteDesktopAccessProfiles,
  type RemoteDesktopAccessProfile,
  type RemoteDesktopAccessProfileInput,
} from '#entities/remote-desktop'
import {
  sortSSHAccessProfiles,
  type ProvisionedSSHAccessProfile,
  type SSHAccessProfile,
  type SSHAccessProfileInput,
  type SSHAccessProfileReferences,
} from '#entities/ssh-access-profile'
import type { GroupReorderItem } from '#shared/model'
import { TermousApiError, TermousApiTransport } from '#shared/api'
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

  sshProfileReachability() {
    return this.request<HostReachability[]>('/api/v1/ssh-access-profiles/reachability')
  }

  refreshSSHProfileReachability(sshProfileIds: string[] = [], force = false) {
    return this.request<HostReachability[]>('/api/v1/ssh-access-profiles/reachability/refresh', {
      method: 'POST',
      body: { ssh_profile_ids: sshProfileIds, force },
      timeoutMs: 4_000,
    })
  }

  sshProfileReachabilityEventsUrl() {
    return this.websocketUrl('/api/v1/ssh-access-profiles/reachability/events')
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

  hostAssets() {
    return this.request<HostAsset[]>('/api/v1/host-assets')
      .then(normalizeArray)
      .then(sortHostAssets)
  }

  hostAsset(id: string) {
    return this.request<HostAsset>(`/api/v1/host-assets/${encodeURIComponent(id)}`)
  }

  async provisionHost(input: HostProvisionInput) {
    const submit = () => this.request<HostAccessCatalog>('/api/v1/host-assets/provision', {
      method: 'POST', body: input,
    })
    let catalog: HostAccessCatalog
    try {
      catalog = await submit()
    } catch (cause) {
      if (!(cause instanceof TermousApiError)
        || !['NETWORK_ERROR', 'REQUEST_TIMEOUT'].includes(cause.code)) throw cause
      // 响应可能丢失，只重发同一快照一次；稳定请求 ID 防止重复创建。
      // 同一 ID 不能证明内容相同，冲突必须保留给界面核对，不能把旧目录当作本次保存结果。
      catalog = await submit()
    }
    return normalizeHostAccessCatalog(catalog)
  }

  updateHostAsset(id: string, expectedUpdatedAt: string, input: HostAssetInput) {
    return this.request<HostAsset>(`/api/v1/host-assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...input, expected_updated_at: expectedUpdatedAt },
    })
  }

  hostAccessCatalog(hostId: string) {
    return this.request<HostAccessCatalog>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/access-profiles`,
    ).then((catalog) => normalizeHostAccessCatalog({
      ...catalog,
      files: decodeFileAccessProfiles(catalog.files),
    }))
  }

  sshAccessProfiles(hostId?: string) {
    const query = hostFilterQuery(hostId)
    return this.request<SSHAccessProfile[]>(`/api/v1/ssh-access-profiles${query}`)
      .then(normalizeArray)
      .then(sortSSHAccessProfiles)
  }

  sshAccessProfile(id: string) {
    return this.request<SSHAccessProfile>(
      `/api/v1/ssh-access-profiles/${encodeURIComponent(id)}`,
    )
  }

  createSSHAccessProfile(hostId: string, input: SSHAccessProfileInput) {
    return this.request<ProvisionedSSHAccessProfile>('/api/v1/ssh-access-profiles', {
      method: 'POST',
      body: { ...input, host_id: hostId },
    })
  }

  updateSSHAccessProfile(
    id: string,
    expectedUpdatedAt: string,
    input: SSHAccessProfileInput,
  ) {
    return this.request<SSHAccessProfile>(
      `/api/v1/ssh-access-profiles/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: { ...input, expected_updated_at: expectedUpdatedAt },
      },
    )
  }

  deleteSSHAccessProfile(id: string, expectedUpdatedAt: string) {
    return this.request<void>(`/api/v1/ssh-access-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: { expected_updated_at: expectedUpdatedAt },
    })
  }

  setDefaultSSHAccessProfile(id: string, expectedUpdatedAt: string) {
    return this.request<SSHAccessProfile>(
      `/api/v1/ssh-access-profiles/${encodeURIComponent(id)}/default`,
      {
        method: 'POST',
        body: { expected_updated_at: expectedUpdatedAt },
      },
    )
  }

  inspectSSHAccessProfileReferences(id: string) {
    return this.request<SSHAccessProfileReferences>(
      `/api/v1/ssh-access-profiles/${encodeURIComponent(id)}/references`,
    )
  }

  fileAccessProfiles(hostId?: string) {
    const query = hostFilterQuery(hostId)
    return this.request<unknown>(
      `/api/v1/file-access-profiles${query}`,
    ).then(decodeFileAccessProfiles).then(sortFileAccessProfiles)
  }

  fileAccessProfile(id: string) {
    return this.request<unknown>(
      `/api/v1/file-access-profiles/${encodeURIComponent(id)}`,
    ).then(decodeFileAccessProfile)
  }

  fileAccessEngines(): Promise<FileAccessEngineDescriptor[]> {
    return this.request<unknown>('/api/v1/file-access-engines')
      .then(decodeFileAccessEngineDescriptors)
  }

  createFileAccessProfile(input: FileAccessProfileCreateInput) {
    return this.request<unknown>('/api/v1/file-access-profiles', {
      method: 'POST',
      body: input,
    }).then(decodeFileAccessProfile)
  }

  updateFileAccessProfile(
    id: string,
    expectedUpdatedAt: string,
    input: FileAccessProfilePatchInput,
  ) {
    return this.request<unknown>(
      `/api/v1/file-access-profiles/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: { ...input, expected_updated_at: expectedUpdatedAt },
      },
    ).then(decodeFileAccessProfile)
  }

  inspectFileAccessProfileReferences(id: string): Promise<FileAccessProfileReferences> {
    return this.request<unknown>(
      `/api/v1/file-access-profiles/${encodeURIComponent(id)}/references`,
    ).then(decodeFileAccessProfileReferences)
  }

  deleteFileAccessProfile(id: string, expectedUpdatedAt: string) {
    return this.request<void>(`/api/v1/file-access-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: { expected_updated_at: expectedUpdatedAt },
    })
  }

  setDefaultFileAccessProfile(id: string, expectedUpdatedAt: string) {
    return this.request<unknown>(
      `/api/v1/file-access-profiles/${encodeURIComponent(id)}/default`,
      {
        method: 'POST',
        body: { expected_updated_at: expectedUpdatedAt },
      },
    ).then(decodeFileAccessProfile)
  }

  remoteDesktopAccessProfiles(hostId?: string) {
    const query = hostFilterQuery(hostId)
    return this.request<RemoteDesktopAccessProfile[]>(
      `/api/v1/remote-desktop-profiles${query}`,
    ).then(normalizeArray).then(sortRemoteDesktopAccessProfiles)
  }

  remoteDesktopAccessProfile(id: string) {
    return this.request<RemoteDesktopAccessProfile>(
      `/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}`,
    )
  }

  createRemoteDesktopAccessProfile(input: RemoteDesktopAccessProfileInput) {
    return this.request<RemoteDesktopAccessProfile>('/api/v1/remote-desktop-profiles', {
      method: 'POST',
      body: input,
    })
  }

  updateRemoteDesktopAccessProfile(
    id: string,
    expectedUpdatedAt: string,
    input: RemoteDesktopAccessProfileInput,
  ) {
    return this.request<RemoteDesktopAccessProfile>(
      `/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: { ...input, expected_updated_at: expectedUpdatedAt },
      },
    )
  }

  deleteRemoteDesktopAccessProfile(id: string, expectedUpdatedAt: string) {
    return this.request<void>(`/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: { expected_updated_at: expectedUpdatedAt },
    })
  }

  setDefaultRemoteDesktopAccessProfile(id: string, expectedUpdatedAt: string) {
    return this.request<RemoteDesktopAccessProfile>(
      `/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}/default`,
      {
        method: 'POST',
        body: { expected_updated_at: expectedUpdatedAt },
      },
    )
  }
}

function hostFilterQuery(hostId?: string) {
  return hostId === undefined ? '' : `?host_id=${encodeURIComponent(hostId)}`
}
