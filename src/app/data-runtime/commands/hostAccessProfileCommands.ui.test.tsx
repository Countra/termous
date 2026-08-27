import { expect, test, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { HostAccessCatalog, HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { HostCommandGateway } from '../api/runtimeGatewayContracts'
import type { SetAppData } from '../model/runtimeTypes'
import { createHostCommands } from './hostCommands'

const UPDATED_AT = '2026-08-25T10:00:00Z'

test('收藏切换只通过版本化资产接口写入非连接字段', async () => {
  const host = legacyHost()
  const sourceAsset = hostAsset()
  const asset = hostAsset({ favorite: true, updated_at: '2026-08-25T10:00:01Z' })
  const api = {
    updateHost: vi.fn(),
    updateHostAsset: vi.fn(async () => asset),
  }
  const load = vi.fn(async () => undefined)
  const commands = createHostCommands({
    api: api as unknown as HostCommandGateway,
    hostAssets: [sourceAsset],
    load,
    setData: vi.fn() as unknown as SetAppData,
  })

  await expect(commands.toggleHostFavorite(host.id)).resolves.toBeUndefined()

  expect(api.updateHostAsset).toHaveBeenCalledWith(host.id, UPDATED_AT, {
    name: host.name,
    platform: host.platform,
    icon_id: host.icon_id,
    group_id: host.group_id,
    tags: host.tags,
    favorite: true,
    note: host.note,
  })
  expect(api.updateHost).not.toHaveBeenCalled()
  expect(load).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledWith('silent')
})

test('收藏切换找不到资产或 CAS 失败时不刷新也不回退到旧接口', async () => {
  const updateError = new Error('asset conflict')
  const api = {
    updateHost: vi.fn(),
    updateHostAsset: vi.fn(async () => {
      throw updateError
    }),
  }
  const load = vi.fn(async () => undefined)
  const missingAssetCommands = createHostCommands({
    api: api as unknown as HostCommandGateway,
    hostAssets: [],
    load,
    setData: vi.fn() as unknown as SetAppData,
  })

  await expect(missingAssetCommands.toggleHostFavorite('hst_a')).resolves.toBeUndefined()
  expect(api.updateHostAsset).not.toHaveBeenCalled()

  const conflictCommands = createHostCommands({
    api: api as unknown as HostCommandGateway,
    hostAssets: [hostAsset()],
    load,
    setData: vi.fn() as unknown as SetAppData,
  })
  await expect(conflictCommands.toggleHostFavorite('hst_a')).rejects.toBe(updateError)
  expect(api.updateHost).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

test('删除主机分组后通过权威快照刷新资产版本', async () => {
  const api = { deleteHostGroup: vi.fn().mockResolvedValue(undefined) }
  const load = vi.fn().mockResolvedValue(undefined)
  const commands = createHostCommands({
    api: api as unknown as HostCommandGateway,
    hostAssets: [hostAsset()],
    load,
    setData: vi.fn() as unknown as SetAppData,
  })

  await commands.deleteHostGroup('grp_a')

  expect(api.deleteHostGroup).toHaveBeenCalledWith('grp_a')
  expect(load).toHaveBeenCalledWith('silent')
})

test('Profile 只读查询直接透传，写入成功后才触发静默对账', async () => {
  const catalog: HostAccessCatalog = {
    host: hostAsset(),
    ssh: [],
    files: [],
    remote_desktops: [],
  }
  const updatedSSH = sshProfile()
  const writeError = new Error('write failed')
  const api = {
    hostAccessCatalog: vi.fn(async () => catalog),
    updateSSHAccessProfile: vi.fn(async () => updatedSSH),
    createRemoteDesktopAccessProfile: vi.fn(async () => {
      throw writeError
    }),
  }
  const load = vi.fn(async () => undefined)
  const commands = createHostCommands({
    api: api as unknown as HostCommandGateway,
    hostAssets: [],
    load,
    setData: vi.fn() as unknown as SetAppData,
  })
  const sshInput = {
    name: 'Primary SSH',
    address: 'server.example.com',
    port: 22,
    username: 'root',
    auth_method: 'password' as const,
    credential_id: 'cred_a',
    proxy_id: '',
    jump_ssh_profile_id: '',
    fingerprint: '',
    fingerprint_policy: 'confirm_on_change',
  }

  await expect(commands.hostAccessCatalog('hst_a')).resolves.toBe(catalog)
  expect(load).not.toHaveBeenCalled()

  await expect(commands.updateSSHAccessProfile('ssh_a', UPDATED_AT, sshInput))
    .resolves.toBe(updatedSSH)
  expect(load).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledWith('silent')

  load.mockClear()
  await expect(commands.createRemoteDesktopAccessProfile({
    host_id: 'hst_a',
    name: 'Desktop',
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
  })).rejects.toBe(writeError)
  expect(load).not.toHaveBeenCalled()
})

function legacyHost(overrides: Partial<Host> = {}): Host {
  return {
    id: 'hst_a',
    name: 'Production',
    platform: 'linux',
    icon_id: 'icon_a',
    group_id: 'grp_a',
    address: 'server.example.com',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'cred_a',
    tags: ['prod'],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
    note: 'Primary host',
    updated_at: UPDATED_AT,
    ...overrides,
  }
}

function hostAsset(overrides: Partial<HostAsset> = {}): HostAsset {
  return {
    id: 'hst_a',
    name: 'Production',
    platform: 'linux',
    icon_id: 'icon_a',
    group_id: 'grp_a',
    tags: ['prod'],
    favorite: false,
    note: 'Primary host',
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  }
}

function sshProfile(): SSHAccessProfile {
  return {
    id: 'ssh_a',
    host_id: 'hst_a',
    name: 'Primary SSH',
    address: 'server.example.com',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'cred_a',
    fingerprint_policy: 'confirm_on_change',
    is_default: true,
    sort_order: 0,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
  }
}
