import assert from 'node:assert/strict'
import test from 'node:test'
import type { TransferTask } from '#entities/file'
import {
  consumeCompletedTransferPath,
  hasPendingTransferForDirectory,
  refreshCompletedTransferPath,
  shouldRetainTransferAfterCancel,
  summarizeWorkbenchTransfers,
  trackCompletedTransferPath,
} from '../features/workbench-files/model/workbenchTransferState.ts'

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

test('跨主机复制在源端和目标端工作台都可见', () => {
  const remoteCopy = task({
    id: 'remote-copy',
    type: 'remote_copy',
    file_session_id: 'legacy-source',
    source_file_session_id: 'source-session',
    target_file_session_id: 'target-session',
  })

  assert.deepEqual(
    summarizeWorkbenchTransfers([remoteCopy], 'source-session').tasks.map((item) => item.id),
    ['remote-copy'],
  )
  assert.deepEqual(
    summarizeWorkbenchTransfers([remoteCopy], 'target-session').tasks.map((item) => item.id),
    ['remote-copy'],
  )
  assert.deepEqual(
    summarizeWorkbenchTransfers([remoteCopy], 'legacy-source').tasks.map((item) => item.id),
    ['remote-copy'],
  )
})

test('完成任务只消费当前目录并保留同一文件会话的其他待刷新目录', () => {
  const completedPaths = new Map([
    ['file-1', new Map([['/current', 1], ['/later', 1]])],
  ])

  assert.equal(consumeCompletedTransferPath(completedPaths, 'file-1', '/other'), false)
  assert.deepEqual([...completedPaths.get('file-1')?.keys() ?? []], ['/current', '/later'])

  assert.equal(consumeCompletedTransferPath(completedPaths, 'file-1', '/current'), true)
  assert.deepEqual([...completedPaths.get('file-1')?.keys() ?? []], ['/later'])

  assert.equal(consumeCompletedTransferPath(completedPaths, 'file-1', '/later'), true)
  assert.equal(completedPaths.has('file-1'), false)
})

test('目录刷新成功后才消费完成标记', async () => {
  const completedPaths = new Map<string, Map<string, number>>()
  const refreshesInFlight = new Set<string>()
  let attempts = 0
  trackCompletedTransferPath(completedPaths, 'file-1', '/current')

  assert.equal(await refreshCompletedTransferPath(
    completedPaths,
    refreshesInFlight,
    'file-1',
    '/current',
    async () => {
      attempts += 1
      return false
    },
  ), false)
  assert.equal(completedPaths.get('file-1')?.has('/current'), true)

  assert.equal(await refreshCompletedTransferPath(
    completedPaths,
    refreshesInFlight,
    'file-1',
    '/current',
    async () => {
      attempts += 1
      return true
    },
  ), true)
  assert.equal(attempts, 2)
  assert.equal(completedPaths.has('file-1'), false)
})

test('同一目录的完成刷新不会并发执行', async () => {
  const completedPaths = new Map<string, Map<string, number>>()
  const refreshesInFlight = new Set<string>()
  let finishRefresh!: (value: boolean) => void
  let attempts = 0
  const pendingRefresh = new Promise<boolean>((resolve) => {
    finishRefresh = resolve
  })
  trackCompletedTransferPath(completedPaths, 'file-1', '/current')

  const first = refreshCompletedTransferPath(
    completedPaths,
    refreshesInFlight,
    'file-1',
    '/current',
    async () => {
      attempts += 1
      return pendingRefresh
    },
  )
  const second = refreshCompletedTransferPath(
    completedPaths,
    refreshesInFlight,
    'file-1',
    '/current',
    async () => {
      attempts += 1
      return true
    },
  )

  assert.equal(await second, false)
  assert.equal(attempts, 1)
  finishRefresh(true)
  assert.equal(await first, true)
  assert.equal(completedPaths.has('file-1'), false)
})

