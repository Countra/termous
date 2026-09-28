import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { HostAccessCatalog, HostAsset, HostAssetInput, HostProvisionInput } from '#entities/host-asset'
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
    vi.useRealTimers()
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

  it('聚合创建使用一个请求提交主机、连接引用和认证草稿', async () => {
    const input = provisionInput()
    const catalog = provisionCatalog(input)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createGateways().hosts.provisionHost(input)).resolves.toEqual(catalog)

    expect(requestAt(fetchMock, 0)).toEqual({
      pathname: '/api/v1/host-assets/provision', search: '', method: 'POST', body: input,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('响应丢失后重发原请求，冲突仍保留错误而不把同 ID 当作草稿已保存', async () => {
    const input = provisionInput()
    const catalog = provisionCatalog(input)
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(provisionConflict(catalog.host.id))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createGateways().hosts.provisionHost(input)).rejects.toMatchObject({ code: 'HOST_ASSET_CONFLICT' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestAt(fetchMock, 1)).toEqual(requestAt(fetchMock, 0))
  })

  it('超时只重试一次相同请求并返回完整目录', async () => {
    vi.useFakeTimers()
    const input = provisionInput()
    const catalog = provisionCatalog(input)
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const assertion = expect(createGateways().hosts.provisionHost(input)).resolves.toEqual(catalog)

    await vi.advanceTimersByTimeAsync(12_000)
    await assertion

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestAt(fetchMock, 1)).toEqual(requestAt(fetchMock, 0))
  })

  it.each([
    { status: 409, code: 'HOST_ASSET_CONFLICT' },
    { status: 400, code: 'VALIDATION_ERROR' },
  ])('首次明确 $code 不重试也不当作创建成功', async ({ status, code }) => {
    const input = provisionInput()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code, message: 'rejected', details: { host_id: provisionCatalog(input).host.id } },
    }), { status }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createGateways().hosts.provisionHost(input)).rejects.toMatchObject({ code })

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('重试冲突中的主机 ID 不匹配时不读取其他主机', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(provisionConflict('hst_other'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createGateways().hosts.provisionHost(provisionInput())).rejects.toMatchObject({
      code: 'HOST_ASSET_CONFLICT', details: { host_id: 'hst_other' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('连续网络失败在一次重试后结束，保持错误交给草稿层', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection lost'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createGateways().hosts.provisionHost(provisionInput())).rejects.toMatchObject({ code: 'NETWORK_ERROR' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestAt(fetchMock, 1)).toEqual(requestAt(fetchMock, 0))
  })

  it('精确编码路径、查询参数和所有版本化写请求', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString())
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      if (url.pathname === '/api/v1/file-access-engines') {
        return new Response(JSON.stringify([{
          id: 'sftp', config_versions: [1], current_config_version: 1,
          host_scope: 'required', capabilities: ['list'],
        }]), { status: 200 })
      }
      if (url.pathname.endsWith('/references')) {
        return new Response(JSON.stringify({
          agent_sessions: 0, active_file_sessions: 0, is_default: false,
          peer_profiles: 1, blocking_total: 0,
        }), { status: 200 })
      }
      const isList = init?.method === 'GET' && [
        '/api/v1/ssh-access-profiles',
        '/api/v1/file-access-profiles',
        '/api/v1/remote-desktop-profiles',
      ].includes(url.pathname)
      if (isList) return new Response(JSON.stringify([]), { status: 200 })
      if (url.pathname.startsWith('/api/v1/file-access-profiles')) {
        return new Response(JSON.stringify(fileProfile('file_returned', 0)), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
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
        target_host: '127.0.0.1' as const,
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
    await hosts.fileAccessEngines()
    await hosts.createFileAccessProfile({
      host_id: 'host/id',
      name: 'Files',
      engine: 'sftp',
      engine_config_version: 1,
      config: { ssh_profile_id: 'ssh/id' },
    })
    await hosts.updateFileAccessProfile('file/id', UPDATED_AT, {
      name: 'Files',
      engine_config_version: 1,
      config: { ssh_profile_id: 'ssh/new' },
    })
    await hosts.inspectFileAccessProfileReferences('file/id')
    await hosts.deleteFileAccessProfile('file/id', UPDATED_AT)
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
      pathname: '/api/v1/file-access-engines',
      method: 'GET',
    })
    expect(requestAt(fetchMock, 9)).toMatchObject({
      pathname: '/api/v1/file-access-profiles',
      method: 'POST',
      body: {
        host_id: 'host/id',
        name: 'Files',
        engine: 'sftp',
        engine_config_version: 1,
        config: { ssh_profile_id: 'ssh/id' },
      },
    })
    expect(requestAt(fetchMock, 10)).toMatchObject({
      pathname: '/api/v1/file-access-profiles/file%2Fid',
      method: 'PATCH',
      body: {
        expected_updated_at: UPDATED_AT,
        name: 'Files',
        engine_config_version: 1,
        config: { ssh_profile_id: 'ssh/new' },
      },
    })
    expect(requestAt(fetchMock, 11)).toMatchObject({
      pathname: '/api/v1/file-access-profiles/file%2Fid/references',
      method: 'GET',
    })
    expect(requestAt(fetchMock, 12)).toMatchObject({
      pathname: '/api/v1/file-access-profiles/file%2Fid',
      method: 'DELETE',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 13)).toMatchObject({
      pathname: '/api/v1/file-access-profiles/file%2Fid/default',
      method: 'POST',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 14)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles',
      method: 'POST',
      body: remoteInput,
    })
    expect(requestAt(fetchMock, 15)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles/rdp%2Fid',
      method: 'PATCH',
      body: { expected_updated_at: UPDATED_AT, ...remoteInput },
    })
    expect(requestAt(fetchMock, 16)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles/rdp%2Fid',
      method: 'DELETE',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 17)).toMatchObject({
      pathname: '/api/v1/remote-desktop-profiles/rdp%2Fid/default',
      method: 'POST',
      body: { expected_updated_at: UPDATED_AT },
    })
    expect(requestAt(fetchMock, 18)).toMatchObject({
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

  it('使用独立 SSH Profile 可达性端点并精确提交 Profile ID', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const hosts = createGateways().hosts

    await hosts.sshProfileReachability()
    await hosts.refreshSSHProfileReachability(['ssh-a', 'ssh-b'], true)

    expect(requestAt(fetchMock, 0)).toMatchObject({
      pathname: '/api/v1/ssh-access-profiles/reachability',
      method: 'GET',
    })
    expect(requestAt(fetchMock, 1)).toMatchObject({
      pathname: '/api/v1/ssh-access-profiles/reachability/refresh',
      method: 'POST',
      body: { ssh_profile_ids: ['ssh-a', 'ssh-b'], force: true },
    })
    expect(hosts.sshProfileReachabilityEventsUrl()).toContain(
      '/api/v1/ssh-access-profiles/reachability/events',
    )
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

function provisionInput(): HostProvisionInput {
  return {
    client_request_id: '3a76c45d-c609-44ea-922a-47a70c7e95aa',
    host: {
      name: 'Aggregate host', platform: 'linux', icon_id: '', group_id: '',
      tags: [], favorite: false, note: '包含连接草稿',
    },
    ssh: [{
      draft_id: 'draft:ssh', name: 'Terminal', address: 'server.example.com', port: 22,
      username: 'root', auth_method: 'password', credential_id: 'cred_a',
      proxy_id: '', jump_ssh_profile_id: '', fingerprint: '', fingerprint_policy: 'confirm_on_change',
      is_default: true, file_name: 'Project files', file_is_default: true,
    }],
    remote_desktops: [{
      draft_id: 'draft:vnc', name: 'Desktop', description: '', route: 'ssh_tunnel',
      route_config_version: 1, ssh_draft_id: 'draft:ssh', protocol: 'vnc', protocol_config_version: 1,
      vnc: {
        target_host: '127.0.0.1', port: 5900, shared: true,
        default_view_only: false, default_display_mode: 'fit',
      },
      target_auth_password: 'fixture-password', is_default: true,
    }],
  }
}

function provisionCatalog(input: HostProvisionInput): HostAccessCatalog {
  const id = `hst_${input.client_request_id.replace(/-/g, '').toLowerCase()}`
  return {
    host: { ...hostAsset(id, input.host.name), ...input.host },
    ssh: [{ ...sshProfile('ssh_created', 0), host_id: id }],
    files: [{ ...fileProfile('file_created', 0), host_id: id, sftp: { ssh_profile_id: 'ssh_created' } }],
    remote_desktops: [{ ...remoteProfile('vnc_created', 0), host_id: id, route: 'ssh_tunnel', ssh_profile_id: 'ssh_created' }],
  }
}

function provisionConflict(hostId: string) {
  return new Response(JSON.stringify({
    error: { code: 'HOST_ASSET_CONFLICT', message: 'already created', details: { host_id: hostId } },
  }), { status: 409 })
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
    config: { ssh_profile_id: `ssh_${sortOrder}` },
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
      target_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: sortOrder === 0,
    sort_order: sortOrder,
    target_auth: null,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
  }
}
