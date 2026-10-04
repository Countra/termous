import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteCopy, remoteErrorText } from './copy.ts'

test('远控连接错误区分网络、认证、信任、限流与目标状态', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    const copy = remoteCopy(language)
    for (const [code, expected] of [
      ['REMOTE_SIGNALING_UNAVAILABLE', copy.signalingUnavailable],
      ['REMOTE_SIGNALING_REJECTED', copy.signalingRejected],
      ['REMOTE_SIGNALING_UPGRADE_REJECTED', copy.signalingUpgradeRejected],
      ['CLIENT_UPGRADE_REQUIRED', copy.upgradeRequired],
      ['UNAUTHORIZED', copy.loginRequired],
      ['FORBIDDEN', copy.membershipRequired],
      ['MEMBERSHIP_CONFLICT', copy.membershipRequired],
      ['RATE_LIMITED', copy.rateLimited],
      ['REMOTE_DISABLED', copy.serviceUnsupported],
      ['REMOTE_NOT_SUPPORTED', copy.serviceUnsupported],
      ['REMOTE_HOST_UNAVAILABLE', copy.hostUnavailable],
      ['REMOTE_ACCOUNT_UNAVAILABLE', copy.accountUnavailable],
      ['REMOTE_POLICY_CHANGED', copy.policyChanged],
      ['REMOTE_FILE_FORBIDDEN', copy.denied],
    ]) {
      assert.equal(remoteErrorText(copy, { code }), expected, `${language}: ${code}`)
    }
    assert.equal(remoteErrorText(copy, { code: 'UNAUTHORIZED', uncertain: true }), copy.uncertain)
    assert.equal(remoteErrorText(copy, new Error('private response')), copy.error)
  }
})
