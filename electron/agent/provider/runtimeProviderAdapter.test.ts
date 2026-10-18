import assert from 'node:assert/strict'
import test from 'node:test'
import { chatMaxTokensField, createRestrictedProviderFetch, createRuntimeStreamOptions } from './runtimeProviderAdapter.ts'

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

test('Provider 调用固定关闭缓存保留和底层 HTTP 重试', () => {
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
