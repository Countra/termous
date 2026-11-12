import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopDiagnosticLog } from './desktopDiagnostics.ts'

test('常态拒绝调试事件及伪造等级，连通与失败摘要保留独立额度', () => {
  const log = new DesktopDiagnosticLog()
  const input = { event: 'state', stage: 'create_offer', attempt_id: 'attempt', level: 'warn', url: 'turn:private', password: 'secret' }
  assert.equal(log.accept(input, false, 1), undefined)
  for (let i = 0; i < 240; i++) assert.ok(log.accept(input, true, 1))
  assert.equal(log.accept(input, true, 2), undefined)
  const failure = log.accept({ ...input, event: 'failed', error_code: 'desktop_connection_timeout' }, false, 2)
  assert.deepEqual(failure, { event: 'failed', stage: 'create_offer', attempt_id: 'attempt', error_code: 'desktop_connection_timeout' })
  assert.ok(log.accept({ ...input, event: 'connected' }, false, 2))
  assert.ok(log.accept(input, true, 60_001))
  assert.equal(log.accept({ ...input, attempt_id: 'invalid\nsecret' }, true, 60_002), undefined)
})

test('IPC 保留必要收集证据，删除旧重型统计与敏感数据', () => {
  const log = new DesktopDiagnosticLog()
  const value = log.accept({ event: 'failed', stage: 'create_offer', attempt_id: 'attempt', server_index: 1, url_index: 2,
    server_kind: 'turn_tls', local_relay: 13, gathering: 'gathering', candidate_idle_ms: 14_000, first_candidate_ms: 15,
    ice_error_code: 508, error_code: 'desktop_connection_timeout', relay_tls: 3, stats_age_ms: 1000,
    url: 'turns:private.invalid', address: '2001:db8::1', errorText: 'private-password' }, false, 1)
  assert.equal(value?.local_relay, 13)
  assert.equal(value?.candidate_idle_ms, 14_000)
  assert.equal(value?.ice_error_code, 508)
  assert.doesNotMatch(JSON.stringify(value), /private|2001:db8|errorText|relay_tls|stats_age_ms/)
})
