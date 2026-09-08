import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test, { type TestContext } from 'node:test'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent } from '@earendil-works/pi-ai'
import { createRuntimeRetryStreamFunction, type RuntimeRetryActivity } from './runtimeProviderRetry.ts'
import { compactionTestAssistant, compactionTestModel } from './runtimeCompactionTestFixture.ts'
import type { RuntimeUsage } from './runtimeUsage.ts'

test('官方重试执行三次额外请求，保持一二四秒退避及原始最终用量', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const failures = [failed(10), failed(20), failed(30)]
  const completed = compactionTestAssistant('恢复完成', 40)
  const fixture = createFixture([...failures, completed])
  const task = fixture.run()
  await advance(t, fixture, [1000, 2000, 4000])
  const result = await task

  assert.equal(fixture.requests(), 4)
  assert.equal(result.message, completed)
  assert.equal(result.message.usage.totalTokens, 40)
  assert.deepEqual(fixture.usages.map((usage) => usage.total_tokens), [10, 20, 30])
  assert.deepEqual(fixture.activities.map(({ status, attempt }) => [status, attempt]), [
    ['waiting', 0], ['requesting', 1], ['waiting', 1], ['requesting', 2],
    ['waiting', 2], ['requesting', 3], ['completed', 3],
  ])
  assert.equal(new Set(fixture.activities.map(({ retry_id }) => retry_id)).size, 1)
  assert.ok(fixture.activities.every(({ max_retries }) => max_retries === 3))
  assert.deepEqual(result.events.map(({ type }) => type), ['done'])
})

test('三次额外请求耗尽仅输出最后原始失败消息和终态', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const messages = [failed(10), failed(20), failed(30), failed(40, '503 exact final failure')]
  const fixture = createFixture(messages)
  const task = fixture.run()
  await advance(t, fixture, [1000, 2000, 4000])
  const result = await task
  assert.equal(result.message, messages[3])
  assert.equal(fixture.requests(), 4)
  assert.deepEqual(result.events.map(({ type }) => type), ['error'])
  assert.equal(fixture.activities[fixture.activities.length - 1]?.status, 'failed')
  assert.equal(fixture.activities[fixture.activities.length - 1]?.error_message, '503 exact final failure')
})

for (const detail of [
  '401 Incorrect API key', 'insufficient_quota', 'context_length_exceeded',
  '401 authentication failed: upstream server error; try your request again',
  '403 permission denied: service unavailable; please retry your request',
  '403 Forbidden: permission denied by rate limit policy; please retry your request',
  'maximum context length is 50000 tokens', 'unsupported schema',
]) {
  test(`确定性错误直接失败：${detail}`, async () => {
    const message = failed(10, detail)
    const fixture = createFixture([message])
    const result = await fixture.run()
    assert.equal(result.message, message)
    assert.equal(fixture.requests(), 1)
    assert.equal(fixture.activities.length, 0)
    assert.equal(fixture.usages.length, 0)
  })
}

for (const content of [
  [{ type: 'text', text: ' ' }],
  [{ type: 'thinking', thinking: '分析中' }],
  [{ type: 'toolCall', id: '', name: '', arguments: {} }],
] satisfies AssistantMessage['content'][]) {
  test(`失败消息已有 ${content[0]!.type} 内容时保留原文且不重试`, async () => {
    const message = { ...failed(10), content }
    const fixture = createFixture([message])
    const result = await fixture.run()
    assert.equal(result.message, message)
    assert.equal(fixture.requests(), 1)
    assert.equal(fixture.activities.length, 0)
  })
}

test('空 start、空文本和空思考片段允许重试且不会泄漏到下一次流', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const message = { ...failed(10), content: [
    { type: 'text' as const, text: '' }, { type: 'thinking' as const, thinking: '' },
  ] }
  const initial = { ...message, content: [] }
  const fixture = createFixture([message, compactionTestAssistant('有效结果', 20)], {
    events: (index) => index === 0 ? [
      { type: 'start', partial: initial },
      { type: 'text_start', contentIndex: 0, partial: message },
      { type: 'text_delta', contentIndex: 0, delta: '', partial: message },
      { type: 'thinking_start', contentIndex: 1, partial: message },
    ] : [],
  })
  const task = fixture.run()
  await advance(t, fixture, [1000])
  assert.deepEqual((await task).events.map(({ type }) => type), ['done'])
  assert.equal(fixture.requests(), 2)
})

