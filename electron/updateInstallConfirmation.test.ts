import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UpdateInstallConfirmationAuthority,
  normalizeRuntimeSummary,
} from './updateInstallConfirmation.ts'
import type { UpdateSnapshot } from './updateTypes.ts'

function downloadedSnapshot(
  patch: Partial<UpdateSnapshot> = {},
): UpdateSnapshot {
  return {
    state_seq: 8,
    operation_generation: 3,
    phase: 'downloaded',
    current_version: '1.0.0',
    available_version: '1.1.0',
    release_name: null,
    release_date: null,
    release_url: null,
    release_notes: null,
    progress: null,
    checked_at: null,
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: null,
      revision: 0,
    },
    next_automatic_check_at: null,
    ...patch,
  }
}

test('确认令牌绑定下载状态、代际和活动摘要且只能使用一次', () => {
  const authority = new UpdateInstallConfirmationAuthority({
    now: () => 1_000,
    randomToken: () => 'confirmation-token',
  })
  authority.updateSummary({
    ssh_sessions: 2,
    file_sessions: 3,
    forwards: 4,
    transfers: 5,
  })
  const snapshot = downloadedSnapshot()
  const confirmation = authority.issue(snapshot)

  assert.equal(confirmation.confirmation_token, 'confirmation-token')
  assert.deepEqual(confirmation.summary, {
    ssh_sessions: 2,
    file_sessions: 3,
    forwards: 4,
    transfers: 5,
  })
  authority.consume('confirmation-token', snapshot)
  assert.throws(
    () => authority.consume('confirmation-token', snapshot),
    /update_install_confirmation_invalid/,
  )
})

test('状态变化、代际变化和过期令牌均不能启动安装', () => {
  let now = 1_000
  const authority = new UpdateInstallConfirmationAuthority({
    now: () => now,
    randomToken: () => 'confirmation-token',
    ttlMs: 50,
  })
  const snapshot = downloadedSnapshot()

  authority.issue(snapshot)
  authority.reconcile({ ...snapshot, state_seq: snapshot.state_seq + 1 })
  assert.throws(
    () => authority.consume('confirmation-token', snapshot),
    /update_install_confirmation_invalid/,
  )

  authority.issue(snapshot)
  now += 51
  assert.throws(
    () => authority.consume('confirmation-token', snapshot),
    /update_install_confirmation_invalid/,
  )
})

test('活动摘要仅接受有限的非负安全整数', () => {
  assert.deepEqual(normalizeRuntimeSummary({
    ssh_sessions: -1,
    file_sessions: Number.POSITIVE_INFINITY,
    forwards: 100_001,
    transfers: 7,
  }), {
    ssh_sessions: 0,
    file_sessions: 0,
    forwards: 100_000,
    transfers: 7,
  })
})
