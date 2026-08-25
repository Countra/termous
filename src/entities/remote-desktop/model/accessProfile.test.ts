import assert from 'node:assert/strict'
import test from 'node:test'
import {
  remoteDesktopAccessProfileToInput,
  selectDefaultRemoteDesktopAccessProfile,
  sortRemoteDesktopAccessProfiles,
} from './accessProfile.ts'
import type { RemoteDesktopAccessProfile } from './types.ts'

test('远程桌面精确 Profile 输入不回传兼容别名和持久化字段', () => {
  const source = profile('rdp_b', 1, true)
  const input = remoteDesktopAccessProfileToInput({
    ...source,
    transport: 'ssh_tunnel',
    ssh_host_id: 'hst_1',
  })
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
      loopback_host: '127.0.0.1',
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: isDefault,
    sort_order: sortOrder,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}
