import assert from 'node:assert/strict'
import test from 'node:test'
import type { TransferTask } from '#entities/file'
import {
  buildTransferQueueItems,
  limitPendingFileOperations,
  resolveRemoteCopyHostRoute,
  summarizeTransferQueue,
  type PendingFileOperation,
} from './transferQueueState.ts'

function transfer(overrides: Partial<TransferTask> = {}): TransferTask {
  return {
    id: 'transfer-1',
    host_id: 'host-1',
    file_session_id: 'files-1',
    type: 'upload_file',
    status: 'running',
    source_paths: ['local.txt'],
    target_path: '/tmp/local.txt',
    total_bytes: 100,
    transferred_bytes: 20,
    remaining_bytes: 80,
    total_files: 1,
    completed_files: 0,
    progress_percent: 20,
    speed_bytes_per_sec: 10,
    average_speed_bytes_per_sec: 8,
    elapsed_seconds: 2,
    cancellable: true,
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-07-23T00:00:00Z',
    ...overrides,
  }
}

function pending(
  overrides: Partial<PendingFileOperation> = {},
): PendingFileOperation {
  return {
    id: 'pending-1',
    hostId: 'host-1',
    fileSessionId: 'files-1',
    title: '准备上传',
    progress: 0,
    status: 'running',
    indeterminate: true,
    ...overrides,
  }
}

test('传输统计使用互斥状态且取消任务只计入全部', () => {
  const summary = summarizeTransferQueue(
    [
      transfer({ id: 'running', status: 'running' }),
      transfer({ id: 'queued', status: 'queued' }),
      transfer({ id: 'completed', status: 'completed' }),
      transfer({ id: 'failed', status: 'failed' }),
      transfer({ id: 'cancelled', status: 'cancelled' }),
    ],
    [
      pending({ id: 'pending-running', status: 'running' }),
      pending({ id: 'pending-error', status: 'error' }),
    ],
  )

  assert.deepEqual(summary, {
    all: 7,
    active: 3,
    completed: 1,
    failed: 2,
    clearable: 4,
  })
})

test('筛选不会把已取消任务误归为失败', () => {
  const transfers = [
    transfer({ id: 'failed', status: 'failed' }),
    transfer({ id: 'cancelled', status: 'cancelled' }),
  ]

  const failedItems = buildTransferQueueItems(transfers, [], 'failed')
  assert.deepEqual(
    failedItems.map((item) => item.kind === 'task' ? item.task.id : item.operation.id),
    ['failed'],
  )
  assert.equal(buildTransferQueueItems(transfers, [], 'all').length, 2)
})

test('部分完成属性不会改变跨主机复制的真实终态筛选', () => {
  const transfers = [
    transfer({ id: 'partial-failed', type: 'remote_copy', status: 'failed', partial: true }),
    transfer({ id: 'partial-cancelled', type: 'remote_copy', status: 'cancelled', partial: true }),
  ]

  assert.deepEqual(
    buildTransferQueueItems(transfers, [], 'failed').map((item) => (
      item.kind === 'task' ? item.task.id : item.operation.id
    )),
    ['partial-failed'],
  )
  assert.deepEqual(
    buildTransferQueueItems(transfers, [], 'all').map((item) => (
      item.kind === 'task' ? item.task.id : item.operation.id
    )),
    ['partial-failed', 'partial-cancelled'],
  )
})

test('跨主机复制路由优先使用显式源主机并兼容旧 host_id', () => {
  assert.deepEqual(resolveRemoteCopyHostRoute(transfer({
    type: 'remote_copy',
    host_id: 'legacy-source',
    source_host_id: 'source-host',
    target_host_id: 'target-host',
  })), {
    sourceHostId: 'source-host',
    targetHostId: 'target-host',
  })
  assert.deepEqual(resolveRemoteCopyHostRoute(transfer({
    type: 'remote_copy',
    host_id: 'legacy-source',
  })), {
    sourceHostId: 'legacy-source',
    targetHostId: undefined,
  })
  assert.equal(resolveRemoteCopyHostRoute(transfer()), null)
})

test('全部视图按进行中、失败、其他终态稳定排列', () => {
  const items = buildTransferQueueItems(
    [
      transfer({ id: 'completed', status: 'completed' }),
      transfer({ id: 'running', status: 'running' }),
      transfer({ id: 'failed', status: 'failed' }),
    ],
    [
      pending({ id: 'pending-error', status: 'error' }),
      pending({ id: 'pending-running', status: 'running' }),
    ],
    'all',
  )

  assert.deepEqual(
    items.map((item) => item.kind === 'task' ? item.task.id : item.operation.id),
    ['pending-running', 'running', 'pending-error', 'failed', 'completed'],
  )
})

test('状态筛选同时覆盖准备任务和正式任务', () => {
  const activeItems = buildTransferQueueItems(
    [
      transfer({ id: 'running', status: 'running' }),
      transfer({ id: 'completed', status: 'completed' }),
    ],
    [
      pending({ id: 'pending-running', status: 'running' }),
      pending({ id: 'pending-error', status: 'error' }),
    ],
    'active',
  )

  assert.deepEqual(
    activeItems.map((item) => item.kind === 'task' ? item.task.id : item.operation.id),
    ['pending-running', 'running'],
  )
})

test('准备任务只限制终态历史且不会淘汰进行中任务', () => {
  const operations = [
    pending({ id: 'running-1', status: 'running' }),
    pending({ id: 'failed-new', status: 'error' }),
    pending({ id: 'running-2', status: 'running' }),
    pending({ id: 'failed-old', status: 'error' }),
  ]

  assert.deepEqual(
    limitPendingFileOperations(operations, 1).map((operation) => operation.id),
    ['running-1', 'failed-new', 'running-2'],
  )
  assert.deepEqual(
    limitPendingFileOperations(operations, 0).map((operation) => operation.id),
    ['running-1', 'running-2'],
  )
})
