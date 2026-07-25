import assert from 'node:assert/strict'
import test from 'node:test'
import type { UpdateRuntimeSummary } from '../../electron/updateRuntime.ts'
import {
  UpdateRuntimeSummaryPublisher,
  runtimeSummarySignature,
  updateRuntimeSummaryRetryDelay,
  type UpdateRuntimeSummaryScheduler,
} from '../features/update/updateRuntimeSummaryPublisher.ts'

function summary(
  patch: Partial<UpdateRuntimeSummary> = {},
): UpdateRuntimeSummary {
  return {
    ssh_sessions: 0,
    file_sessions: 0,
    forwards: 0,
    transfers: 0,
    transfers_complete: true,
    ...patch,
  }
}

test('摘要仅在发送成功后确认，失败后按有界退避重试', async () => {
  const scheduler = new ManualScheduler()
  const sent: UpdateRuntimeSummary[] = []
  let fail = true
  const publisher = new UpdateRuntimeSummaryPublisher(async (value) => {
    sent.push(value)
    if (fail) {
      throw new Error('temporary_failure')
    }
  }, scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  await flushPromises()
  assert.equal(sent.length, 1)
  assert.equal(scheduler.size, 1)

  fail = false
  scheduler.runNext()
  await flushPromises()
  assert.equal(sent.length, 2)
  assert.equal(scheduler.size, 0)

  publisher.publish(summary({ ssh_sessions: 1 }))
  await flushPromises()
  assert.equal(sent.length, 2)
  publisher.dispose()
})

test('在途发送期间的新摘要最终覆盖旧摘要', async () => {
  const scheduler = new ManualScheduler()
  const resolvers: Array<() => void> = []
  const sent: UpdateRuntimeSummary[] = []
  const publisher = new UpdateRuntimeSummaryPublisher((value) => {
    sent.push(value)
    return new Promise<void>((resolve) => resolvers.push(resolve))
  }, scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  publisher.publish(summary({ ssh_sessions: 2 }))
  assert.equal(sent.length, 1)
  resolvers.shift()?.()
  await flushPromises()
  assert.equal(sent.length, 2)
  assert.equal(sent[1]?.ssh_sessions, 2)
  resolvers.shift()?.()
  await flushPromises()
  publisher.dispose()
})

test('摘要签名包含完整性状态且重试时限存在上限', () => {
  assert.notEqual(
    runtimeSummarySignature(summary({ transfers_complete: true })),
    runtimeSummarySignature(summary({ transfers_complete: false })),
  )
  assert.deepEqual(
    [1, 2, 3, 4, 8].map(updateRuntimeSummaryRetryDelay),
    [1_000, 3_000, 9_000, 27_000, 30_000],
  )
})

class ManualScheduler implements UpdateRuntimeSummaryScheduler {
  private callbacks: Array<() => void> = []

  get size() {
    return this.callbacks.length
  }

  schedule(callback: () => void) {
    this.callbacks.push(callback)
    return callback
  }

  cancel(handle: unknown) {
    this.callbacks = this.callbacks.filter((callback) => callback !== handle)
  }

  runNext() {
    this.callbacks.shift()?.()
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
