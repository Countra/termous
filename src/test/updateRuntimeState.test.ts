import assert from 'node:assert/strict'
import test from 'node:test'
import type { UpdateSnapshot } from '#common/contracts'
import {
  mergeUpdateRuntimeSnapshot,
  resolveGlobalUpdateStatus,
  selectUpdateNotification,
  updateNotificationStorageKey,
} from '../entities/update/model/updateRuntimeState.ts'

function snapshot(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    state_seq: 1,
    operation_generation: 1,
    phase: 'available',
    current_version: '1.0.0',
    available_version: '1.1.0',
    release_name: 'Termous 1.1.0',
    release_date: '2026-07-25T00:00:00Z',
    release_notes: '更新说明',
    progress: null,
    checked_at: '2026-07-25T00:00:00Z',
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: '2026-07-25T00:00:00Z',
      revision: 1,
    },
    next_automatic_check_at: '2026-07-26T00:00:00Z',
    ...overrides,
  }
}

test('迟到状态不能回退 state_seq，但可携带更高 revision 的偏好', () => {
  const current = snapshot({
    state_seq: 8,
    phase: 'downloaded',
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: '2026-07-25T00:00:00Z',
      revision: 2,
    },
  })
  const incoming = snapshot({
    state_seq: 7,
    phase: 'available',
    preferences: {
      automatic_check: false,
      check_interval: 'weekly',
      automatic_download: true,
      last_checked_at: '2026-07-25T00:00:00Z',
      revision: 3,
    },
  })

  const merged = mergeUpdateRuntimeSnapshot(current, incoming)
  assert.equal(merged.state_seq, 8)
  assert.equal(merged.phase, 'downloaded')
  assert.equal(merged.preferences.revision, 3)
  assert.equal(merged.preferences.automatic_check, false)
})

test('较新状态不能用较低 revision 偏好覆盖当前选择', () => {
  const current = snapshot({
    state_seq: 4,
    preferences: {
      automatic_check: false,
      check_interval: 'weekly',
      automatic_download: true,
      last_checked_at: '2026-07-25T00:00:00Z',
      revision: 6,
    },
  })
  const incoming = snapshot({
    state_seq: 5,
    phase: 'checking',
    preferences: {
      automatic_check: true,
      check_interval: 'startup',
      automatic_download: false,
      last_checked_at: null,
      revision: 5,
    },
  })

  const merged = mergeUpdateRuntimeSnapshot(current, incoming)
  assert.equal(merged.state_seq, 5)
  assert.equal(merged.phase, 'checking')
  assert.equal(merged.preferences.revision, 6)
  assert.equal(merged.preferences.automatic_download, true)
})

test('更高状态序号使用主进程权威进度，新 generation 可重新开始', () => {
  const current = snapshot({
    state_seq: 3,
    operation_generation: 7,
    phase: 'downloading',
    progress: {
      percent: 60,
      transferred: 60,
      total: 100,
      bytes_per_second: 8,
    },
  })
  const regressed = mergeUpdateRuntimeSnapshot(current, snapshot({
    state_seq: 4,
    operation_generation: 7,
    phase: 'downloading',
    progress: {
      percent: 20,
      transferred: 20,
      total: 80,
      bytes_per_second: 4,
    },
  }))
  assert.deepEqual(regressed.progress, {
    percent: 20,
    transferred: 20,
    total: 80,
    bytes_per_second: 4,
  })

  const restarted = mergeUpdateRuntimeSnapshot(regressed, snapshot({
    state_seq: 5,
    operation_generation: 8,
    phase: 'downloading',
    progress: {
      percent: 5,
      transferred: 5,
      total: 100,
      bytes_per_second: 2,
    },
  }))
  assert.equal(restarted.progress?.percent, 5)
})

test('通知仅从 available 和 downloaded 派生并按版本与类型生成 key', () => {
  const available = selectUpdateNotification(snapshot({
    phase: 'available',
    available_version: '1.2.0+build.4',
  }))
  const downloaded = selectUpdateNotification(snapshot({
    phase: 'downloaded',
    available_version: '1.2.0+build.4',
  }))

  assert.deepEqual(available, {
    type: 'available',
    version: '1.2.0+build.4',
  })
  assert.deepEqual(downloaded, {
    type: 'downloaded',
    version: '1.2.0+build.4',
  })
  assert.equal(
    updateNotificationStorageKey(available!),
    'termous.update.notification:available:1.2.0%2Bbuild.4',
  )
  assert.equal(
    updateNotificationStorageKey(downloaded!),
    'termous.update.notification:downloaded:1.2.0%2Bbuild.4',
  )
  assert.equal(selectUpdateNotification(snapshot({ phase: 'downloading' })), null)
  assert.equal(selectUpdateNotification(snapshot({
    phase: 'error',
    error_code: 'UPDATE_CHECK_FAILED',
  })), null)
})

test('全局按钮只展示更新流程状态和需用户处理的错误', () => {
  assert.equal(resolveGlobalUpdateStatus(snapshot({ phase: 'idle' })), null)
  assert.equal(resolveGlobalUpdateStatus(snapshot({
    phase: 'error',
    error_code: 'UPDATE_CHECK_FAILED',
    error_message: '检查更新失败',
  })), null)
  assert.deepEqual(resolveGlobalUpdateStatus(snapshot({
    phase: 'error',
    error_code: 'UPDATE_DOWNLOAD_FAILED',
    error_message: '下载失败',
  })), {
    kind: 'error',
    progressPercent: null,
    version: '1.1.0',
  })
  assert.deepEqual(resolveGlobalUpdateStatus(snapshot({
    phase: 'downloading',
    progress: {
      percent: 47.5,
      transferred: 475,
      total: 1_000,
      bytes_per_second: 25,
    },
  })), {
    kind: 'downloading',
    progressPercent: 47.5,
    version: '1.1.0',
  })
})
