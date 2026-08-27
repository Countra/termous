import assert from 'node:assert/strict'
import test from 'node:test'
import {
  remoteDesktopAccessProfileToInput,
  selectDefaultRemoteDesktopAccessProfile,
  sortRemoteDesktopAccessProfiles,
} from './accessProfile.ts'
import type { RemoteDesktopAccessProfile } from './types.ts'
import { projectRemoteDesktopAccessProfile } from './accessProfileProjection.ts'

test('远程桌面精确 Profile 输入不回传兼容别名和持久化字段', () => {
  const source = profile('rdp_b', 1, true)
  const legacySource = {
    ...source,
    transport: 'ssh_tunnel',
    ssh_host_id: 'hst_1',
  }
  const input = remoteDesktopAccessProfileToInput(legacySource)
  assert.equal('transport' in input, false)
  assert.equal('ssh_host_id' in input, false)
  assert.equal(input.ssh_profile_id, 'ssh_1')
  assert.notEqual(input.vnc, source.vnc)
})

test('远程桌面默认项不猜测并按 Host 与顺序稳定排列', () => {
  const first = profile('rdp_b', 1, true)
  const second = profile('rdp_a', 0, false)
  assert.deepEqual(sortRemoteDesktopAccessProfiles([first, second]).map((item) => item.id), ['rdp_a', 'rdp_b'])
  assert.equal(selectDefaultRemoteDesktopAccessProfile([first, second], 'hst_1')?.id, 'rdp_b')
})

test('远程桌面公共投影隐藏 VNC 与路由私有配置', () => {
  const projection = projectRemoteDesktopAccessProfile(profile('rdp_a', 0, true))
  assert.deepEqual(projection, {
    profileId: 'rdp_a',
    hostId: 'hst_1',
    name: 'rdp_a',
    technology: { id: 'vnc', label: 'VNC' },
    endpoint: '127.0.0.1:5901',
    route: 'ssh_tunnel',
    routeDependency: { kind: 'ssh_profile', profileId: 'ssh_1' },
    isDefault: true,
    sortOrder: 0,
  })
  assert.equal('vnc' in projection, false)
  assert.equal('ssh_profile_id' in projection, false)
})

test('VNC 直连投影不声明 SSH 依赖且输入不携带 SSH Profile', () => {
  const tunneled = profile('rdp_direct', 0, true)
  const { ssh_profile_id: _sshProfileID, ...withoutSSHProfile } = tunneled
  assert.equal(_sshProfileID, 'ssh_1')
  const direct: RemoteDesktopAccessProfile = {
    ...withoutSSHProfile,
    route: 'direct',
    vnc: { ...tunneled.vnc, target_host: '2001:db8::10' },
  }
  const input = remoteDesktopAccessProfileToInput(direct)
  const projection = projectRemoteDesktopAccessProfile(direct)

  assert.equal('ssh_profile_id' in input, false)
  assert.equal(projection.endpoint, '[2001:db8::10]:5901')
  assert.equal(projection.route, 'direct')
  assert.equal(projection.routeDependency, null)
})

function profile(id: string, sortOrder: number, isDefault: boolean): RemoteDesktopAccessProfile {
  return {
    id,
    host_id: 'hst_1',
    name: id,
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh_1',
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      target_host: '127.0.0.1',
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: isDefault,
    sort_order: sortOrder,
    target_auth: null,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}
