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
  assert.equal(usage.input_tokens, 9)
  assert.equal(usage.output_tokens, 3)
  assert.equal(usage.total_tokens, 12)
})

test('Provider 失败只写入稳定错误分类', () => {
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
  assert.equal(error.message, '模型请求失败')
  assert.equal(JSON.stringify(sink.values).includes('secret.example'), false)
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
