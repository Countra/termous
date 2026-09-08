import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent } from '@earendil-works/pi-ai'
import { createRuntimeRetryStreamFunction, type RuntimeRetryActivity } from './runtimeProviderRetry.ts'
import { compactionTestAssistant, compactionTestModel } from './runtimeCompactionTestFixture.ts'

test('失败边界等待最后增量消费，退避取消不重复提交已归档正文和用量', async () => {
  const abort = new AbortController()
  const consumed = deferred()
  const fixture = partialFixture()
  const activities: RuntimeRetryActivity[] = []
  let archived = 0
  const wrapped = createRuntimeRetryStreamFunction(fixture.source, {
    onFailedAttempt: () => { archived += 1 },
    onActivity: (activity) => { activities.push(activity) },
  })
  const stream = await wrapped(compactionTestModel, { messages: [] }, { signal: abort.signal })
  const task = (async () => {
    for await (const event of stream) if (event.type === 'text_delta') await consumed.promise
  })()
  await setImmediate()
  assert.equal(archived, 0)
  assert.equal(activities.length, 0)
  consumed.resolve()
  await setImmediate()
  assert.equal(archived, 1)
  assert.equal(activities[0]?.status, 'waiting')
  abort.abort()
  await task
  const result = await stream.result()
  assert.equal(result.stopReason, 'aborted')
  assert.deepEqual(result.content, [])
  assert.equal(result.usage.totalTokens, 9)
  assert.equal(fixture.requests(), 1)
  assert.deepEqual(activities.map((event) => event.status), ['waiting', 'cancelled'])
})

test('消费屏障期间取消仍记录此前真实失败，未归档正文和用量交给取消终态保存', async () => {
  const abort = new AbortController()
  const consumed = deferred()
  const fixture = partialFixture()
  const activities: RuntimeRetryActivity[] = []
  let archived = 0
  const wrapped = createRuntimeRetryStreamFunction(fixture.source, {
    onFailedAttempt: () => { archived += 1 },
    onActivity: (activity) => { activities.push(activity) },
  })
  const stream = await wrapped(compactionTestModel, { messages: [] }, { signal: abort.signal })
  const task = (async () => {
    for await (const event of stream) if (event.type === 'text_delta') await consumed.promise
  })()
  await setImmediate()
  abort.abort()
  const result = await stream.result()
  assert.equal(result.stopReason, 'aborted')
  assert.equal(result.content[0]?.type === 'text' && result.content[0].text, '部分回答')
  assert.equal(result.usage.totalTokens, 9)
  assert.equal(archived, 0)
  assert.equal(result.errorMessage, undefined)
  assert.deepEqual(activities.map(({ status, attempt, error_message }) => [status, attempt, error_message]), [
    ['waiting', 0, 'terminated'], ['cancelled', 0, 'terminated'],
  ])
  consumed.resolve()
  await task
  assert.equal(fixture.requests(), 1)
})

test('消费者提前 return 会释放失败屏障并拒绝 result，不悬挂或启动下一请求', async () => {
  const fixture = partialFixture()
  let archived = 0
  const wrapped = createRuntimeRetryStreamFunction(fixture.source, {
    onFailedAttempt: () => { archived += 1 },
  })
  const stream = await wrapped(compactionTestModel, { messages: [] })
  const iterator = stream[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value?.type, 'start')
  assert.equal((await iterator.next()).value?.type, 'text_delta')
  const rejected = assert.rejects(stream.result(), /AGENT_MODEL_STREAM_CONSUMER_CLOSED/u)
  await iterator.return?.()
  await rejected
  assert.equal(archived, 0)
  assert.equal(fixture.requests(), 1)
})

test('失败片段持久化异常属于运行时故障，不能纳入模型重试', async () => {
  const fixture = partialFixture()
  const original = new Error('fixture Core history rejected')
  const wrapped = createRuntimeRetryStreamFunction(fixture.source, {
    onFailedAttempt: () => { throw original },
  })
  const stream = await wrapped(compactionTestModel, { messages: [] })
  const result = assert.rejects(stream.result(), (error) => error === original)
  await assert.rejects(async () => { for await (const event of stream) assert.notEqual(event.type, 'done') },
    (error) => error === original)
  await result
  assert.equal(fixture.requests(), 1)
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function partialFixture() {
  let requests = 0
  const message: AssistantMessage = { ...compactionTestAssistant('部分回答', 9), stopReason: 'error', errorMessage: 'terminated' }
  return {
    requests: () => requests,
    source: () => {
      assert.equal(++requests, 1)
      const stream = createAssistantMessageEventStream()
      const events: AssistantMessageEvent[] = [
        { type: 'start', partial: { ...message, content: [] } },
        { type: 'text_delta', contentIndex: 0, delta: '部分回答', partial: message },
      ]
      for (const event of events) stream.push(event)
      stream.end(message)
      return stream
    },
  }
}
