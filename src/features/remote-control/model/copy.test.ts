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
      ['AGENT_REVISION_CONFLICT', copy.contentChanged],
      ['MCP_CONFLICT', copy.contentChanged],
      ['desktop_files_unauthorized', copy.desktopFilesDenied],
      ['desktop_files_unsupported', copy.desktopFilesUnsupported],
      ['desktop_files_stale', copy.desktopFilesStale],
      ['desktop_files_revoking', copy.desktopFilesBusy],
      ['desktop_busy', copy.desktopFilesBusy],
      ['desktop_files_storage_failed', copy.desktopFilesStorage],
      ['desktop_directory_operation_failed', copy.desktopFilesMapping],
      ['desktop_directory_path_too_long', copy.desktopFilesPathLong],
      ['desktop_files_expired', copy.desktopFilesExpired],
    ]) {
      assert.equal(remoteErrorText(copy, { code }), expected, `${language}: ${code}`)
    }
    assert.equal(remoteErrorText(copy, { code: 'UNAUTHORIZED', uncertain: true }), copy.uncertain)
    assert.equal(remoteErrorText(copy, new Error('private response')), copy.error)
  }
})