test('重连请求已输出再失败时通过控制信号收口，既不丢增量也不启动第三次请求', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const partial = { ...failed(20, '503 partial output failure'), content: [{ type: 'text' as const, text: '部分结果' }] }
  const fixture = createFixture([failed(10), partial], {
    events: (index) => index === 1 ? [
      { type: 'start', partial: { ...partial, content: [] } },
      { type: 'text_delta', contentIndex: 0, delta: '部分结果', partial },
    ] : [],
  })
  const task = fixture.run()
  await advance(t, fixture, [1000])
  const result = await task
  assert.equal(fixture.requests(), 2)
  assert.equal(result.message, partial)
  assert.deepEqual(result.events.map(({ type }) => type), ['start', 'text_delta', 'error'])
  assert.deepEqual(fixture.activities.map(({ status }) => status), ['waiting', 'requesting', 'failed'])
  assert.deepEqual(fixture.usages.map(({ total_tokens }) => total_tokens), [10])
})

test('增量已有内容但错误终态内容为空时仍不得重试', async () => {
  const message = failed(10)
  const fixture = createFixture([message], {
    events: () => [
      { type: 'start', partial: message },
      { type: 'thinking_delta', contentIndex: 0, delta: '已思考', partial: message },
    ],
  })
  assert.equal((await fixture.run()).message, message)
  assert.equal(fixture.requests(), 1)
})

test('第一次退避取消保留最后失败用量且额外请求次数为零', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const abort = new AbortController()
  const fixture = createFixture([failed(17)], { signal: abort.signal })
  const task = fixture.run()
  await setImmediate()
  abort.abort()
  const result = await task
  assert.equal(result.message.stopReason, 'aborted')
  assert.equal(result.message.errorMessage, undefined)
  assert.equal(result.message.usage.totalTokens, 17)
  assert.equal(fixture.usages.length, 0)
  assert.equal(fixture.requests(), 1)
  assert.deepEqual(fixture.activities.map(({ status, attempt }) => [status, attempt]), [['waiting', 0], ['cancelled', 0]])
})

test('后续退避取消不会重复统计此前及当前失败用量', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const abort = new AbortController()
  const fixture = createFixture([failed(11), failed(23)], { signal: abort.signal })
  const task = fixture.run()
  await advance(t, fixture, [1000])
  abort.abort()
  const result = await task
  assert.equal(result.message.stopReason, 'aborted')
  assert.equal(result.message.usage.totalTokens, 23)
  assert.deepEqual(fixture.usages.map(({ total_tokens }) => total_tokens), [11])
  assert.equal(fixture.activities[fixture.activities.length - 1]?.attempt, 1)
})

test('重试记账期间取消也不会发起下一请求或重复记账', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const abort = new AbortController()
  const fixture = createFixture([failed(11)], { signal: abort.signal, onDiscardedUsage: () => abort.abort() })
  const task = fixture.run()
  await advance(t, fixture, [1000])
  const result = await task
  assert.equal(result.message.stopReason, 'aborted')
  assert.equal(result.message.usage.totalTokens, 0)
  assert.deepEqual(fixture.usages.map(({ total_tokens }) => total_tokens), [11])
  assert.equal(fixture.requests(), 1)
  assert.equal(fixture.activities[fixture.activities.length - 1]?.attempt, 0)
})

test('重连事件仅保留脱敏原始错误，不改写用于官方分类的失败消息', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const source = '503 exact upstream error api_key=secret-value\u0000'
  const message = failed(10, source)
  const fixture = createFixture([message, compactionTestAssistant('完成', 20)])
  const task = fixture.run()
  await advance(t, fixture, [1000])
  await task
  assert.equal(message.errorMessage, source)
  assert.equal(fixture.activities[0]!.error_message, '503 exact upstream error api_key=[已隐藏] ')
})

test('requesting 回调取消时额外请求已启动，次数与最后 Provider 原因保持准确', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const abort = new AbortController()
  const fixture = createFixture([failed(11), {
    ...compactionTestAssistant('', 0), stopReason: 'aborted', errorMessage: 'Request was aborted',
  }], {
    signal: abort.signal,
    onActivity: (activity) => {
      if (activity.status === 'requesting') {
        assert.equal(fixture.requests(), 2)
        abort.abort()
      }
    },
  })
  const task = fixture.run()
  await advance(t, fixture, [1000])
  assert.equal((await task).message.stopReason, 'aborted')
  assert.equal(fixture.requests(), 2)
  assert.equal(fixture.activities[fixture.activities.length - 1]?.attempt, 1)
  assert.equal(fixture.activities[fixture.activities.length - 1]?.error_message, '503 Service unavailable')
})

