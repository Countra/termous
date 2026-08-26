import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { countRemoteDesktopProfileRuntimeUsage } from './remoteDesktopProfileRuntimeUsage.ts'

test('远程桌面 Profile 统计精确匹配且尚未移除的全部会话', () => {
  const sessions = [
    session('ready', 'profile-a', 'ready'),
    session('reconnecting', 'profile-a', 'reconnecting'),
    session('failed', 'profile-a', 'failed'),
    session('other', 'profile-b', 'streaming'),
  ]

  assert.equal(countRemoteDesktopProfileRuntimeUsage('profile-a', sessions), 3)
  assert.equal(countRemoteDesktopProfileRuntimeUsage('', sessions), 0)
})

function session(
  id: string,
  profileId: string,
  status: RemoteDesktopSession['status'],
): RemoteDesktopSession {
  return {
    id,
    profile_id: profileId,
    profile_name: profileId,
    host_id: 'host-a',
    host_name: 'Host A',
    ssh_profile_id: 'ssh-a',
    route: 'ssh_tunnel',
    route_config_version: 1,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    status,
    phase: status === 'failed' ? 'failed' : 'ready',
    connection_generation: 1,
    viewer_attached: false,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}
