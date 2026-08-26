import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  buildHostLauncherProfileMenu,
  selectUniqueDefaultHostLauncherProfile,
} from './hostLauncherProfiles.ts'
import type { HostLauncherProfileData } from './types.ts'

test('终端 Profile 按主机和稳定顺序枚举并严格解析唯一默认项', () => {
  const source = [
    sshProfile('ssh-secondary', 'host-a', 1, true),
    sshProfile('ssh-other-host', 'host-b', 0, true),
    sshProfile('ssh-primary', 'host-a', 0, false),
  ]
  const menu = buildHostLauncherProfileMenu(profileData({ sshAccessProfiles: source }), 'host-a', 'terminal')

  assert.deepEqual(menu.items.map((item) => item.profileId), ['ssh-primary', 'ssh-secondary'])
  assert.deepEqual(menu.items[0], {
    profileId: 'ssh-primary',
    hostId: 'host-a',
    intent: 'terminal',
    actionId: 'connect',
    technology: 'ssh',
    name: 'ssh-primary',
    endpoint: 'root@primary.example:22',
    route: null,
    isDefault: false,
    sortOrder: 0,
    availability: 'ready',
  })
  assert.equal(menu.defaultResolution, 'resolved')
  assert.equal(menu.defaultItem?.profileId, 'ssh-secondary')
  assert.deepEqual(source.map((profile) => profile.id), [
    'ssh-secondary',
    'ssh-other-host',
    'ssh-primary',
  ])
})

test('文件和远程桌面菜单投影绑定的 SSH 路由与协议端点', () => {
  const route = sshProfile('ssh-route', 'host-a', 0, true)
  const data: HostLauncherProfileData = {
    sshAccessProfiles: [route],
    fileAccessProfiles: [fileProfile('file-a', 'host-a', 'ssh-route', true)],
    remoteDesktopProfiles: [desktopProfile('desktop-a', 'host-a', 'ssh-route', true)],
  }

  const files = buildHostLauncherProfileMenu(data, 'host-a', 'files')
  assert.deepEqual(files.items[0], {
    profileId: 'file-a',
    hostId: 'host-a',
    intent: 'files',
    actionId: 'openFiles',
    technology: 'sftp',
    name: 'file-a',
    endpoint: 'root@route.example:22',
    route: {
      profileId: 'ssh-route',
      name: 'ssh-route',
      endpoint: 'root@route.example:22',
    },
    isDefault: true,
    sortOrder: 0,
    availability: 'ready',
  })
  assert.equal(files.defaultResolution, 'resolved')

  const desktop = buildHostLauncherProfileMenu(data, 'host-a', 'remote_desktop')
  assert.equal(desktop.items[0]?.technology, 'vnc')
  assert.equal(desktop.items[0]?.endpoint, '[::1]:5901')
  assert.equal(desktop.items[0]?.route?.profileId, 'ssh-route')
  assert.equal(desktop.defaultResolution, 'resolved')
})

test('缺失、重复和不可用默认项保持可区分且不猜测', () => {
  const withoutDefault = buildHostLauncherProfileMenu(profileData({
    sshAccessProfiles: [sshProfile('ssh-a', 'host-a', 0, false)],
  }), 'host-a', 'terminal')
  assert.equal(withoutDefault.defaultResolution, 'missing')
  assert.equal(withoutDefault.defaultItem, null)

  const duplicatedDefault = buildHostLauncherProfileMenu(profileData({
    sshAccessProfiles: [
      sshProfile('ssh-a', 'host-a', 0, true),
      sshProfile('ssh-b', 'host-a', 1, true),
    ],
  }), 'host-a', 'terminal')
  assert.equal(duplicatedDefault.defaultResolution, 'ambiguous')
  assert.equal(duplicatedDefault.defaultItem, null)
  assert.equal(selectUniqueDefaultHostLauncherProfile(duplicatedDefault.items), undefined)

  const unavailable = buildHostLauncherProfileMenu(profileData({
    fileAccessProfiles: [fileProfile('file-a', 'host-a', 'ssh-missing', true)],
  }), 'host-a', 'files')
  assert.equal(unavailable.defaultResolution, 'unavailable')
  assert.equal(unavailable.defaultItem?.profileId, 'file-a')
  assert.equal(unavailable.defaultItem?.availability, 'route_missing')

  const empty = buildHostLauncherProfileMenu(profileData(), 'host-a', 'remote_desktop')
  assert.equal(empty.defaultResolution, 'empty')
  assert.deepEqual(empty.items, [])
})

function profileData(
  overrides: Partial<HostLauncherProfileData> = {},
): HostLauncherProfileData {
  return {
    sshAccessProfiles: [],
    fileAccessProfiles: [],
    remoteDesktopProfiles: [],
    ...overrides,
  }
}

function sshProfile(
  id: string,
  hostId: string,
  sortOrder: number,
  isDefault: boolean,
): SSHAccessProfile {
  const endpointName = id.replace(/^ssh-/, '')
  return {
    id,
    host_id: hostId,
    name: id,
    address: `${endpointName}.example`,
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential-a',
    fingerprint_policy: 'confirm_on_change',
    is_default: isDefault,
    sort_order: sortOrder,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function fileProfile(
  id: string,
  hostId: string,
  sshProfileId: string,
  isDefault: boolean,
): FileAccessProfile {
  return {
    id,
    host_id: hostId,
    name: id,
    engine: 'sftp',
    engine_config_version: 1,
    sftp: { ssh_profile_id: sshProfileId },
    is_default: isDefault,
    sort_order: 0,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function desktopProfile(
  id: string,
  hostId: string,
  sshProfileId: string,
  isDefault: boolean,
): RemoteDesktopAccessProfile {
  return {
    id,
    host_id: hostId,
    name: id,
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: sshProfileId,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '::1',
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: isDefault,
    sort_order: 0,
    target_auth: null,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}
