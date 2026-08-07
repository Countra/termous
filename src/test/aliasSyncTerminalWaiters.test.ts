import assert from 'node:assert/strict'
import test from 'node:test'
import type { AliasSyncTask } from '../entities/alias/index.ts'
import {
  rejectAliasSyncTerminalWaiters,
  rejectAllAliasSyncTerminalWaiters,
  resolveAliasSyncTerminalWaiters,
  waitForAliasSyncTerminal,
  type AliasSyncTerminalWaiterMap,
} from '../features/alias/model/aliasSyncTerminalWaiters.ts'

test('Alias 同步终态会完成 waiter 并清理定时器与任务集合', async () => {
  const waiters: AliasSyncTerminalWaiterMap = new Map()
  const timeoutError = new Error('不应超时')
  const promise = waitForAliasSyncTerminal(waiters, 'task-1', timeoutError, 1_000)
  const task = createTask('task-1')

  resolveAliasSyncTerminalWaiters(waiters, task)

  assert.equal(await promise, task)
  assert.equal(waiters.size, 0)
})

test('Alias 同步终态等待超时后拒绝并移除自身 waiter', async () => {
  const waiters: AliasSyncTerminalWaiterMap = new Map()
  const timeoutError = Object.assign(new Error('等待超时'), {
    code: 'REQUEST_TIMEOUT',
    status: 0,
  })

  await assert.rejects(
    waitForAliasSyncTerminal(waiters, 'task-timeout', timeoutError, 1),
    (error) => error === timeoutError,
  )
  assert.equal(waiters.size, 0)
})

test('Alias 同步任务失联只拒绝对应 waiter 并保留其他任务', async () => {
  const waiters: AliasSyncTerminalWaiterMap = new Map()
  const notFound = new Error('任务不存在')
  const lostPromise = waitForAliasSyncTerminal(waiters, 'task-lost', new Error('不应超时'), 1_000)
  const retainedPromise = waitForAliasSyncTerminal(waiters, 'task-retained', new Error('不应超时'), 1_000)

  rejectAliasSyncTerminalWaiters(waiters, 'task-lost', notFound)

  await assert.rejects(lostPromise, (error) => error === notFound)
  assert.equal(waiters.has('task-lost'), false)
  assert.equal(waiters.has('task-retained'), true)

  const retainedTask = createTask('task-retained')
  resolveAliasSyncTerminalWaiters(waiters, retainedTask)
  assert.equal(await retainedPromise, retainedTask)
  assert.equal(waiters.size, 0)
})

test('Alias 同步监听卸载会拒绝并清理所有 waiter', async () => {
  const waiters: AliasSyncTerminalWaiterMap = new Map()
  const stopped = new Error('监听已结束')
  const first = waitForAliasSyncTerminal(waiters, 'task-1', new Error('不应超时'), 1_000)
  const second = waitForAliasSyncTerminal(waiters, 'task-2', new Error('不应超时'), 1_000)

  rejectAllAliasSyncTerminalWaiters(waiters, stopped)

  const results = await Promise.allSettled([first, second])
  assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected'])
  assert.deepEqual(results.map((result) => result.status === 'rejected' ? result.reason : null), [stopped, stopped])
  assert.equal(waiters.size, 0)
})

function createTask(id: string): AliasSyncTask {
  return {
    id,
    revision: 2,
    status: 'cancelled',
    source: { session_id: 'session-1' },
    alias_ids: ['alias-1'],
    target_host_ids: ['host-1'],
    targets: [],
    total_targets: 1,
    completed_targets: 1,
    succeeded_targets: 0,
    skipped_targets: 0,
    failed_targets: 0,
    cancelled_targets: 1,
    uncertain_targets: 0,
    progress_percent: 0,
    cancellable: false,
    created_at: '2026-08-05T00:00:00Z',
    finished_at: '2026-08-05T00:00:01Z',
  }
}
