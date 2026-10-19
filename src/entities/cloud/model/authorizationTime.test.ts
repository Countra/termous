import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CloudAuthorization } from '../../../../common/contracts/cloud-security.ts'
import { cloudAuthorizationRemaining } from './authorizationTime.ts'

test('批准倒计时使用 Core 剩余期限，系统日期偏差不影响有效状态', () => {
  for (const expires_at of ['2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
    const value = { kind: 'approval', expires_at, remaining_ms: 300_000 } as CloudAuthorization
    assert.equal(cloudAuthorizationRemaining(value, 100), 300_000)
    assert.equal(cloudAuthorizationRemaining(value, 1100), 299_000)
    assert.equal(cloudAuthorizationRemaining(value, 400_100), 0)
  }
})

test('没有 Core 时间快照的设备授权不能使用本机日期降级', () => {
  const value = { kind: 'approval', expires_at: '2099-01-01T00:00:00Z' } as CloudAuthorization
  assert.equal(cloudAuthorizationRemaining(value, 0), 0)
})