test('刷新期间同一路径的新完成事件不会被旧刷新消费', async () => {
  const completedPaths = new Map<string, Map<string, number>>()
  const refreshesInFlight = new Set<string>()
  let finishRefresh!: (value: boolean) => void
  let attempts = 0
  const pendingRefresh = new Promise<boolean>((resolve) => {
    finishRefresh = resolve
  })
  trackCompletedTransferPath(completedPaths, 'file-1', '/current')
  const first = refreshCompletedTransferPath(
    completedPaths,
    refreshesInFlight,
    'file-1',
    '/current',
    async () => {
      attempts += 1
      return attempts === 1 ? pendingRefresh : true
    },
  )

  trackCompletedTransferPath(
    completedPaths,
    'file-1',
    '/current',
    refreshesInFlight,
  )
  finishRefresh(true)
  assert.equal(await first, true)
  assert.equal(attempts, 2)
  assert.equal(completedPaths.has('file-1'), false)
})

test('完成目录队列有界且不会淘汰正在刷新的目录', async () => {
  const completedPaths = new Map<string, Map<string, number>>()
  const refreshesInFlight = new Set<string>()
  let finishRefresh!: (value: boolean) => void
  const pendingRefresh = new Promise<boolean>((resolve) => {
    finishRefresh = resolve
  })
  trackCompletedTransferPath(completedPaths, 'file-1', '/current')
  const refresh = refreshCompletedTransferPath(
    completedPaths,
    refreshesInFlight,
    'file-1',
    '/current',
    async () => pendingRefresh,
  )

  trackCompletedTransferPath(
    completedPaths,
    'file-1',
    '/current',
    refreshesInFlight,
  )

  for (let index = 0; index < 220; index += 1) {
    trackCompletedTransferPath(
      completedPaths,
      'file-1',
      `/pending-${index}`,
      refreshesInFlight,
    )
  }

  const trackedCount = [...completedPaths.values()]
    .reduce((count, paths) => count + paths.size, 0)
  assert.equal(trackedCount, 200)
  assert.equal(completedPaths.get('file-1')?.has('/current'), true)

  finishRefresh(false)
  assert.equal(await refresh, false)
  assert.equal(completedPaths.get('file-1')?.has('/current'), true)
})

test('其他目标目录的进行中任务不会阻塞当前目录刷新', () => {
  const pending = [
    { fileSessionId: 'file-1', targetPath: '/other' },
    { fileSessionId: 'file-2', targetPath: '/current' },
  ]

  assert.equal(hasPendingTransferForDirectory(pending, 'file-1', '/current'), false)
  assert.equal(hasPendingTransferForDirectory([
    ...pending,
    { fileSessionId: 'file-1', targetPath: '/current' },
  ], 'file-1', '/current'), true)
})

test('跨主机扫描阶段使用不确定进度', () => {
  const summary = summarizeWorkbenchTransfers([
    task({
      type: 'remote_copy',
      phase: 'scanning',
      total_bytes: 0,
      transferred_bytes: 0,
      progress_percent: 0,
    }),
  ], 'file-1')

  assert.equal(summary.indeterminate, true)
})

test('取消跨主机复制时保留任务等待最终 partial 状态', () => {
  assert.equal(shouldRetainTransferAfterCancel(task({ type: 'remote_copy' })), true)
  assert.equal(shouldRetainTransferAfterCancel(task({ type: 'upload_file' })), false)
  assert.equal(shouldRetainTransferAfterCancel(task({
    type: 'remote_copy',
    status: 'cancelled',
  })), false)
})

test('进度按传输字节加权且速度求和', () => {
  const summary = summarizeWorkbenchTransfers([
    task({ id: 'a', total_bytes: 100, transferred_bytes: 50, progress_percent: 50, speed_bytes_per_sec: 12 }),
    task({ id: 'b', total_bytes: 300, transferred_bytes: 75, progress_percent: 25, speed_bytes_per_sec: 8, eta_seconds: 9 }),
  ], 'file-1')

  assert.equal(summary.progress, 31)
  assert.equal(summary.speed, 20)
  assert.equal(summary.activeTransferredBytes, 125)
  assert.equal(summary.activeTotalBytes, 400)
  assert.equal(summary.eta, 9)
})

test('传输汇总清洗越界字节并在瞬时速度为空时使用平均速度', () => {
  const summary = summarizeWorkbenchTransfers([
    task({
      total_bytes: 100,
      transferred_bytes: 140,
      progress_percent: 130,
      speed_bytes_per_sec: 0,
      average_speed_bytes_per_sec: 16,
    }),
  ], 'file-1')

  assert.equal(summary.progress, 100)
  assert.equal(summary.speed, 16)
  assert.equal(summary.activeTransferredBytes, 100)
  assert.equal(summary.activeTotalBytes, 100)
})
