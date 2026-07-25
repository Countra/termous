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

function markSummaryReady(authority: UpdateInstallConfirmationAuthority) {
  authority.updateSummary({
    ssh_sessions: 0,
    file_sessions: 0,
    forwards: 0,
    transfers: 0,
    transfers_complete: true,
  })
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
    transfers_complete: true,
  })
  const snapshot = downloadedSnapshot()
  const confirmation = authority.issue(snapshot)

  assert.equal(confirmation.confirmation_token, 'confirmation-token')
  assert.deepEqual(confirmation.summary, {
    ssh_sessions: 2,
    file_sessions: 3,
    forwards: 4,
    transfers: 5,
    transfers_complete: true,
  })
  assert.equal(confirmation.summary_revision, 1)
  authority.consume('confirmation-token', snapshot)
  assert.throws(
    () => authority.consume('confirmation-token', snapshot),
    /update_install_confirmation_invalid/,
  )
})

test('活动摘要变化会使旧确认失效并要求重新确认', () => {
  let tokenSequence = 0
  const authority = new UpdateInstallConfirmationAuthority({
    now: () => 1_000,
    randomToken: () => `confirmation-${++tokenSequence}`,
  })
  const snapshot = downloadedSnapshot()
  authority.updateSummary({
    ssh_sessions: 0,
    file_sessions: 0,
    forwards: 0,
    transfers: 0,
    transfers_complete: true,
  })
  const stale = authority.issue(snapshot)

  authority.updateSummary({
    ssh_sessions: 1,
    file_sessions: 0,
    forwards: 0,
    transfers: 0,
    transfers_complete: true,
  })
  assert.throws(
    () => authority.consume(stale.confirmation_token, snapshot),
    /update_install_confirmation_invalid/,
  )

  const current = authority.issue(snapshot)
  assert.equal(current.summary_revision, stale.summary_revision + 1)
  assert.equal(current.summary.ssh_sessions, 1)
  authority.consume(current.confirmation_token, snapshot)
})

test('活动摘要未完成对账时拒绝签发安装确认', () => {
  const authority = new UpdateInstallConfirmationAuthority()
  const snapshot = downloadedSnapshot()

  assert.deepEqual(authority.getSummaryState(), {
    revision: 0,
    ready: false,
  })
  assert.throws(() => authority.issue(snapshot), /update_install_not_ready/)
  authority.updateSummary({
    ssh_sessions: 1,
    file_sessions: 0,
    forwards: 0,
    transfers: 0,
    transfers_complete: false,
  })
  assert.throws(() => authority.issue(snapshot), /update_install_not_ready/)

  markSummaryReady(authority)
  assert.deepEqual(authority.getSummaryState(), {
    revision: 2,
    ready: true,
  })
  assert.doesNotThrow(() => authority.issue(snapshot))
})

test('状态变化、代际变化和过期令牌均不能启动安装', () => {
  let now = 1_000
  const authority = new UpdateInstallConfirmationAuthority({
    now: () => now,
    randomToken: () => 'confirmation-token',
    ttlMs: 50,
  })
  const snapshot = downloadedSnapshot()
  markSummaryReady(authority)

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

test('安装准备或安装器启动失败后可重新签发安装确认', () => {
  const authority = new UpdateInstallConfirmationAuthority({
    now: () => 1_000,
    randomToken: () => 'retry-token',
  })
  markSummaryReady(authority)

  for (const errorCode of [
    'UPDATE_CORE_SHUTDOWN_FAILED',
    'UPDATE_INSTALL_START_FAILED',
  ] as const) {
    const snapshot = downloadedSnapshot({
      phase: 'error',
      error_code: errorCode,
      retryable: true,
    })
    const confirmation = authority.issue(snapshot)
    authority.consume(confirmation.confirmation_token, snapshot)
  }

  assert.throws(
    () => authority.issue(downloadedSnapshot({
      phase: 'error',
      error_code: 'UPDATE_DOWNLOAD_FAILED',
      retryable: true,
    })),
    /update_install_not_ready/,
  )
  assert.throws(
    () => authority.issue(downloadedSnapshot({
      phase: 'error',
      error_code: 'UPDATE_CORE_SHUTDOWN_FAILED',
      retryable: false,
    })),
    /update_install_not_ready/,
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
    transfers_complete: false,
  })
})
