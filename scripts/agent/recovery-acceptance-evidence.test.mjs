import assert from 'node:assert/strict'
import test from 'node:test'
import { recoveryEvidence } from './recovery-acceptance-evidence.mjs'

test('恢复验收区分同轮核验与下一轮纠错，拒绝重复失败或没有真实核验的完成旁白', () => {
  const old = { name: 'termous.desktops.get', request: 2, args: { session_id: 'old' }, error_code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND', failed: true }
  const valid = { name: 'termous.desktops.get', request: 3, args: { session_id: 'current' }, failed: false, verified_session: 'current' }
  const sessions = [{ id: 'current', status: 'ready', connection_generation: 1 }]
  for (const request of [2, 3, 4]) {
    const evidence = recoveryEvidence({ status: 'completed', calls: [old, { ...valid, request }] }, 'old', sessions)
    assert.equal(evidence.success, true)
    assert.equal(evidence.recovery_requests, request - 2)
    assert.equal(evidence.recovery_mode, request === 2 ? 'same-request-verification' : 'next-request-recovery')
  }
  for (const calls of [[old], [valid], [old, { ...old, request: 3 }, valid], [old, { ...valid, request: 5 }], [old, { ...valid, failed: true }]]) {
    assert.equal(recoveryEvidence({ status: 'completed', calls }, 'old', sessions).success, false)
  }
  assert.equal(recoveryEvidence({ status: 'completed', calls: [old, valid] }, 'old', [{ ...sessions[0], status: 'failed' }]).success, false)
  const list = { name: 'termous.desktops.list', request: 2, args: {}, failed: false }
  assert.equal(recoveryEvidence({ status: 'completed', calls: [old, list, valid] }, 'old', sessions).recovery_requests, 1)
  const discover = { name: 'discover_tools', request: 3, args: {}, failed: false, discovered_tools: ['termous.desktops.connect'] }
  assert.equal(recoveryEvidence({ status: 'completed', calls: [old, discover, { ...valid, request: 5 }] }, 'old', sessions).success, true)
})
