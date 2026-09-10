import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import { PiEventBridge } from './piEventBridge.ts'
import type { RuntimeEventKind } from './workerCoreClient.ts'

class EventSink {
  readonly values: Array<{ kind: RuntimeEventKind; payload: Record<string, unknown> }> = []

  push(kind: RuntimeEventKind, payload: Record<string, unknown>) {
    this.values.push({ kind, payload })
  }
}

test('pi 事件映射流式片段、签名、Tool 时间线和累计 usage', () => {
  const sink = new EventSink()
  let now = 100
  let part = 0
  const bridge = new PiEventBridge({
    writer: sink,
    assistantMessageID: 'agm_reply',
    originalToolName: (name) => name === 'm_termous_dhosts_dlist'
      ? 'termous.hosts.list'
      : null,
    now: () => now,
    newPartID: () => `agp_${++part}`,
  })
  const assistant = assistantMessage()
  bridge.handle({ type: 'message_start', message: assistant })
  bridge.handle({
    type: 'message_update',
    message: assistant,
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta: '结果',
      partial: assistant,
    },
  })
  bridge.handle({ type: 'message_end', message: assistant })
  bridge.handle({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'm_termous_dhosts_dlist',
    args: {},
  })
  now = 148
  bridge.handle({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'm_termous_dhosts_dlist',
    result: {
      content: [{ type: 'text', text: '[]' }],
      details: {
        kind: 'mcp',
        originalToolName: 'termous.hosts.list',
        result: { content: [{ type: 'text', text: '[]' }] },
      },
    },
    isError: false,
  })
  bridge.handle({
    type: 'message_end',
    message: {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'm_termous_dhosts_dlist',
      content: [{ type: 'text', text: '[]' }],
      isError: false,
      timestamp: 1,
    },
  })

  assert.deepEqual(sink.values.map((value) => value.kind), [
    'message_delta',
    'message_part',
    'message_part',
    'message_part',
    'usage',
    'tool_started',
    'tool_completed',
    'message_part',
  ])
  const delta = nested(sink.values[0]?.payload, 'message_delta')
  const textPart = nested(sink.values[1]?.payload, 'message_part')
  assert.equal(delta.part_id, textPart.id)
  assert.equal(delta.kind, 'text')
  const reasoningPart = nested(sink.values[2]?.payload, 'message_part')
  assert.equal(
    nested(reasoningPart.content, 'reasoning').thinking_signature,
    'private-signature',
  )
  const tool = nested(sink.values[6]?.payload, 'tool')
  assert.equal(tool.tool_name, 'termous.hosts.list')
  assert.equal(tool.duration_ms, 48)
  const usage = nested(sink.values[4]?.payload, 'usage')
  assert.equal(usage.input_tokens, 5)
  assert.equal(usage.cache_read_tokens, 4)
  assert.equal(usage.cache_write_tokens, 0)
  assert.equal(usage.output_tokens, 3)
  assert.equal(usage.total_tokens, 12)
})

test('摘要和主 Agent 的 usage 通过同一事件桥顺序累计', () => {
  const sink = new EventSink()
  const bridge = new PiEventBridge({
    writer: sink,
    assistantMessageID: 'agm_reply',
    originalToolName: (name) => name === 'm_termous_dhosts_dlist'
      ? 'termous.hosts.list'
      : null,
  })
  bridge.addUsage({
    input_tokens: 100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 20,
    reasoning_tokens: 2,
    total_tokens: 120,
    estimated: false,
  })

  bridge.handle({ type: 'message_end', message: assistantMessage() })

  const usageEvents = sink.values.filter((value) => value.kind === 'usage')
  assert.equal(usageEvents.length, 2)
  assert.equal(nested(usageEvents[0]!.payload, 'usage').total_tokens, 120)
  const usage = nested(usageEvents[1]!.payload, 'usage')
  assert.deepEqual(usage, {
    input_tokens: 105,
    cache_read_tokens: 4,
    cache_write_tokens: 0,
    output_tokens: 23,
    reasoning_tokens: 3,
    total_tokens: 132,
    estimated: false,
  })
})

for (const stopReason of ['error', 'aborted'] as const) {
  test(`门禁 ${stopReason} 未触网时不把已确认摘要用量误标为部分统计`, () => {
    const sink = new EventSink()
    const bridge = new PiEventBridge({
      writer: sink, assistantMessageID: 'agm_reply', originalToolName: () => null,
      requestFailure: () => ({
        code: 'AGENT_RUNTIME_CONTEXT_COMPRESSION_CHECKPOINT_FAILED', message: '摘要保存未获确认',
      }),
    })
    const summaryUsage = {
      input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0,
      output_tokens: 20, reasoning_tokens: 2, total_tokens: 120, estimated: false,
    }
    bridge.addUsage(summaryUsage)
    const message = assistantMessage()
    message.content = []
    message.stopReason = stopReason
    message.usage = { ...usage(), input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 }
    bridge.handle({ type: 'message_end', message })
    const usageEvents = sink.values.filter((value) => value.kind === 'usage')
    assert.equal(usageEvents.length, 1)
    assert.deepEqual(nested(usageEvents[0]!.payload, 'usage'), summaryUsage)
    assert.equal(bridge.outcome(), stopReason === 'error' ? 'failed' : 'cancelled')
  })
}

