import assert from 'node:assert/strict'
import test from 'node:test'
import { Agent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import { createRestrictedProviderFetch, createRuntimeStreamFunction } from './piAgentAdapter.ts'
import { PiEventBridge } from './piEventBridge.ts'
import type { RuntimeEventKind } from './workerCoreClient.ts'

const model: Model<'openai-responses'> = {
  id: 'responses-fixture',
  name: 'Responses fixture',
  api: 'openai-responses',
  provider: 'termous-openai-compatible',
  baseUrl: 'http://127.0.0.1:18191/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 101072,
  maxTokens: 4096,
}

const providerUsage = { input_tokens: 1500, output_tokens: 100, total_tokens: 1600 }

test('底层 Responses 部分输出后断流保留正文并报告流中断，不叠加 HTTP 重试', async () => {
  const result = await runResponsesFixture([])

  assert.equal(result.message.stopReason, 'error')
  assert.match(result.message.errorMessage ?? '', /before a terminal response event/u)
  assert.equal(result.outcome, 'failed')
  assert.equal(result.error?.code, 'AGENT_MODEL_STREAM_INTERRUPTED')
  assert.equal(result.message.usage.totalTokens, 0)
  assert.equal(result.requests, 1)
  assertPartialTextPreserved(result.events)
})

test('真实 Responses 部分输出后主动停止，取消诊断不作为失败原文落入历史', async () => {
  const result = await runResponsesFixture([], true)

  assert.equal(result.message.stopReason, 'aborted')
  assert.equal(result.outcome, 'cancelled')
  assert.equal(result.error, undefined)
  assert.equal(result.requests, 1)
  assertPartialTextPreserved(result.events)
  const part = objectValue(result.events.find((event) => event.kind === 'message_part')!.payload.message_part)
  assert.equal(objectValue(objectValue(part.content).response_failure).error_message, '')
})

test('真实 Responses server_error 分类为服务端失败且不泄漏 Provider 敏感详情', async () => {
  const result = await runResponsesFixture([{
    type: 'response.failed',
    response: {
      status: 'failed',
      error: { code: 'server_error', message: 'fixture upstream failure token=fixture-secret' },
      usage: providerUsage,
    },
  }])

  assert.equal(result.message.stopReason, 'error')
  assert.match(result.message.errorMessage ?? '', /server_error/u)
  assert.equal(result.outcome, 'failed')
  assert.equal(result.error?.code, 'AGENT_MODEL_PROVIDER_FAILED')
  assert.equal(result.requests, 1)
  assert.doesNotMatch(JSON.stringify(result.events), /fixture-secret/u)
  assertPartialTextPreserved(result.events)
})

test('真实 Responses content_filter 与普通请求失败区分且保留已返回用量', async () => {
  const result = await runResponsesFixture([incompleteResponse('content_filter')])

  assert.equal(result.message.stopReason, 'error')
  assert.equal(result.message.rawStopReason, 'incomplete.content_filter')
  assert.equal(result.outcome, 'failed')
  assert.equal(result.error?.code, 'AGENT_MODEL_CONTENT_FILTERED')
  assert.equal(result.message.usage.totalTokens, 1600)
  const usage = result.events.find((event) => event.kind === 'usage')
  assert.equal(objectValue(usage?.payload.usage).total_tokens, 1600)
  assert.equal(result.requests, 1)
  assertPartialTextPreserved(result.events)
})

test('真实 Responses max_output_tokens 保持 pi length 语义，不误报请求失败', async () => {
  const result = await runResponsesFixture([incompleteResponse('max_output_tokens')])

  assert.equal(result.message.stopReason, 'length')
  assert.equal(result.message.rawStopReason, 'incomplete.max_output_tokens')
  assert.equal(result.outcome, 'completed')
  assert.equal(result.error, undefined)
  assert.equal(result.message.usage.totalTokens, 1600)
  assert.equal(result.requests, 1)
  assertPartialTextPreserved(result.events)
})

interface PersistedEvent {
  kind: RuntimeEventKind
  payload: Record<string, unknown>
}

async function runResponsesFixture(terminalEvents: Array<Record<string, unknown>>, abortOnText = false) {
  const prefix = [
    { type: 'response.created', response: { id: 'resp_fixture' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'in_progress', content: [] },
    },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '已经收到的部分正文' },
  ]
  const body = [...prefix, ...terminalEvents]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  let requests = 0
  const providerFetch = createRestrictedProviderFetch(model.baseUrl, true, async (input, init) => {
    requests += 1
    assert.equal(input instanceof Request ? input.url : String(input), `${model.baseUrl}/responses`)
    assert.equal(new Headers(init?.headers).has('authorization'), false)
    assert.equal(init?.redirect, 'manual')
    assert.equal(JSON.parse(String(init?.body)).max_output_tokens, 4096)
    // 使用真实 SDK 解析 SSE，但所有响应都来自内存，不访问用户配置或网络。
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })
  const events: PersistedEvent[] = []
  const bridge = new PiEventBridge({
    writer: { push: (kind, payload) => { events.push({ kind, payload }) } },
    assistantMessageID: 'agm_provider_failure_fixture',
    originalToolName: () => null,
  })
  const agent = new Agent({
    initialState: {
      model,
      systemPrompt: '测试模型流式终止状态。',
      tools: [],
      messages: [{ role: 'user', content: '继续测试', timestamp: 0 }],
    },
    streamFn: createRuntimeStreamFunction(undefined, providerFetch),
  })
  const unsubscribe = agent.subscribe((event) => {
    bridge.handle(event)
    if (abortOnText && event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      agent.abort()
    }
  })
  try {
    await agent.continue()
    await agent.waitForIdle()
    const last = agent.state.messages[agent.state.messages.length - 1]
    assert.equal(last?.role, 'assistant')
    return {
      requests,
      events,
      message: last as AssistantMessage,
      outcome: bridge.outcome(),
      error: events.find((event) => event.kind === 'error')?.payload.error as Record<string, unknown> | undefined,
    }
  } finally {
    unsubscribe()
    agent.clearAllQueues()
  }
}

function incompleteResponse(reason: string) {
  return {
    type: 'response.incomplete',
    response: { status: 'incomplete', incomplete_details: { reason }, usage: providerUsage, output: [] },
  }
}

function assertPartialTextPreserved(events: PersistedEvent[]) {
  const deltas = events.filter((event) => event.kind === 'message_delta')
  assert.equal(deltas.length, 1)
  assert.equal(objectValue(deltas[0]!.payload.message_delta).delta, '已经收到的部分正文')
  const parts = events.filter((event) => event.kind === 'message_part')
  assert.equal(parts.length, 1)
  const part = objectValue(parts[0]!.payload.message_part)
  assert.equal(objectValue(objectValue(part.content).text).text, '已经收到的部分正文')
}

function objectValue(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
