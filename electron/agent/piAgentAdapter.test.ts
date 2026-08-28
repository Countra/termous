import assert from 'node:assert/strict'
import test from 'node:test'
import type { RuntimeBootstrap } from './workerCoreClient.ts'
import {
  chatMaxTokensField,
  createRestrictedProviderFetch,
  createRuntimeModel,
  createRuntimeStreamOptions,
  handlePiEvent,
  hydrateRuntimeMessages,
} from './piAgentAdapter.ts'

test('Chat Completions 输出上限字段与 Core 模型探测兼容矩阵一致', () => {
  for (const [baseURL, expected] of [
    ['https://api.openai.com/v1', 'max_completion_tokens'],
    ['http://127.0.0.1:11434/v1', 'max_completion_tokens'],
    ['https://api.deepseek.com/v1', 'max_tokens'],
    ['https://api.moonshot.cn/v1', 'max_tokens'],
    ['https://gateway.ai.cloudflare.com/v1/account/gateway', 'max_tokens'],
    ['https://api.together.ai/v1', 'max_tokens'],
    ['https://integrate.api.nvidia.com/v1', 'max_tokens'],
    ['https://api.ant-ling.com/v1', 'max_tokens'],
    ['https://api.z.ai/api/paas/v4', 'max_tokens'],
    ['https://open.bigmodel.cn/api/paas/v4', 'max_tokens'],
  ] as const) {
    assert.equal(chatMaxTokensField(baseURL), expected, baseURL)
  }
})

test('Chat Completions 兼容矩阵使用规范化主机名判定', () => {
  for (const baseURL of [
    'https://API.MOONSHOT.CN/v1',
    'https://gateway.API.MOONSHOT.CN./v1',
  ]) {
    assert.equal(chatMaxTokensField(baseURL), 'max_tokens', baseURL)
  }
  for (const baseURL of [
    'https://example.test/v1/API.MOONSHOT.CN',
    'https://api.moonshot.cn.example.test/v1',
    'https://prefixapi.moonshot.cn/v1',
  ]) {
    assert.equal(chatMaxTokensField(baseURL), 'max_completion_tokens', baseURL)
  }
})

test('Provider fetch 限定 origin 和路径前缀并移除无鉴权哨兵', async () => {
  let received: RequestInit | undefined
  const controlled = createRestrictedProviderFetch(
    'http://127.0.0.1:11434/v1',
    true,
    async (_input, init) => {
      received = init
      return new Response('{}', { status: 200 })
    },
  )
  const request = new Request('http://127.0.0.1:11434/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer termous-local-no-auth' },
  })

  await controlled(request)
  assert.equal(new Headers(received?.headers).has('authorization'), false)
  assert.equal(received?.redirect, 'manual')
  await assert.rejects(
    controlled('http://127.0.0.1:11434/v10/chat/completions'),
    /AGENT_MODEL_ENDPOINT_VIOLATION/,
  )
  await assert.rejects(
    controlled('http://example.test/v1/chat/completions'),
    /AGENT_MODEL_ENDPOINT_VIOLATION/,
  )
})

test('历史 assistant 按 tool_result 边界拆分并恢复原 MCP 名称', () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.messages = [
    {
      id: 'agm_assistant',
      role: 'assistant',
      status: 'completed',
      sequence: 1,
      created_at: '2026-08-28T00:00:00Z',
      parts: [
        runtimePart('tool_call', 1, {
          tool_call: {
            tool_call_id: 'call-1',
            tool_name: 'termous.hosts.list',
            arguments: {},
          },
        }),
        runtimePart('tool_result', 2, {
          tool_result: {
            tool_call_id: 'call-1',
            tool_name: 'termous.hosts.list',
            content: [{ type: 'text', text: '[]' }],
            is_error: false,
          },
        }),
        runtimePart('text', 3, { text: { text: '完成' } }),
      ],
    },
    {
      id: 'agm_user',
      role: 'user',
      status: 'completed',
      sequence: 2,
      created_at: '2026-08-28T00:01:00Z',
      parts: [runtimePart('text', 1, { text: { text: '继续' } })],
    },
  ]

  const messages = hydrateRuntimeMessages(bootstrap, createRuntimeModel(bootstrap))
  assert.deepEqual(messages.map((message) => message.role), [
    'assistant',
    'toolResult',
    'assistant',
    'user',
  ])
  assert.equal(
    messages[0]?.role === 'assistant' && messages[0].content[0]?.type === 'toolCall'
      ? messages[0].content[0].name
      : '',
    'm_termous_dhosts_dlist',
  )
})