test('单次用量只能绑定本次回复尾片段，空回复不会复用上次身份', () => {
  const bridge = new PiEventBridge({
    writer: new EventSink(), assistantMessageID: 'agm_reply', originalToolName: () => null,
    newPartID: () => 'agp_reply',
  })
  const first = { ...assistantMessage(), content: [{ type: 'text' as const, text: '已完成' }] }
  bridge.handle({ type: 'message_start', message: first })
  bridge.handle({ type: 'message_end', message: first })
  assert.equal(bridge.lastAssistantPartID(), 'agp_reply')
  const empty = { ...first, content: [] }
  bridge.handle({ type: 'message_start', message: empty })
  assert.equal(bridge.lastAssistantPartID(), undefined)
  bridge.handle({ type: 'message_end', message: empty })
  assert.equal(bridge.lastAssistantPartID(), undefined)
})

test('Provider 失败保留脱敏详情，隐藏服务地址和凭据', () => {
  const sink = new EventSink()
  const bridge = new PiEventBridge({
    writer: sink,
    assistantMessageID: 'agm_reply',
    originalToolName: () => null,
  })
  const message = assistantMessage()
  message.content = [{ type: 'text', text: '' }]
  message.stopReason = 'error'
  message.errorMessage = 'https://secret.example/v1 returned token=secret'
  bridge.handle({ type: 'message_end', message })

  assert.equal(bridge.outcome(), 'failed')
  const error = nested(sink.values[sink.values.length - 1]?.payload, 'error')
  assert.equal(error.code, 'AGENT_MODEL_REQUEST_FAILED')
  assert.equal(error.message, '[地址已隐藏] returned token=[已隐藏]')
  assert.equal(JSON.stringify(sink.values).includes('secret.example'), false)
})

test('摘要门禁附加说明后的最终错误仍遵守 Core 四 KiB 上限', () => {
  const sink = new EventSink()
  const bridge = new PiEventBridge({
    writer: sink, assistantMessageID: 'agm_reply', originalToolName: () => null,
    requestFailure: () => ({ code: 'AGENT_RUNTIME_CONTEXT_COMPRESSION_PROVIDER_FAILED',
      message: `摘要请求失败：503 ${'中文错误'.repeat(1500)}。原始记录仍保留。` }),
  })
  bridge.handle({ type: 'message_end', message: { ...assistantMessage(), content: [], stopReason: 'error' } })
  const error = nested(sink.values[sink.values.length - 1]?.payload, 'error')
  assert.ok(Buffer.byteLength(String(error.message), 'utf8') <= 4096)
  assert.match(String(error.message), /摘要请求失败：503/u)
  assert.match(String(error.message), /内容已截断/u)
})

test('Tool 时间线参数和结果执行递归脱敏与限长投影', () => {
  const sink = new EventSink()
  const bridge = new PiEventBridge({
    writer: sink,
    assistantMessageID: 'agm_reply',
    originalToolName: () => 'termous.hosts.list',
  })
  bridge.handle({
    type: 'tool_execution_start',
    toolCallId: 'call-secret',
    toolName: 'm_termous_dhosts_dlist',
    args: {
      username: 'root',
      password: 'plain-password',
      nested: { api_key: 'plain-api-key' },
      note: 'Authorization: Bearer plain-bearer',
      large: 'x'.repeat(40 * 1024),
    },
  })
  bridge.handle({
    type: 'tool_execution_end',
    toolCallId: 'call-secret',
    toolName: 'm_termous_dhosts_dlist',
    result: {
      content: [{ type: 'text', text: 'ok' }],
      details: {
        kind: 'mcp',
        originalToolName: 'termous.hosts.list',
        result: {
          content: [
            { type: 'text', text: 'token=plain-result-token' },
            { type: 'image', data: 'plain-image-data', mimeType: 'image/png' },
          ],
        },
      },
    },
    isError: false,
  })

  const serialized = JSON.stringify(sink.values)
  assert.equal(serialized.includes('plain-password'), false)
  assert.equal(serialized.includes('plain-api-key'), false)
  assert.equal(serialized.includes('plain-bearer'), false)
  assert.equal(serialized.includes('plain-result-token'), false)
  assert.equal(serialized.includes('plain-image-data'), false)
  assert.equal(Buffer.byteLength(serialized, 'utf8') < 24 * 1024, true)
})

