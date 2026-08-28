import assert from 'node:assert/strict'
import test from 'node:test'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { Type } from 'typebox'
import {
  agentModelFixtureID,
  agentModelFixtureApprovalToolName,
  agentModelFixturePrompts,
  agentModelFixtureToolName,
  createAgentModelFixture,
} from './openai-compatible-fixture.mjs'

test('Fixture 仅监听 loopback 并兼容 Core 模型探测', async () => {
  await withFixture(async ({ baseURL, address }) => {
    assert.equal(address.address, '127.0.0.1')
    const health = await fetch(`${baseURL.replace(/\/v1$/u, '')}/healthz`)
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await health.json(), {
      status: 'ok',
      model: agentModelFixtureID,
    })

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: agentModelFixtureID,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_completion_tokens: 16,
        stream: false,
      }),
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.model, agentModelFixtureID)
    assert.equal(result.choices[0].message.content, 'OK')
    assert.equal(result.choices[0].finish_reason, 'stop')
  })
})

test('Fixture 拒绝非精确接口、错误类型和超限请求', async () => {
  await withFixture(async ({ baseURL }) => {
    assert.equal((await fetch(`${baseURL}/chat/completions?unexpected=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })).status, 404)
    assert.equal((await fetch(`${baseURL}/chat/completions`)).status, 405)
    assert.equal((await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    })).status, 415)
    assert.equal((await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(2 * 1024 * 1024) }),
    })).status, 413)
  })
})

test('pi Chat Completions 适配器读取真实 reasoning_content 和 usage', async () => {
  await withFixture(async ({ baseURL }) => {
    const streamed = await collectPiStream(baseURL, {
      messages: [userMessage(agentModelFixturePrompts.reasoning)],
    }, { reasoning: 'medium' })

    assert.equal(streamed.result.stopReason, 'stop')
    assert.equal(streamed.result.usage.reasoning, 5)
    assert.deepEqual(
      streamed.result.content.filter((part) => part.type === 'thinking'),
      [{
        type: 'thinking',
        thinking: '正在验证 reasoning 流式投影。',
        thinkingSignature: 'reasoning_content',
      }],
    )
    assert.equal(
      streamed.events.filter((event) => event.type === 'thinking_delta').length,
      2,
    )
  })
})

test('pi Chat Completions 适配器完成一次只读 Tool call 后继续回答', async () => {
  await withFixture(async ({ baseURL }) => {
    const context = {
      messages: [userMessage(agentModelFixturePrompts.tool)],
      tools: [{
        name: agentModelFixtureToolName,
        description: '列出 Termous 主机',
        parameters: Type.Object({}, { additionalProperties: false }),
      }],
    }
    const first = await collectPiStream(baseURL, context)
    assert.equal(first.result.stopReason, 'toolUse')
    const toolCall = first.result.content.find((part) => part.type === 'toolCall')
    assert.ok(toolCall)
    assert.equal(toolCall.name, agentModelFixtureToolName)
    assert.deepEqual(toolCall.arguments, {})

    context.messages.push(first.result, {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: 'text', text: '[]' }],
      isError: false,
      timestamp: 2,
    })
    const second = await collectPiStream(baseURL, context)
    assert.equal(second.result.stopReason, 'stop')
    assert.equal(
      second.result.content.some((part) =>
        part.type === 'text' && part.text.includes('只读主机列表调用')),
      true,
    )
    assert.equal(second.result.content.some((part) => part.type === 'toolCall'), false)
  })
})

test('Fixture 生成需要人工审批且可安全拒绝的 Tool call', async () => {
  await withFixture(async ({ baseURL }) => {
    const context = {
      messages: [userMessage(agentModelFixturePrompts.approval)],
      tools: [{
        name: agentModelFixtureApprovalToolName,
        description: '创建本机代码片段',
        parameters: Type.Object({
          client_request_id: Type.String(),
          name: Type.String(),
          command: Type.String(),
          shell: Type.String(),
        }, { additionalProperties: false }),
      }],
    }
    const first = await collectPiStream(baseURL, context)
    assert.equal(first.result.stopReason, 'toolUse')
    const toolCall = first.result.content.find((part) => part.type === 'toolCall')
    assert.ok(toolCall)
    assert.equal(toolCall.name, agentModelFixtureApprovalToolName)
    assert.deepEqual(toolCall.arguments, {
      client_request_id: 'agent-stage4-fixture-reject-1',
      name: 'Agent Stage 4 Approval Fixture',
      command: 'echo fixture',
      shell: 'sh',
    })

    context.messages.push(first.result, {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: 'text', text: '用户已拒绝该操作' }],
      isError: true,
      timestamp: 2,
    })
    const second = await collectPiStream(baseURL, context)
    assert.equal(second.result.stopReason, 'stop')
    assert.equal(
      second.result.content.some((part) =>
        part.type === 'text' && part.text.includes('测试数据未写入')),
      true,
    )

    const repeated = await collectPiStream(baseURL, {
      messages: [userMessage(agentModelFixturePrompts.approval)],
      tools: context.tools,
    })
    const repeatedCall = repeated.result.content.find((part) => part.type === 'toolCall')
    assert.ok(repeatedCall)
    assert.equal(repeatedCall.arguments.client_request_id, 'agent-stage4-fixture-reject-2')
  })
})

test('慢响应在客户端取消后立即回收而不等待完整延迟', async () => {
  const fixture = createAgentModelFixture({ chunkDelayMs: 0, slowDelayMs: 5_000 })
  const address = await fixture.listen(0)
  assert.ok(address && typeof address === 'object')
  const controller = new AbortController()
  const startedAt = Date.now()
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: agentModelFixtureID,
        messages: [{ role: 'user', content: agentModelFixturePrompts.slow }],
        stream: true,
      }),
      signal: controller.signal,
    })
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.equal(first.done, false)
    controller.abort()
    await assert.rejects(reader.read(), (error) => error?.name === 'AbortError')
  } finally {
    await fixture.close()
  }
  assert.equal(Date.now() - startedAt < 2_000, true)
})

async function withFixture(run) {
  const fixture = createAgentModelFixture({ chunkDelayMs: 0, slowDelayMs: 100 })
  const address = await fixture.listen(0)
  assert.ok(address && typeof address === 'object')
  try {
    await run({
      address,
      baseURL: `http://127.0.0.1:${address.port}/v1`,
    })
  } finally {
    await fixture.close()
  }
}

async function collectPiStream(baseURL, context, options = {}) {
  const stream = streamSimple(fixtureModel(baseURL), context, {
    apiKey: 'fixture-local-key',
    cacheRetention: 'none',
    maxRetries: 0,
    ...options,
  })
  const events = []
  for await (const event of stream) {
    events.push(event)
  }
  return { events, result: await stream.result() }
}

function fixtureModel(baseURL) {
  return {
    id: agentModelFixtureID,
    name: agentModelFixtureID,
    api: 'openai-completions',
    provider: 'termous-openai-compatible',
    baseUrl: baseURL,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 1_024,
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_completion_tokens',
      supportsStrictMode: false,
      supportsLongCacheRetention: false,
      sendSessionAffinityHeaders: false,
    },
  }
}

function userMessage(content) {
  return { role: 'user', content, timestamp: 1 }
}
