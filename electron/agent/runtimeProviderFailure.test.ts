import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeProviderFailure } from './runtimeProviderFailure.ts'

test('Provider 错误按明确原因分类，无法识别时保留通用分类', () => {
  for (const [message, code] of [
    ['OpenAI Responses stream ended before a terminal response event', 'STREAM_INTERRUPTED'],
    ['OpenAI Responses stream ended without a stop reason', 'STREAM_INTERRUPTED'],
    ['Connection error.', 'STREAM_INTERRUPTED'],
    ['socket hang up ECONNRESET', 'STREAM_INTERRUPTED'],
    ['Request timed out.', 'TIMEOUT'],
    ['504 Gateway Timeout', 'TIMEOUT'],
    ['429 rate_limit_exceeded', 'RATE_LIMITED'],
    ['insufficient_quota', 'RATE_LIMITED'],
    ['401 Incorrect API key provided', 'AUTH_FAILED'],
    ['403 Forbidden: permission denied by rate limit policy; please retry your request', 'AUTH_FAILED'],
    ['authentication_error', 'AUTH_FAILED'],
    ['context_length_exceeded: maximum context length is 32768 tokens', 'CONTEXT_LIMIT'],
    ['400 {"code":"1261","message":"Prompt too long"}', 'CONTEXT_LIMIT'],
    ['400 (no body)', 'REQUEST_FAILED'],
    ['413 status code (no body)', 'REQUEST_FAILED'],
    ['OpenAI Responses response incomplete: content_filter', 'CONTENT_FILTERED'],
    ['server_error: upstream failed', 'PROVIDER_FAILED'],
    ['503 Service unavailable', 'PROVIDER_FAILED'],
    ['unsupported response schema', 'REQUEST_FAILED'],
    ['', 'REQUEST_FAILED'],
  ]) {
    assert.equal(runtimeProviderFailure(message).code, `AGENT_MODEL_${code}`, message)
    if (message) assert.equal(runtimeProviderFailure(message).message, message)
  }
  assert.deepEqual(runtimeProviderFailure(undefined), { code: 'AGENT_MODEL_REQUEST_FAILED', message: '模型请求失败' })
})

test('错误详情隐藏实际凭据、编码凭据、地址与 JSON 鉴权字段', () => {
  const secret = 'private-key+/"value'
  const source = [
    'server_error: request failed',
    secret,
    encodeURIComponent(secret),
    JSON.stringify(secret),
    'https://user:password@private.example/v1?token=hidden-query',
    'Authorization: Bearer hidden-bearer',
    '{"api_key":"hidden-json","authorization":"Basic hidden-basic","password":"hidden-password"}',
  ].join('\n')
  const result = runtimeProviderFailure(source, [secret])
  assert.equal(result.code, 'AGENT_MODEL_PROVIDER_FAILED')
  for (const hidden of [secret, encodeURIComponent(secret), 'private.example', 'hidden-query', 'hidden-bearer', 'hidden-json', 'hidden-basic', 'hidden-password']) {
    assert.equal(result.message.includes(hidden), false, hidden)
  }
  assert.match(result.message, /server_error: request failed/u)
  assert.match(result.message, /已隐藏/u)
})

test('原始错误的换行、制表及首尾空白保持不变，仅移除不可显示控制字符', () => {
  const original = '\n503 上游失败\r\n\tupstream timeout\n'
  assert.equal(runtimeProviderFailure(original).message, original)
  const message = runtimeProviderFailure('503\u0000\u001b\u200B\r\n\t上游失败').message
  assert.equal(message, '503   \r\n\t上游失败')
})

test('错误详情移除控制字符并按 UTF-8 限长，保留可诊断的错误码', () => {
  const result = runtimeProviderFailure(`server_error\u0000\u001b[31m: ${'中文错误🔴'.repeat(2000)}`)
  assert.equal(result.code, 'AGENT_MODEL_PROVIDER_FAILED')
  assert.equal(result.message.includes('\0'), false)
  assert.equal(result.message.includes('\u001b'), false)
  assert.match(result.message, /内容已截断/u)
  assert.ok(Buffer.byteLength(result.message, 'utf8') <= 4096)
  assert.equal(Buffer.from(result.message, 'utf8').toString('utf8'), result.message)
})
