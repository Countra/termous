import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeTransferUpdate,
  mergeTransferSnapshot,
  transferRefreshRetryDelay,
  TransferSnapshotGate,
} from '../app/useTransferRuntime.ts'
import type { TransferTask } from '../types/domain.ts'

function transfer(overrides: Partial<TransferTask> = {}): TransferTask {
  return {
    id: 'trf-1',
    host_id: 'hst-1',
    type: 'upload_file',
    status: 'running',
    source_paths: ['local.txt'],
    target_path: '/tmp/local.txt',
    total_bytes: 100,
    transferred_bytes: 0,
    remaining_bytes: 100,
    total_files: 1,
    completed_files: 0,
    progress_percent: 0,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 0,
    elapsed_seconds: 0,
    cancellable: true,
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-07-17T00:00:00Z',
    ...overrides,
  }
}

test('刷新期间的旧快照不会回退实时传输进度', () => {
  const realtime = transfer({
    transferred_bytes: 80,
    remaining_bytes: 20,
    progress_percent: 80,
  })
  const staleSnapshot = transfer({
    transferred_bytes: 40,
    remaining_bytes: 60,
    progress_percent: 40,
  })

  const [merged] = mergeTransferSnapshot([realtime], [staleSnapshot], new Set(['trf-1']))
  assert.equal(merged.transferred_bytes, 80)
  assert.equal(merged.progress_percent, 80)
})

test('刷新期间的旧快照不会把已完成任务恢复为运行中', () => {
  const completed = transfer({
    status: 'completed',
    transferred_bytes: 100,
    remaining_bytes: 0,
    progress_percent: 100,
    cancellable: false,
  })
  const staleSnapshot = transfer({
    transferred_bytes: 90,
    remaining_bytes: 10,
    progress_percent: 90,
  })

  const [merged] = mergeTransferSnapshot([completed], [staleSnapshot], new Set(['trf-1']))
  assert.equal(merged.status, 'completed')
  assert.equal(merged.progress_percent, 100)
})

test('刷新只保留请求期间发生实时更新的任务', () => {
  const current = [
    transfer({ id: 'trf-1', status: 'queued' }),
    transfer({ id: 'trf-2', transferred_bytes: 80 }),
  ]
  const snapshot = [
    transfer({ id: 'trf-1', status: 'running' }),
    transfer({ id: 'trf-2', transferred_bytes: 40 }),
  ]

  const merged = mergeTransferSnapshot(current, snapshot, new Set(['trf-2']))
  assert.equal(merged.find((task) => task.id === 'trf-1')?.status, 'running')
  assert.equal(merged.find((task) => task.id === 'trf-2')?.transferred_bytes, 80)
})

test('并发刷新只允许最后发起的请求应用快照', () => {
  const gate = new TransferSnapshotGate()
  const first = gate.begin(3)
  const second = gate.begin(3)

  assert.equal(gate.isCurrent(second), true)
  assert.equal(gate.isCurrent(first), false)
  assert.equal(second.eventEpoch, 3)
})

test('创建请求的旧排队响应不会覆盖已到达的实时进度', () => {
  const running = transfer({
    status: 'running',
    transferred_bytes: 80,
    remaining_bytes: 20,
    progress_percent: 80,
  })
  const staleQueued = transfer({
    status: 'queued',
    transferred_bytes: 0,
    remaining_bytes: 100,
    progress_percent: 0,
  })

  assert.equal(mergeTransferUpdate(running, staleQueued), running)
})

test('活动任务不会被同阶段的旧字节进度回退', () => {
  const current = transfer({
    transferred_bytes: 80,
    remaining_bytes: 20,
    progress_percent: 80,
  })
  const stale = transfer({
    transferred_bytes: 40,
    remaining_bytes: 60,
    progress_percent: 40,
  })
  const next = transfer({
    transferred_bytes: 90,
    remaining_bytes: 10,
    progress_percent: 90,
  })

  assert.equal(mergeTransferUpdate(current, stale), current)
  assert.equal(mergeTransferUpdate(current, next), next)
})

test('传输快照刷新失败使用有上限的退避时间', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 8].map(transferRefreshRetryDelay),
    [1_000, 3_000, 9_000, 27_000, 30_000],
  )
})
