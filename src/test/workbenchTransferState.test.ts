import assert from 'node:assert/strict'
import test from 'node:test'
import type { TransferTask } from '../types/domain.ts'
import { summarizeWorkbenchTransfers } from '../features/workbench/workbenchTransferState.ts'

function task(overrides: Partial<TransferTask>): TransferTask {
  return {
    id: 'task-1',
    host_id: 'host-1',
    file_session_id: 'file-1',
    type: 'upload_file',
    status: 'running',
    source_paths: ['/tmp/a'],
    target_path: '/root',
    total_bytes: 100,
    transferred_bytes: 25,
    remaining_bytes: 75,
    total_files: 1,
    completed_files: 0,
    progress_percent: 25,
    speed_bytes_per_sec: 10,
    average_speed_bytes_per_sec: 10,
    elapsed_seconds: 1,
    cancellable: true,
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-07-18T00:00:00Z',
    ...overrides,
  }
}

test('仅聚合当前文件会话的传输任务', () => {
  const summary = summarizeWorkbenchTransfers([
    task({ id: 'a' }),
    task({ id: 'b', file_session_id: 'file-2' }),
  ], 'file-1')

  assert.equal(summary.tasks.length, 1)
  assert.equal(summary.activeCount, 1)
})

test('进度按传输字节加权且速度求和', () => {
  const summary = summarizeWorkbenchTransfers([
    task({ id: 'a', total_bytes: 100, progress_percent: 50, speed_bytes_per_sec: 12 }),
    task({ id: 'b', total_bytes: 300, progress_percent: 25, speed_bytes_per_sec: 8, eta_seconds: 9 }),
  ], 'file-1')

  assert.equal(summary.progress, 31)
  assert.equal(summary.speed, 20)
  assert.equal(summary.eta, 9)
})
