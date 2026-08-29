import assert from 'node:assert/strict'
import test from 'node:test'
import type { UpdateRuntimeSummary } from '#common/contracts'
import {
  UpdateRuntimeSummaryPublisher,
  runtimeSummarySignature,
  updateRuntimeSummaryRetryDelay,
  type UpdateRuntimeSummaryScheduler,
} from '../app/update-runtime/updateRuntimeSummaryPublisher.ts'

function summary(
  patch: Partial<UpdateRuntimeSummary> = {},
): UpdateRuntimeSummary {
  return {
    agent_runs: 0,
    ssh_sessions: 0,
    remote_desktop_sessions: 0,
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

test('心跳会重发未变化的摘要且释放后停止发送', async () => {
  const scheduler = new ManualScheduler()
  const sent: UpdateRuntimeSummary[] = []
  const publisher = new UpdateRuntimeSummaryPublisher(async (value) => {
    sent.push(value)
  }, scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  await flushPromises()
  publisher.refresh()
  await flushPromises()
  assert.equal(sent.length, 2)

  publisher.dispose()
  publisher.refresh()
  await flushPromises()
  assert.equal(sent.length, 2)
})

test('主动刷新会取消旧退避并立即携带请求标识发送', async () => {
  const scheduler = new ManualScheduler()
  const sent: Array<{ requestId?: string }> = []
  let fail = true
  const publisher = new UpdateRuntimeSummaryPublisher(async (_value, requestId) => {
    sent.push({ requestId })
    if (fail) {
      throw new Error('temporary_failure')
    }
  }, scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  await flushPromises()
  assert.equal(scheduler.size, 1)

  fail = false
  publisher.refresh('request-current')
  await flushPromises()
  assert.equal(scheduler.size, 0)
  assert.deepEqual(sent, [
    { requestId: undefined },
    { requestId: 'request-current' },
  ])
  publisher.dispose()
})

test('在途发送失败后优先补发主动刷新且不进入旧退避', async () => {
  const scheduler = new ManualScheduler()
  const attempts: Array<{
    reject: (error: Error) => void
    requestId?: string
    resolve: () => void
  }> = []
  const publisher = new UpdateRuntimeSummaryPublisher((_value, requestId) => (
    new Promise<void>((resolve, reject) => {
      attempts.push({ reject, requestId, resolve })
    })
  ), scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  publisher.refresh('request-current')
  assert.equal(attempts.length, 1)
  attempts[0]?.reject(new Error('temporary_failure'))
  await flushPromises()

  assert.equal(scheduler.size, 0)
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1]?.requestId, 'request-current')
  attempts[1]?.resolve()
  await flushPromises()
  publisher.dispose()
})

test('主动刷新在途时普通心跳不会丢失请求标识', async () => {
  const scheduler = new ManualScheduler()
  const attempts: Array<{
    reject: (error: Error) => void
    requestId?: string
    resolve: () => void
  }> = []
  const publisher = new UpdateRuntimeSummaryPublisher((_value, requestId) => (
    new Promise<void>((resolve, reject) => {
      attempts.push({ reject, requestId, resolve })
    })
  ), scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  publisher.refresh('request-current')
  attempts[0]?.resolve()
  await flushPromises()
  assert.equal(attempts[1]?.requestId, 'request-current')

  publisher.refresh()
  attempts[1]?.reject(new Error('temporary_failure'))
  await flushPromises()
  assert.equal(scheduler.size, 0)
  assert.equal(attempts[2]?.requestId, 'request-current')
  attempts[2]?.resolve()
  await flushPromises()
  publisher.dispose()
})

test('主动刷新在途时摘要变化会用同一请求标识补发最新内容', async () => {
  const scheduler = new ManualScheduler()
  const attempts: Array<{
    reject: (error: Error) => void
    requestId?: string
    resolve: () => void
    sshSessions: number
  }> = []
  const publisher = new UpdateRuntimeSummaryPublisher((value, requestId) => (
    new Promise<void>((resolve, reject) => {
      attempts.push({
        reject,
        requestId,
        resolve,
        sshSessions: value.ssh_sessions,
      })
    })
  ), scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  publisher.refresh('request-current')
  attempts[0]?.resolve()
  await flushPromises()
  assert.equal(attempts[1]?.requestId, 'request-current')

  publisher.publish(summary({ ssh_sessions: 2 }))
  attempts[1]?.reject(new Error('temporary_failure'))
  await flushPromises()
  assert.equal(scheduler.size, 0)
  assert.equal(attempts[2]?.requestId, 'request-current')
  assert.equal(attempts[2]?.sshSessions, 2)
  attempts[2]?.resolve()
  await flushPromises()
  publisher.dispose()
})

test('主动刷新成功后将排队的新摘要作为普通心跳提交', async () => {
  const scheduler = new ManualScheduler()
  const attempts: Array<{
    requestId?: string
    resolve: () => void
    sshSessions: number
  }> = []
  const publisher = new UpdateRuntimeSummaryPublisher((value, requestId) => (
    new Promise<void>((resolve) => {
      attempts.push({
        requestId,
        resolve,
        sshSessions: value.ssh_sessions,
      })
    })
  ), scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  publisher.refresh('request-current')
  attempts[0]?.resolve()
  await flushPromises()
  assert.equal(attempts[1]?.requestId, 'request-current')

  publisher.publish(summary({ ssh_sessions: 2 }))
  attempts[1]?.resolve()
  await flushPromises()
  assert.equal(attempts[2]?.requestId, undefined)
  assert.equal(attempts[2]?.sshSessions, 2)
  attempts[2]?.resolve()
  await flushPromises()
  publisher.dispose()
})

test('主动刷新失败后按退避重试并保留请求标识', async () => {
  const scheduler = new ManualScheduler()
  const sentRequestIds: Array<string | undefined> = []
  let fail = false
  const publisher = new UpdateRuntimeSummaryPublisher(async (_value, requestId) => {
    sentRequestIds.push(requestId)
    if (fail) {
      throw new Error('temporary_failure')
    }
  }, scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  await flushPromises()
  fail = true
  publisher.refresh('request-current')
  await flushPromises()
  assert.equal(scheduler.size, 1)

  fail = false
  scheduler.runNext()
  await flushPromises()
  assert.deepEqual(sentRequestIds, [
    undefined,
    'request-current',
    'request-current',
  ])
  publisher.dispose()
})

test('主动刷新退避期间摘要变化会立即发送最新内容并保留请求标识', async () => {
  const scheduler = new ManualScheduler()
  const sent: Array<{
    requestId?: string
    sshSessions: number
  }> = []
  let fail = false
  const publisher = new UpdateRuntimeSummaryPublisher(async (value, requestId) => {
    sent.push({
      requestId,
      sshSessions: value.ssh_sessions,
    })
    if (fail) {
      throw new Error('temporary_failure')
    }
  }, scheduler)

  publisher.publish(summary({ ssh_sessions: 1 }))
  await flushPromises()
  fail = true
  publisher.refresh('request-current')
  await flushPromises()
  assert.equal(scheduler.size, 1)

  fail = false
  publisher.publish(summary({ ssh_sessions: 2 }))
  await flushPromises()
  assert.equal(scheduler.size, 0)
  assert.deepEqual(sent[sent.length - 1], {
    requestId: 'request-current',
    sshSessions: 2,
  })
  publisher.dispose()
})

test('摘要签名包含完整性状态且重试时限存在上限', () => {
  assert.notEqual(
    runtimeSummarySignature(summary({ agent_runs: 0 })),
    runtimeSummarySignature(summary({ agent_runs: 1 })),
  )
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
