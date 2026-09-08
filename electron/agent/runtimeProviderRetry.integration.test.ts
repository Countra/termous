import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { Agent } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import { createRestrictedProviderFetch, createRuntimeStreamFunction } from './piAgentAdapter.ts'
import { PiEventBridge } from './piEventBridge.ts'
import { compactionTestAssistant, compactionTestModel, compactionTestUser } from './runtimeCompactionTestFixture.ts'
import { createRuntimeRetryStreamFunction, type RuntimeRetryActivity } from './runtimeProviderRetry.ts'
import { runtimeProviderUsage } from './runtimeProviderUsage.ts'
import type { RuntimeEventKind } from './workerCoreClient.ts'

for (const api of ['openai-responses', 'openai-completions'] as const) {
  test(`真实 ${api} 解析内存响应，503 后重试仅完成一个 Assistant 并保留上下文基准`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const model = { ...compactionTestModel, api }
    const events: Array<{ kind: RuntimeEventKind; payload: Record<string, unknown> }> = []
    const activities: RuntimeRetryActivity[] = []
    const bridge = new PiEventBridge({
      writer: { push: (kind, payload) => { events.push({ kind, payload }) } },
      assistantMessageID: 'agm_retry_fixture', originalToolName: () => null,
      newPartID: () => 'agp_retry_fixture',
    })
    let requests = 0
    const requestBodies: unknown[] = []
    const providerFetch = createRestrictedProviderFetch(model.baseUrl, true, async (_input, init) => {
      requests += 1
      requestBodies.push(JSON.parse(String(init?.body)))
      if (requests === 1) return new Response(JSON.stringify({ error: { message: 'fixture temporary upstream failure' } }), {
        status: 503, headers: { 'content-type': 'application/json' },
      })
      // 真实 SDK 负责解析；所有 HTTP 响应都由内存 fixture 返回，禁止访问真实 Provider。
      return new Response(successSSE(api), { headers: { 'content-type': 'text/event-stream' } })
    })
    const agent = new Agent({
      initialState: { model, messages: [compactionTestUser('重试当前请求')], tools: [] },
      streamFn: createRuntimeRetryStreamFunction(createRuntimeStreamFunction(undefined, providerFetch), {
        onActivity: (activity) => { activities.push(activity) },
        onDiscardedUsage: (usage) => bridge.addUsage(usage),
      }),
    })
    const unsubscribe = agent.subscribe((event) => bridge.handle(event))
    try {
      const task = agent.continue()
      await setImmediate()
      assert.equal(activities[0]?.status, 'waiting')
      t.mock.timers.tick(1000)
      await task
      await agent.waitForIdle()
      assert.equal(requests, 2)
      assert.deepEqual(requestBodies[0], requestBodies[1])
      assert.equal(bridge.outcome(), 'completed')
      const assistants = agent.state.messages.filter((message) => message.role === 'assistant') as AssistantMessage[]
      assert.equal(assistants.length, 1)
      assert.equal(assistants[0]!.usage.totalTokens, 25)
      assert.equal(events.filter(({ kind }) => kind === 'message_part').length, 1)
      assert.equal(events.filter(({ kind }) => kind === 'message_delta').length, 1)
      assert.equal(events.filter(({ kind }) => kind === 'error').length, 0)
      const usageEvents = events.filter(({ kind }) => kind === 'usage')
      assert.equal((usageEvents[usageEvents.length - 1]!.payload.usage as { total_tokens: number }).total_tokens, 25)
      assert.equal(runtimeProviderUsage(assistants[0]!, bridge.lastAssistantPartID(), 'a'.repeat(64))?.total_tokens, 25)
      assert.deepEqual(activities.map(({ status, attempt }) => [status, attempt]), [
        ['waiting', 0], ['requesting', 1], ['completed', 1],
      ])
    } finally {
      unsubscribe()
      agent.clearAllQueues()
    }
  })
}

test('没有 start 和正文的最终失败由 Pi 补齐唯一 Assistant 终态', async () => {
  const events: Array<{ kind: RuntimeEventKind; payload: Record<string, unknown> }> = []
  const bridge = new PiEventBridge({
    writer: { push: (kind, payload) => { events.push({ kind, payload }) } },
    assistantMessageID: 'agm_empty_retry', originalToolName: () => null,
  })
  const message: AssistantMessage = {
    ...compactionTestAssistant('', 7), content: [], stopReason: 'error', errorMessage: '401 exact authentication failure',
  }
  const agent = new Agent({
    initialState: { model: compactionTestModel, messages: [compactionTestUser('继续')] },
    streamFn: createRuntimeRetryStreamFunction(() => {
      const stream = createAssistantMessageEventStream()
      stream.end(message)
      return stream
    }),
  })
  const unsubscribe = agent.subscribe((event) => bridge.handle(event))
  try {
    await agent.continue()
    assert.equal(bridge.outcome(), 'failed')
    const assistants = agent.state.messages.filter((value) => value.role === 'assistant')
    assert.equal(assistants.length, 1)
    assert.equal(assistants[0], message)
    assert.deepEqual(events.map(({ kind }) => kind), ['usage', 'error'])
    assert.equal((events[1]!.payload.error as { message: string }).message, message.errorMessage)
  } finally {
    unsubscribe()
  }
})

function successSSE(api: 'openai-responses' | 'openai-completions') {
  if (api === 'openai-completions') {
    const chunk = {
      id: 'chatcmpl_retry', object: 'chat.completion.chunk', created: 1, model: compactionTestModel.id,
      choices: [{ index: 0, delta: { role: 'assistant', content: '恢复完成' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    }
    return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`
  }
  const events = [
    { type: 'response.created', response: { id: 'resp_retry', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0,
      item: { type: 'message', id: 'msg_retry', role: 'assistant', status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '恢复完成' },
    { type: 'response.completed', response: { id: 'resp_retry', status: 'completed',
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 }, output: [] } },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}