test('自定义模型使用保守兼容配置', () => {
  const chatBootstrap = runtimeBootstrap()
  const chat = createRuntimeModel(chatBootstrap)
  assert.equal(chat.api, 'openai-completions')
  if (chat.api !== 'openai-completions') {
    assert.fail('模型 API 类型错误')
  }
  assert.equal(chat.compat?.supportsStrictMode, false)
  assert.equal(chat.compat?.supportsLongCacheRetention, false)
  assert.equal(chat.compat?.supportsDeveloperRole, false)
  assert.equal(chat.compat?.supportsStore, false)
  assert.equal(chat.compat?.sendSessionAffinityHeaders, false)

  chatBootstrap.model.snapshot.api_mode = 'responses'
  const responses = createRuntimeModel(chatBootstrap)
  assert.equal(responses.api, 'openai-responses')
  if (responses.api !== 'openai-responses') {
    assert.fail('模型 API 类型错误')
  }
  assert.equal(responses.compat?.supportsStrictMode, false)
  assert.equal(responses.compat?.supportsLongCacheRetention, false)
  assert.equal(responses.compat?.supportsDeveloperRole, false)
})

test('Provider 调用固定关闭缓存保留和自动重试', () => {
  const providerFetch = async () => new Response('{}')
  const options = createRuntimeStreamOptions('configured', providerFetch, {
    cacheRetention: 'long',
    maxRetries: 4,
  })

  assert.equal(options.cacheRetention, 'none')
  assert.equal(options.maxRetries, 0)
  assert.equal(options.apiKey, 'configured')
  assert.equal(options.fetch, providerFetch)
})

test('pi 监听器异常通知失败并取消 Agent，且不反向抛出', () => {
  const failure = new Error('bridge failed')
  let received: unknown
  let aborted = false

  assert.doesNotThrow(() => handlePiEvent(
    { type: 'agent_start' },
    { handle: () => { throw failure } },
    (error) => { received = error },
    () => { aborted = true },
  ))
  assert.equal(received, failure)
  assert.equal(aborted, true)
})

function runtimeBootstrap(): RuntimeBootstrap {
  return {
    core_instance_id: 'core-1',
    run: {
      id: 'agr_test',
      session_id: 'ags_test',
      generation: 1,
      event_sequence: 1,
      status: 'starting',
      assistant_message_id: 'agm_reply',
      reasoning_level: 'off',
    },
    session: { id: 'ags_test' },
    messages: [],
    runtime_bearer: 'r'.repeat(48),
    mcp: {
      endpoint: '/mcp',
      bearer_token: 'm'.repeat(48),
      protocol_version: '2025-11-25',
    },
    model: {
      snapshot: {
        api_mode: 'chat_completions',
        base_url: 'http://127.0.0.1:11434/v1',
        model_id: 'test-model',
        context_window_tokens: 8192,
        max_output_tokens: 1024,
        supports_images: false,
        supports_reasoning: false,
      },
    },
  }
}

function runtimePart(
  kind: 'text' | 'reasoning' | 'tool_call' | 'tool_result',
  sequence: number,
  content: Record<string, unknown>,
) {
  return {
    id: `agp_${sequence}`,
    message_id: 'agm_test',
    kind,
    sequence,
    content,
  }
}