test('失败尝试保留正文和思考、标记有效工具，未形成工具不伪造执行，随后独立保存成功片段', () => {
  const sink = new EventSink()
  let id = 0
  const bridge = new PiEventBridge({
    writer: sink, assistantMessageID: 'agm_failure_parts',
    originalToolName: (name) => name === 'known' ? 'known' : null,
    newPartID: () => `agp_failure_${++id}`, providerErrorSecrets: ['fixture-private-key'],
  })
  const failed: AssistantMessage = {
    ...assistantMessage(), stopReason: 'error', errorMessage: 'terminated fixture-private-key',
    content: [
      { type: 'text', text: '半截正文' }, { type: 'thinking', thinking: '半截思考' },
      { type: 'toolCall', id: 'valid-call', name: 'known', arguments: {} },
      { type: 'toolCall', id: '', name: '', arguments: {} },
    ],
  }
  bridge.handle({ type: 'message_start', message: failed })
  bridge.finalizeFailedAttempt(failed)
  assert.equal(bridge.outcome(), 'completed')
  assert.equal(bridge.lastAssistantPartID(), undefined)
  assert.deepEqual(sink.values.map((event) => event.kind), ['message_part', 'message_part', 'message_part'])
  const failures = sink.values.map((event) => nested(nested(event.payload, 'message_part').content, 'response_failure'))
  assert.equal(new Set(failures.map((value) => value.attempt_id)).size, 1)
  assert.ok(failures.every((value) => value.error_message === 'terminated [已隐藏]'))
  const completed = { ...assistantMessage(), content: [{ type: 'text' as const, text: '完整回答' }], stopReason: 'stop' as const }
  bridge.handle({ type: 'message_end', message: completed })
  const lastPart = nested(sink.values[3]!.payload, 'message_part')
  assert.equal(lastPart.id, 'agp_failure_4')
  assert.equal((lastPart.content as Record<string, unknown>).response_failure, undefined)
  assert.equal(sink.values.filter((event) => event.kind === 'usage').length, 1)
})

test('断流终态丢失内容仍保存已展示的增量，最终失败和取消部分均不恢复为有效回答', () => {
  for (const stopReason of ['error', 'aborted'] as const) {
    const sink = new EventSink()
    const bridge = new PiEventBridge({ writer: sink, assistantMessageID: 'agm_partial', originalToolName: () => null })
    const message = { ...assistantMessage(), content: [], stopReason, errorMessage: 'terminated' }
    bridge.handle({ type: 'message_start', message })
    bridge.handle({ type: 'message_update', message,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '已展示的内容', partial: message } })
    bridge.handle({ type: 'message_end', message })
    const part = nested(sink.values.find((event) => event.kind === 'message_part')!.payload, 'message_part')
    assert.equal(nested(part.content, 'text').text, '已展示的内容')
    assert.equal(nested(part.content, 'response_failure').error_message, stopReason === 'error' ? 'terminated' : '')
    assert.equal(bridge.outcome(), stopReason === 'error' ? 'failed' : 'cancelled')
  }
})

test('手动停止仅清除当前取消尝试的诊断，此前真实失败原文和半截回答仍保留', () => {
  const sink = new EventSink()
  let id = 0
  const bridge = new PiEventBridge({
    writer: sink, assistantMessageID: 'agm_cancel', originalToolName: () => null,
    newPartID: () => `agp_cancel_${++id}`,
  })
  const errorMessage = 'OpenAI Responses stream ended before a terminal response event'
  const failed: AssistantMessage = {
    ...assistantMessage(), content: [{ type: 'text', text: '真实断流前的回答' }],
    stopReason: 'error', errorMessage,
  }
  bridge.finalizeFailedAttempt(failed)
  bridge.handle({ type: 'message_end', message: {
    ...failed, content: [{ type: 'text', text: '重试后主动停止的回答' }], stopReason: 'aborted',
  } })

  const parts = sink.values.filter((event) => event.kind === 'message_part')
    .map((event) => nested(event.payload, 'message_part'))
  assert.equal(parts.length, 2)
  assert.deepEqual(parts.map((part) => nested(part.content, 'text').text), ['真实断流前的回答', '重试后主动停止的回答'])
  const failures = parts.map((part) => nested(part.content, 'response_failure'))
  assert.equal(failures[0]!.error_message, errorMessage)
  assert.equal(failures[1]!.error_message, '')
  assert.notEqual(failures[0]!.attempt_id, failures[1]!.attempt_id)
  assert.equal(sink.values.some((event) => event.kind === 'error'), false)
  assert.equal(bridge.outcome(), 'cancelled')
})

function assistantMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: '结果' },
      {
        type: 'thinking',
        thinking: '分析',
        thinkingSignature: 'private-signature',
      },
      {
        type: 'toolCall',
        id: 'call-1',
        name: 'm_termous_dhosts_dlist',
        arguments: {},
      },
    ],
    api: 'openai-responses',
    provider: 'termous-openai-compatible',
    model: 'test-model',
    usage: usage(),
    stopReason: 'toolUse',
    timestamp: 1,
  }
}

function usage(): Usage {
  return {
    input: 5,
    output: 3,
    cacheRead: 4,
    cacheWrite: 0,
    reasoning: 1,
    totalTokens: 12,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function nested(value: unknown, key: string): Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  const result = (value as Record<string, unknown>)[key]
  assert.equal(typeof result, 'object')
  assert.notEqual(result, null)
  return result as Record<string, unknown>
}
