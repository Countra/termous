import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { shouldAcceptSessionSnapshot } from './sessionSnapshot.ts'

test('拒绝较低连接代次的迟到快照', () => {
  const current = session({
    connection_generation: 2,
    status: 'ready',
    phase: 'ready',
    updated_at: '2026-08-24T03:32:04.100000001Z',
  })
  const incoming = session({
    connection_generation: 1,
    status: 'reconnecting',
    phase: 'dialing_ssh',
    updated_at: '2026-08-24T03:32:05Z',
  })

  assert.equal(shouldAcceptSessionSnapshot(current, incoming), false)
})

test('同一代次按纳秒精度拒绝较旧快照', () => {
  const current = session({ updated_at: '2026-08-24T03:32:04.100000002Z' })
  const incoming = session({ updated_at: '2026-08-24T03:32:04.100000001Z' })

  assert.equal(shouldAcceptSessionSnapshot(current, incoming), false)
  assert.equal(shouldAcceptSessionSnapshot(incoming, current), true)
})

test('接受连接代次更高的权威快照', () => {
  const current = session({ connection_generation: 1, updated_at: '2026-08-24T03:32:05Z' })
  const incoming = session({ connection_generation: 2, updated_at: '2026-08-24T03:32:04Z' })

  assert.equal(shouldAcceptSessionSnapshot(current, incoming), true)
})

function session(overrides: Partial<RemoteDesktopSession> = {}): RemoteDesktopSession {
  return {
    id: 'rds_test',
    profile_id: 'rdp_test',
    profile_name: 'Test desktop',
    host_id: 'hst_test',
    host_name: 'Test host',
    ssh_profile_id: 'ssh_test',
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
    status: 'ready',
    phase: 'ready',
    status_message: 'ready',
    connection_generation: 1,
    viewer_attached: false,
    reconnect_attempt: 0,
    reconnect_max_attempts: 3,
    created_at: '2026-08-24T03:32:00Z',
    updated_at: '2026-08-24T03:32:04Z',
    ...overrides,
  }
}
