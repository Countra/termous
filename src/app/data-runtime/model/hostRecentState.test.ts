import assert from 'node:assert/strict'
import test from 'node:test'
import type { Host } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { Session } from './sessionTypes.ts'
import {
  markHostRecentlyConnected,
  reconcileHostRecentTimestamps,
} from './hostRecentState.ts'

test('SSH 会话连接后同步更新旧投影和规范资产的最近访问时间', () => {
  const connectedAt = '2026-08-26T10:00:00Z'
  const result = markHostRecentlyConnected(
    [legacyHost()],
    [hostAsset()],
    [sshSession()],
    'session-a',
    { status: 'connected', connected_at: connectedAt },
  )

  assert.equal(result.hosts[0]?.last_connected_at, connectedAt)
  assert.equal(result.hostAssets[0]?.last_accessed_at, connectedAt)
  assert.equal(result.sessions[0]?.connected_at, connectedAt)
})

test('迟到快照只更新权威字段且不会回退最近访问时间', () => {
  const latest = '2026-08-26T10:00:00Z'
  const stale = '2026-08-26T09:00:00Z'
  const result = reconcileHostRecentTimestamps(
    [{ ...legacyHost(), name: '旧名称', last_connected_at: latest }],
    [{ ...legacyHost(), name: '权威名称', last_connected_at: stale }],
    [{ ...hostAsset(), name: '旧名称', last_accessed_at: latest }],
    [{ ...hostAsset(), name: '权威名称', last_accessed_at: stale }],
  )

  assert.equal(result.hosts[0]?.name, '权威名称')
  assert.equal(result.hosts[0]?.last_connected_at, latest)
  assert.equal(result.hostAssets[0]?.name, '权威名称')
  assert.equal(result.hostAssets[0]?.last_accessed_at, latest)
})

test('同一毫秒内不同纳秒的快照不会替换当前时间', () => {
  const latest = '2026-08-26T10:00:00.000999999Z'
  const stale = '2026-08-26T10:00:00.000000001Z'
  const result = reconcileHostRecentTimestamps(
    [{ ...legacyHost(), last_connected_at: latest }],
    [{ ...legacyHost(), last_connected_at: stale }],
    [{ ...hostAsset(), last_accessed_at: latest }],
    [{ ...hostAsset(), last_accessed_at: stale }],
  )

  assert.equal(result.hosts[0]?.last_connected_at, latest)
  assert.equal(result.hostAssets[0]?.last_accessed_at, latest)
})

function legacyHost(): Host {
  return {
    id: 'host-a',
    name: 'Host A',
    platform: 'linux',
    group_id: '',
    address: '192.0.2.10',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
  }
}

function hostAsset(): HostAsset {
  return {
    id: 'host-a',
    name: 'Host A',
    platform: 'linux',
    group_id: '',
    tags: [],
    favorite: false,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function sshSession(): Session {
  return {
    id: 'session-a',
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-a',
    ssh_profile_id: 'ssh-a',
    status: 'connecting',
    started_at: '2026-08-26T09:59:00Z',
    pty_cols: 120,
    pty_rows: 32,
  }
}