test('requesting 写入失败不再重试，已启动次数保持准确', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = new Error('fixture Core retry state rejected')
  const fixture = createFixture([failed(11), failed(23)], {
    onActivity: (activity) => {
      if (activity.status === 'requesting') throw original
    },
  })
  const task = fixture.run()
  const rejected = assert.rejects(task, (error) => error === original)
  await advance(t, fixture, [1000])
  await rejected
  assert.equal(fixture.requests(), 2)
  assert.equal(fixture.activities[fixture.activities.length - 1]?.attempt, 1)
})

test('重试适配器故障经拒绝通道传递，活动仍保留最后 Provider 原文', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const activities: RuntimeRetryActivity[] = []
  const original = new Error('fixture runtime callback failure')
  let requests = 0
  const wrapped = createRuntimeRetryStreamFunction(() => {
    if (requests++ > 0) throw original
    const stream = createAssistantMessageEventStream()
    stream.end(failed(11, '503 last provider error'))
    return stream
  }, { onActivity: (activity) => { activities.push(activity) } })
  const stream = await wrapped(compactionTestModel, { messages: [] })
  const rejected = assert.rejects(stream.result(), (error) => error === original)
  await setImmediate()
  t.mock.timers.tick(1000)
  await rejected
  assert.deepEqual(activities.map(({ status, attempt }) => [status, attempt]), [
    ['waiting', 0], ['requesting', 1], ['failed', 1],
  ])
  assert.equal(activities[activities.length - 1]?.error_message, '503 last provider error')
})

test('适配器或活动回调抛错会拒绝迭代与 result，且不伪造模型失败或悬挂', async () => {
  const original = new Error('fixture adapter rejected')
  const wrapped = createRuntimeRetryStreamFunction(() => { throw original })
  const stream = await wrapped(compactionTestModel, { messages: [] })
  await assert.rejects(stream.result(), (error) => error === original)
  await assert.rejects(async () => { for await (const event of stream) assert.fail(`不应产生 ${event.type} 事件`) }, (error) => error === original)

  const fixture = createFixture([failed(1)], { onActivity: () => { throw original } })
  await assert.rejects(fixture.run(), (error) => error === original)
  assert.equal(fixture.requests(), 1)
})

function failed(tokens: number, errorMessage = '503 Service unavailable'): AssistantMessage {
  return { ...compactionTestAssistant('', tokens), content: [], stopReason: 'error', errorMessage }
}

function createFixture(messages: AssistantMessage[], options: {
  signal?: AbortSignal
  events?(index: number): AssistantMessageEvent[]
  onActivity?(activity: RuntimeRetryActivity): void
  onDiscardedUsage?(): void
} = {}) {
  const activities: RuntimeRetryActivity[] = []
  const usages: RuntimeUsage[] = []
  let requests = 0
  const source: StreamFn = (_model, _context, request) => {
    assert.equal(request?.signal, options.signal)
    const index = requests++
    const message = messages[index]
    assert.ok(message, '不应超过 fixture 请求次数')
    const stream = createAssistantMessageEventStream()
    for (const event of options.events?.(index) ?? []) stream.push(event)
    stream.end(message)
    return stream
  }
  const wrapped = createRuntimeRetryStreamFunction(source, {
    onActivity: (activity) => { activities.push(activity); options.onActivity?.(activity) },
    onDiscardedUsage: (usage) => { usages.push(usage); options.onDiscardedUsage?.() },
  })
  return {
    activities, usages, requests: () => requests,
    run: async () => {
      const stream = await wrapped(compactionTestModel, { messages: [] }, { signal: options.signal })
      const events: AssistantMessageEvent[] = []
      for await (const event of stream) events.push(event)
      return { events, message: await stream.result() }
    },
  }
}

async function advance(t: TestContext, fixture: ReturnType<typeof createFixture>, delays: number[]) {
  for (let index = 0; index < delays.length; index += 1) {
    await setImmediate()
    assert.equal(fixture.activities.filter(({ status }) => status === 'waiting')[index]?.delay_ms, delays[index])
    t.mock.timers.tick(delays[index]!)
  }
  await setImmediate()
}
