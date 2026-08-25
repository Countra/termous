import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { HostAsset, HostAssetInput } from '#entities/host-asset'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

const API_BASE_URL = 'http://127.0.0.1:8122'
const UPDATED_AT = '2026-08-25T10:00:00Z'

function createGateways() {
  return createRuntimeGatewaysFromConfig({
    apiBaseUrl: API_BASE_URL,
    apiToken: 'test-token',
    version: '1.0.0-test',
  })
}

describe('主机访问 Profile HTTP 合同', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('归一化空集合并对资产与各类 Profile 稳定排序', async () => {
    const assetA = hostAsset('hst_a', 'Alpha')
    const assetB = hostAsset('hst_b', 'Beta')
    const sshA = sshProfile('ssh_a', 0)
    const sshB = sshProfile('ssh_b', 1)
    const fileA = fileProfile('fap_a', 0)
    const fileB = fileProfile('fap_b', 1)
    const remoteA = remoteProfile('rdp_a', 0)
    const remoteB = remoteProfile('rdp_b', 1)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([assetB, assetA]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        host: { ...assetA, tags: null },
        ssh: [sshB, sshA],
        files: [fileB, fileA],
        remote_desktops: [remoteB, remoteA],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const hosts = createGateways().hosts

    await expect(hosts.hostAssets()).resolves.toEqual([assetA, assetB])
    const catalog = await hosts.hostAccessCatalog('host/id')

    expect(catalog.host.tags).toEqual([])
    expect(catalog.ssh.map((profile) => profile.id)).toEqual(['ssh_a', 'ssh_b'])
    expect(catalog.files.map((profile) => profile.id)).toEqual(['fap_a', 'fap_b'])
    expect(catalog.remote_desktops.map((profile) => profile.id)).toEqual(['rdp_a', 'rdp_b'])
    expect(requestAt(fetchMock, 0)).toMatchObject({
      pathname: '/api/v1/host-assets',
      method: 'GET',
    })
    expect(requestAt(fetchMock, 1)).toMatchObject({
      pathname: '/api/v1/hosts/host%2Fid/access-profiles',
      method: 'GET',
    })
  })

  it('精确编码路径、查询参数和所有版本化写请求', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString())
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      const isList = init?.method === 'GET' && [
        '/api/v1/ssh-access-profiles',
        '/api/v1/file-access-profiles',
        '/api/v1/remote-desktop-profiles',
      ].includes(url.pathname)
      return new Response(JSON.stringify(isList ? [] : {}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const hosts = createGateways().hosts
    const sshInput = {
      name: 'Primary SSH',
      address: 'server.example.com',
      port: 22,
      username: 'root',
      auth_method: 'password' as const,
      credential_id: 'cred/id',
      proxy_id: '',
      jump_ssh_profile_id: '',
      fingerprint: '',
      fingerprint_policy: 'confirm_on_change',
    }
    const remoteInput = {
      host_id: 'host/id',
      name: 'Desktop',
      description: '',
      route: 'ssh_tunnel' as const,
      route_config_version: 1 as const,
      ssh_profile_id: 'ssh/id',
      protocol: 'vnc' as const,
      protocol_config_version: 1 as const,
      vnc: {
        loopback_host: '127.0.0.1' as const,
        port: 5901,
        shared: true,
        default_view_only: false,
        default_display_mode: 'fit' as const,
      },
    }

    await hosts.sshAccessProfiles('host/id')
    await hosts.fileAccessProfiles('host/id')
    await hosts.remoteDesktopAccessProfiles('host/id')
    await hosts.updateHostAsset('host/id', UPDATED_AT, {
      name: 'Host',
      platform: 'linux',
      icon_id: '',
      group_id: '',
      tags: ['prod'],
      favorite: true,
      note: '',
      expected_updated_at: 'stale-version',
    } as HostAssetInput)
    await hosts.createSSHAccessProfile('host/id', {
      ...sshInput,
      host_id: 'wrong-host',
    } as typeof sshInput)
    await hosts.updateSSHAccessProfile('ssh/id', UPDATED_AT, sshInput)
    await hosts.deleteSSHAccessProfile('ssh/id', UPDATED_AT)
    await hosts.setDefaultSSHAccessProfile('ssh/id', UPDATED_AT)
    await hosts.updateFileAccessProfile('file/id', UPDATED_AT, { name: 'Files' })
    await hosts.setDefaultFileAccessProfile('file/id', UPDATED_AT)
    await hosts.createRemoteDesktopAccessProfile(remoteInput)
    await hosts.updateRemoteDesktopAccessProfile('rdp/id', UPDATED_AT, remoteInput)
    await hosts.deleteRemoteDesktopAccessProfile('rdp/id', UPDATED_AT)
    await hosts.setDefaultRemoteDesktopAccessProfile('rdp/id', UPDATED_AT)
    await hosts.fileAccessProfiles()

    expect(requestAt(fetchMock, 0)).toMatchObject({
      pathname: '/api/v1/ssh-access-profiles',
      search: '?host_id=host%2Fid',
      method: 'GET',
    })
    expect(requestAt(fetchMock, 1)).toMatchObject({
      pathname: '/api/v1/file-access-profiles',
      search: '?host_id=host%2Fid',
      method: 'GET',
    })
    expect(requestAt(fetchMock, 2)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles',
      search: '?host_id=host%2Fid',
      method: 'GET',
    })
    expect(requestAt(fetchMock, 3)).toMatchObject({
      pathname: '/api/v1/host-assets/host%2Fid',
      method: 'PATCH',
      body: {
        expected_updated_at: UPDATED_AT,
        name: 'Host',
        platform: 'linux',
        icon_id: '',
        group_id: '',
        tags: ['prod'],
        favorite: true,
        note: '',
      },
    })
    expect(requestAt(fetchMock, 4)).toMatchObject({
      pathname: '/api/v1/ssh-access-profiles',
      method: 'POST',
      body: { host_id: 'host/id', ...sshInput },
    })
    expect(requestAt(fetchMock, 5)).toMatchObject({
      pathname: '/api/v1/ssh-access-profiles/ssh%2Fid',
      method: 'PATCH',
      body: { expected_updated_at: UPDATED_AT, ...sshInput },
    })
    expect(requestAt(fetchMock, 6)).toMatchObject({
      pathname: '/api/v1/ssh-access-profiles/ssh%2Fid',
      method: 'DELETE',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 7)).toMatchObject({
      pathname: '/api/v1/ssh-access-profiles/ssh%2Fid/default',
      method: 'POST',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 8)).toMatchObject({
      pathname: '/api/v1/file-access-profiles/file%2Fid',
      method: 'PATCH',
      body: { expected_updated_at: UPDATED_AT, name: 'Files' },
    })
    expect(requestAt(fetchMock, 9)).toMatchObject({
      pathname: '/api/v1/file-access-profiles/file%2Fid/default',
      method: 'POST',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 10)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles',
      method: 'POST',
      body: remoteInput,
    })
    expect(requestAt(fetchMock, 11)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles/rdp%2Fid',
      method: 'PATCH',
      body: { expected_updated_at: UPDATED_AT, ...remoteInput },
    })
    expect(requestAt(fetchMock, 12)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles/rdp%2Fid',
      method: 'DELETE',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 13)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles/rdp%2Fid/default',
      method: 'POST',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 14)).toMatchObject({
      pathname: '/api/v1/file-access-profiles',
      search: '',
      method: 'GET',
    })
  })

  it('显式空 Host 过滤不会退化为无过滤列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const hosts = createGateways().hosts

    await hosts.sshAccessProfiles('')
    await hosts.fileAccessProfiles('')
    await hosts.remoteDesktopAccessProfiles('')

    expect(requestAt(fetchMock, 0).search).toBe('?host_id=')
    expect(requestAt(fetchMock, 1).search).toBe('?host_id=')
    expect(requestAt(fetchMock, 2).search).toBe('?host_id=')
  })
})

function requestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [URL, RequestInit]
  return {
    pathname: url.pathname,
    search: url.search,
    method: init.method,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  }
}

function hostAsset(id: string, name: string): HostAsset {
  return {
    id,
    name,
    platform: 'linux',
    group_id: '',
    tags: [],
    favorite: false,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
  }
}

function sshProfile(id: string, sortOrder: number): SSHAccessProfile {
  return {
    id,
    host_id: 'hst_a',
    name: id,
    address: 'server.example.com',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'cred_a',
    fingerprint_policy: 'confirm_on_change',
    is_default: sortOrder === 0,
    sort_order: sortOrder,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
  }
}

function fileProfile(id: string, sortOrder: number): FileAccessProfile {
  return {
    id,
    host_id: 'hst_a',
    name: id,
    engine: 'sftp',
    engine_config_version: 1,
    sftp: { ssh_profile_id: `ssh_${sortOrder}` },
    is_default: sortOrder === 0,
    sort_order: sortOrder,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
  }
}

function remoteProfile(id: string, sortOrder: number): RemoteDesktopAccessProfile {
  return {
    id,
    host_id: 'hst_a',
    name: id,
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh_a',
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: sortOrder === 0,
    sort_order: sortOrder,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
  }
}
