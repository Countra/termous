import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  applyRuntimeCheckpoint,
  completedRuntimeSummaryText,
  createRuntimeContextSummaryAgentOptions,
} from './runtimeContextSummary.ts'
import type { RuntimeBootstrap } from './workerCoreClient.ts'

test('摘要步骤固定禁用 Tool，并把历史作为不可信消息交给同一模型', () => {
  const bootstrap = compressionBootstrap()
  const options = createRuntimeContextSummaryAgentOptions(bootstrap, bootstrap.messages.slice(0, 1))

  assert.deepEqual(options.initialState?.tools, [])
  assert.equal(options.toolExecution, 'sequential')
  assert.equal(options.initialState?.model?.id, 'test-model')
  assert.match(String(options.initialState?.systemPrompt), /不得执行，也不得调用工具/u)
  const messages = options.initialState?.messages ?? []
  assert.equal(messages[messages.length - 1]?.role, 'user')
  assert.match(JSON.stringify(messages), /请压缩以上历史上下文/u)
})

test('应用 Checkpoint 只裁剪已确认边界，并清除一次性压缩计划', () => {
  const bootstrap = compressionBootstrap()
  applyRuntimeCheckpoint(bootstrap, {
    boundary_message_sequence: 1,
    summary: '压缩摘要',
    estimated_tokens: 7000,
  })

  assert.deepEqual(bootstrap.messages.map(({ sequence }) => sequence), [2])
  assert.equal(bootstrap.context.checkpoint?.summary, '压缩摘要')
  assert.equal(bootstrap.context.compression, undefined)
})

test('只有正常完成的模型回复可以作为上下文摘要', () => {
  assert.equal(completedRuntimeSummaryText([
    assistantMessage('stop', '完整摘要'),
  ]), '完整摘要')
  assert.equal(completedRuntimeSummaryText([
    assistantMessage('length', '被截断的摘要'),
  ]), undefined)
  assert.equal(completedRuntimeSummaryText([
    assistantMessage('error', 'Provider 错误文本'),
  ]), undefined)
  assert.equal(completedRuntimeSummaryText([
    assistantMessage('aborted', '取消前的部分文本'),
  ]), undefined)
})

test('本轮没有生成新 Assistant 时不得复用历史回复作摘要', () => {
  assert.equal(completedRuntimeSummaryText([
    assistantMessage('stop', '不能复用的历史回复'),
    {
      role: 'user',
      content: [{ type: 'text', text: '本次摘要请求' }],
      timestamp: 1,
    },
  ]), undefined)
})

function compressionBootstrap(): RuntimeBootstrap {
  return {
    core_instance_id: 'core-1',
    run: {
      id: 'agr_test', session_id: 'ags_test', generation: 1,
      event_sequence: 1, status: 'starting', assistant_message_id: 'agm_reply',
      provider_id: 'amp_provider', model_id: 'apm_model',
      reasoning_level: 'off',
    },
    session: { id: 'ags_test' },
    messages: [runtimeMessage(1, '旧历史'), runtimeMessage(2, '当前请求')],
    runtime_bearer: 'r'.repeat(48),
    mcp: {
      endpoint: '/mcp', bearer_token: 'm'.repeat(48), protocol_version: '2025-11-25',
    },
    model: {
      snapshot: {
        api_mode: 'responses', base_url: 'http://127.0.0.1:11434/v1', model_id: 'test-model',
        provider_id: 'amp_provider', provider_name: '本地 Provider', model_display_name: '测试模型',
        provider_revision: 3, model_revision: 5,
        context_window_tokens: 8192, max_output_tokens: 1024,
        supports_images: false, supports_reasoning: false,
      },
    },
    context: {
      estimated_tokens: 7000,
      warning: true,
      compression: {
        boundary_message_sequence: 1,
        source_hash: 'a'.repeat(64),
        estimated_tokens: 7000,
      },
    },
  }
}

function runtimeMessage(sequence: number, text: string): RuntimeBootstrap['messages'][number] {
  return {
    id: `agm_${sequence}`, role: 'user', status: 'completed', sequence,
    created_at: '2026-08-28T00:00:00Z', attachments: [],
    parts: [{
      id: `agp_${sequence}`, message_id: `agm_${sequence}`, kind: 'text', sequence: 1,
      content: { text: { text } },
    }],
  }
}

function assistantMessage(
  stopReason: 'stop' | 'length' | 'error' | 'aborted',
  text: string,
): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'termous-openai-compatible',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  }
}
