import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeRemoteDesktopSessionEvent } from './sessionEventProtocol.ts'

const validSession = {
  id: 'rds_test',
  profile_id: 'rdp_test',
  profile_name: '测试桌面',
  host_id: 'host_test',
  host_name: '测试主机',
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
  status_message: '连接已就绪',
  connection_generation: 1,
  viewer_attached: false,
  reconnect_max_attempts: 3,
  created_at: '2026-08-24T08:00:00Z',
  updated_at: '2026-08-24T08:00:01.123456789Z',
}

test('严格解码远程桌面 SSH 链路延迟事件', () => {
  assert.deepEqual(
    decodeRemoteDesktopSessionEvent(JSON.stringify({
      type: 'telemetry',
      session_id: 'rds_test',
      connection_generation: 2,
      ssh_rtt_ms: 19,
      sampled_at: '2026-08-24T08:00:00.123456789Z',
    })),
    {
      type: 'telemetry',
      session_id: 'rds_test',
      connection_generation: 2,
      ssh_rtt_ms: 19,
      sampled_at: '2026-08-24T08:00:00.123456789Z',
    },
  )
})

const invalidEvents = [
  { type: 'telemetry', session_id: '', connection_generation: 1, ssh_rtt_ms: 10, sampled_at: '2026-08-24T08:00:00Z' },
  { type: 'telemetry', session_id: 'rds_test', connection_generation: 0, ssh_rtt_ms: 10, sampled_at: '2026-08-24T08:00:00Z' },
  { type: 'telemetry', session_id: 'rds_test', connection_generation: 1, ssh_rtt_ms: -1, sampled_at: '2026-08-24T08:00:00Z' },
  { type: 'telemetry', session_id: 'rds_test', connection_generation: 1, ssh_rtt_ms: 1.5, sampled_at: '2026-08-24T08:00:00Z' },
  { type: 'telemetry', session_id: 'rds_test', connection_generation: 1, ssh_rtt_ms: 10, sampled_at: 'not-a-time' },
  { type: 'telemetry', session_id: 'rds_test', connection_generation: 1, ssh_rtt_ms: 10, sampled_at: '2026-08-24 08:00:00Z' },
]

test('拒绝字段不完整、越界或非 RFC3339 的 telemetry 事件', () => {
  for (const event of invalidEvents) {
    assert.equal(decodeRemoteDesktopSessionEvent(JSON.stringify(event)), null)
  }
})

test('removed 事件只接收非空会话 ID', () => {
  assert.deepEqual(
    decodeRemoteDesktopSessionEvent(JSON.stringify({
      type: 'removed',
      session: { id: 'rds_test' },
    })),
    { type: 'removed', session: { id: 'rds_test' } },
  )
  assert.equal(
    decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'removed', session: { id: '' } })),
    null,
  )
  assert.equal(
    decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'removed', session: {} })),
    null,
  )
})

test('snapshot 只接收显式数组并严格校验每个会话', () => {
  assert.deepEqual(
    decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'snapshot', sessions: [] })),
    { type: 'snapshot', sessions: [] },
  )
  assert.deepEqual(
    decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'snapshot', sessions: [validSession] })),
    { type: 'snapshot', sessions: [validSession] },
  )
  assert.equal(decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'snapshot' })), null)
  assert.equal(
    decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'snapshot', sessions: null })),
    null,
  )
  assert.equal(
    decodeRemoteDesktopSessionEvent(JSON.stringify({
      type: 'snapshot',
      sessions: [{ ...validSession, connection_generation: -1 }],
    })),
    null,
  )
})

test('upsert 拒绝字段缺失、枚举越界和无效 VNC 目标', () => {
  assert.deepEqual(
    decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'upsert', session: validSession })),
    { type: 'upsert', session: validSession },
  )
  const invalidSessions = [
    { ...validSession, host_id: '' },
    { ...validSession, host_name: '' },
    { ...validSession, ssh_profile_id: '' },
    { ...validSession, updated_at: 'not-a-time' },
    { ...validSession, status: 'unknown' },
    { ...validSession, viewer_attached: 'false' },
    { ...validSession, route: 'unknown' },
    { ...validSession, route_config_version: 0 },
    { ...validSession, protocol_config_version: 65_536 },
    { ...validSession, vnc: { ...validSession.vnc, loopback_host: '10.0.0.2' } },
    { ...validSession, vnc: { ...validSession.vnc, port: 65_536 } },
  ]
  for (const session of invalidSessions) {
    assert.equal(
      decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'upsert', session })),
      null,
    )
  }
})

test('upsert 接受显式为零的重连计数', () => {
  const session = {
    ...validSession,
    reconnect_attempt: 0,
    reconnect_max_attempts: 0,
  }
  assert.deepEqual(
    decodeRemoteDesktopSessionEvent(JSON.stringify({ type: 'upsert', session })),
    { type: 'upsert', session },
  )
})
