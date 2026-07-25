import assert from 'node:assert/strict'
import test from 'node:test'
import type { UpdateWindowBootstrap } from '../../electron/updateWindow.ts'
import type { UpdateSnapshot } from '../../electron/updateTypes.ts'
import { primaryActionLabel, windowCopy } from '../features/update/updateWindowCopy.ts'
import {
  calculateUpdateEta,
  canPrepareUpdateInstall,
  formatUpdateBytes,
  formatUpdateDuration,
  isInstallConfirmationCurrent,
  mergeUpdateWindowBootstrap,
  mergeUpdateWindowSnapshot,
  resolveUpdateWindowPrimaryAction,
} from '../features/update/updateWindowUiState.ts'

function snapshot(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    state_seq: 1,
    operation_generation: 1,
    phase: 'downloading',
    current_version: '1.0.0',
    available_version: '1.1.0',
    release_name: 'Termous 1.1.0',
    release_date: '2026-07-25T00:00:00Z',
    release_url: 'https://github.com/Countra/termous/releases/tag/v1.1.0',
    release_notes: '更新说明',
    progress: {
      percent: 40,
      transferred: 40,
      total: 100,
      bytes_per_second: 10,
    },
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

function bootstrap(
  bootstrapSequence: number,
  state: UpdateSnapshot,
): UpdateWindowBootstrap<UpdateSnapshot> {
  return {
    bootstrap_seq: bootstrapSequence,
    intent: 'inspect',
    language: 'zh-CN',
    snapshot: state,
    theme: 'dark',
  }
}

test('启动快照和状态事件分别按各自序号合并', () => {
  const current = bootstrap(4, snapshot({
    state_seq: 8,
    progress: {
      percent: 60,
      transferred: 60,
      total: 100,
      bytes_per_second: 8,
    },
  }))
  const incoming = bootstrap(5, snapshot({
    state_seq: 7,
    progress: {
      percent: 20,
      transferred: 20,
      total: 100,
      bytes_per_second: 6,
    },
  }))
  incoming.language = 'en-US'
  incoming.theme = 'light'

  const merged = mergeUpdateWindowBootstrap(current, incoming)
  assert.equal(merged.bootstrap_seq, 5)
  assert.equal(merged.language, 'en-US')
  assert.equal(merged.theme, 'light')
  assert.equal(merged.snapshot.state_seq, 8)
  assert.equal(merged.snapshot.progress?.percent, 60)
})

test('同 generation 下载进度不回退而新 generation 允许重新开始', () => {
  const current = snapshot({
    state_seq: 3,
    operation_generation: 7,
    progress: {
      percent: 60,
      transferred: 60,
      total: 100,
      bytes_per_second: 8,
    },
  })
  const regressed = mergeUpdateWindowSnapshot(current, snapshot({
    state_seq: 4,
    operation_generation: 7,
    progress: {
      percent: 20,
      transferred: 20,
      total: 80,
      bytes_per_second: 4,
    },
  }))
  assert.deepEqual(regressed.progress, {
    percent: 60,
    transferred: 60,
    total: 100,
    bytes_per_second: 4,
  })

  const restarted = mergeUpdateWindowSnapshot(regressed, snapshot({
    state_seq: 5,
    operation_generation: 8,
    progress: {
      percent: 5,
      transferred: 5,
      total: 100,
      bytes_per_second: 2,
    },
  }))
  assert.equal(restarted.progress?.percent, 5)
})

test('相同 state sequence 的矛盾快照不会覆盖已渲染终态', () => {
  const current = snapshot({
    state_seq: 9,
    phase: 'downloaded',
    progress: {
      percent: 100,
      transferred: 100,
      total: 100,
      bytes_per_second: 0,
    },
  })
  const duplicate = snapshot({
    state_seq: 9,
    phase: 'downloading',
    progress: {
      percent: 10,
      transferred: 10,
      total: 100,
      bytes_per_second: 10,
    },
  })

  assert.equal(mergeUpdateWindowSnapshot(current, duplicate), current)
})

test('操作按更新阶段和错误类型稳定映射', () => {
  assert.equal(resolveUpdateWindowPrimaryAction(snapshot({ phase: 'available' })), 'download')
  assert.equal(resolveUpdateWindowPrimaryAction(snapshot({ phase: 'downloading' })), 'cancel')
  assert.equal(resolveUpdateWindowPrimaryAction(snapshot({ phase: 'downloaded' })), 'install')
  assert.equal(
    resolveUpdateWindowPrimaryAction(snapshot({
      phase: 'error',
      error_code: 'UPDATE_CORE_SHUTDOWN_FAILED',
      retryable: true,
    })),
    'retry_install',
  )
  assert.equal(
    resolveUpdateWindowPrimaryAction(snapshot({
      phase: 'error',
      error_code: 'UPDATE_CORE_SHUTDOWN_FAILED',
      retryable: false,
    })),
    'open_releases',
  )
  assert.equal(
    resolveUpdateWindowPrimaryAction(snapshot({
      phase: 'error',
      error_code: 'UPDATE_DOWNLOAD_FAILED',
    })),
    'retry_download',
  )
  assert.equal(
    resolveUpdateWindowPrimaryAction(snapshot({
      phase: 'unsupported',
      available_version: null,
    })),
    'open_releases',
  )
})

test('安装确认在已下载和可重试安装错误状态保持有效', () => {
  const confirmation = {
    confirmation_token: 'token',
    expires_at: '2026-07-25T01:00:00Z',
    state_seq: 3,
    operation_generation: 7,
    summary_revision: 1,
    summary: {
      ssh_sessions: 1,
      file_sessions: 0,
      forwards: 0,
      transfers: 0,
      transfers_complete: true,
    },
  }
  const downloaded = snapshot({
    phase: 'downloaded',
    state_seq: 3,
    operation_generation: 7,
  })
  const retryableInstallError = snapshot({
    phase: 'error',
    error_code: 'UPDATE_CORE_SHUTDOWN_FAILED',
    retryable: true,
    state_seq: 3,
    operation_generation: 7,
  })
  const downloadError = snapshot({
    phase: 'error',
    error_code: 'UPDATE_DOWNLOAD_FAILED',
    state_seq: 3,
    operation_generation: 7,
  })

  assert.equal(isInstallConfirmationCurrent(confirmation, downloaded), true)
  assert.equal(isInstallConfirmationCurrent(confirmation, retryableInstallError), true)
  assert.equal(isInstallConfirmationCurrent(confirmation, downloadError), false)
  assert.equal(canPrepareUpdateInstall(retryableInstallError), true)
  assert.equal(canPrepareUpdateInstall({
    ...retryableInstallError,
    retryable: false,
  }), false)
})

test('安装动作会根据活动任务明确提示关闭连接', () => {
  const text = windowCopy('zh-CN')
  const confirmation = {
    confirmation_token: 'token',
    expires_at: '2026-07-25T01:00:00Z',
    state_seq: 3,
    operation_generation: 7,
    summary_revision: 1,
    summary: {
      ssh_sessions: 1,
      file_sessions: 0,
      forwards: 0,
      transfers: 0,
      transfers_complete: true,
    },
  }

  assert.equal(primaryActionLabel('install', text, confirmation), '关闭连接并安装')
  assert.equal(primaryActionLabel('retry_install', text, confirmation), '关闭连接并重试')
  assert.equal(primaryActionLabel('install', text, {
    ...confirmation,
    summary: {
      ...confirmation.summary,
      ssh_sessions: 0,
    },
  }), '安装并重新启动')
})

test('字节、速度 ETA 和长时长使用可读单位', () => {
  assert.equal(formatUpdateBytes(1_572_864, 'zh-CN'), '1.5 MB')
  assert.equal(formatUpdateDuration(3_661, 'zh-CN'), '1 小时 1 分')
  assert.equal(formatUpdateDuration(65, 'en-US'), '1m 5s')
  assert.equal(calculateUpdateEta({
    percent: 50,
    transferred: 500,
    total: 1_000,
    bytes_per_second: 100,
  }), 5)
  assert.equal(calculateUpdateEta({
    percent: 100,
    transferred: 1_000,
    total: 1_000,
    bytes_per_second: 100,
  }), null)
})
