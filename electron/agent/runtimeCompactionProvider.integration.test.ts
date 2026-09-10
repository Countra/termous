import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { createRestrictedProviderFetch, createRuntimeStreamFunction } from './piAgentAdapter.ts'
import { runtimeCompactionProjection } from './runtimeCompactionPolicy.ts'
import { runtimeContextFailureMessage } from './runtimeContextGate.ts'
import {
  compactionTestAssistant,
  compactionTestModel,
  compactionTestUser,
  createCompactionTestHarness,
} from './runtimeCompactionTestFixture.ts'

const model = {
  ...compactionTestModel,
  api: 'openai-responses' as const,
  reasoning: true,
  thinkingLevelMap: { off: 'none' },
  contextWindow: 101072,
  maxTokens: 4096,
}
const summary = '## Goal\n继续当前任务。\n## Progress\n保留已完成工作与已确认约束。\n## Next Steps\n执行剩余检查。'
const providerUsage = {
  input_tokens: 5187, output_tokens: 284, total_tokens: 5471,
  output_tokens_details: { reasoning_tokens: 61 },
}
const scenarios = [
  { kind: 'eof', code: 'STREAM_INTERRUPTED', addedUsage: 0 },
  { kind: 'server_error', code: 'PROVIDER_FAILED', addedUsage: 0 },
  { kind: 'content_filter', code: 'CONTENT_FILTERED', addedUsage: 5471 },
  { kind: 'max_output_tokens', code: 'TRUNCATED', addedUsage: 5471 },
  { kind: 'unauthorized', code: 'AUTH_FAILED', addedUsage: 0 },
  { kind: 'unknown', code: 'FAILED', addedUsage: 0 },
] as const
type Scenario = typeof scenarios[number]['kind']

for (const scenario of scenarios) {
  test(`真实 pi 第二次摘要 ${scenario.kind} 保留已提交快照和原文，并以明确原因停止`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const fixture = createProviderFixture(scenario.kind)
    const { harness } = fixture
    const first = history('首次')
    const originalFirst = structuredClone(first)
    await harness.controller.transformContext(first)
    harness.controller.beforeProviderRequest()
    assert.deepEqual(first, originalFirst)
    const checkpoint = harness.controller.checkpoint()
    assert.ok(checkpoint)
    assert.equal(harness.commits.length, 1)
    assert.equal(totalUsage(harness.usages), 5471)

    fixture.failNextSummary()
    const next = [...first, ...history('后续')]
    const originalNext = structuredClone(next)
    const task = harness.controller.transformContext(next)
    const retryable = scenario.kind === 'eof' || scenario.kind === 'server_error'
    if (retryable) {
      for (const delay of [3000, 6000, 12000]) {
        await setImmediate()
        t.mock.timers.tick(delay)
      }
    }
    const projected = await task
    const failure = harness.controller.failure()
    assert.equal(failure?.code, `AGENT_RUNTIME_CONTEXT_COMPRESSION_${scenario.code}`)
    assert.deepEqual(harness.controller.checkpoint(), checkpoint)
    assert.deepEqual(next, originalNext)
    assert.deepEqual(projected, runtimeCompactionProjection(next, checkpoint))
    assert.equal(harness.commits.length, 1)
    assert.deepEqual(harness.activities.map(({ status }) => status), ['started', 'completed', 'started', 'failed'])
    assert.equal(harness.activities[harness.activities.length - 1]?.errorCode, failure?.code)
    assert.equal(totalUsage(harness.usages), 5471 + scenario.addedUsage)
    if (failure!.detail) {
      assert.equal(runtimeContextFailureMessage(failure!.code, failure!.detail), failure!.detail)
    } else {
      assert.match(runtimeContextFailureMessage(failure!.code), /原始记录和上次成功摘要仍保留/u)
    }
    assert.throws(() => harness.controller.beforeProviderRequest(), (error: unknown) => error === failure)

    // 同一快照失败后再次经过门禁不触发摘要或提交，也不能继续主请求。
    await harness.controller.transformContext(next)
    assert.equal(fixture.requests.length, retryable ? 5 : 2)
    assert.equal(harness.commits.length, 1)
    assert.equal(harness.activities.length, 4)
    assert.throws(() => harness.controller.beforeProviderRequest())
    for (const request of fixture.requests) {
      assert.equal(request.max_output_tokens, 4096)
      assert.deepEqual(request.reasoning, { effort: 'none' })
      assert.equal(request.tools, undefined)
    }
  })
}

test('真实摘要 Provider 失败详情保留可诊断原因，隐藏实际凭据及编码地址', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const secret = 'fixture-key+/"private'
  const detail = [
    'summary fixture failed', secret, encodeURIComponent(secret), JSON.stringify(secret),
    `https://private.fixture/v1?credential=${encodeURIComponent(secret)}`,
    'Authorization: Bearer fixture-bearer',
  ].join('\n')
  const fixture = createProviderFixture('server_error', secret, detail)
  await fixture.harness.controller.transformContext(history('首次'))
  fixture.harness.controller.beforeProviderRequest()
  fixture.failNextSummary()
  const task = fixture.harness.controller.transformContext([...history('首次'), ...history('后续')])
  for (const delay of [3000, 6000, 12000]) {
    await setImmediate()
    t.mock.timers.tick(delay)
  }
  await task
  const failure = fixture.harness.controller.failure()
  assert.equal(failure?.code, 'AGENT_RUNTIME_CONTEXT_COMPRESSION_PROVIDER_FAILED')
  assert.match(failure?.detail ?? '', /server_error/u)
  assert.match(failure?.detail ?? '', /summary fixture failed/u)
  const visible = [failure?.detail, runtimeContextFailureMessage(failure!.code, failure!.detail)].join('\n')
  for (const hidden of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), 'private.fixture', 'fixture-bearer']) {
    assert.equal(visible.includes(hidden), false, hidden)
  }
  assert.match(visible, /已隐藏/u)
  const activities = fixture.harness.activities
  assert.equal(activities[activities.length - 1]?.errorCode, failure?.code)
  assert.equal(fixture.requests.length, 5)
})

function createProviderFixture(scenario: Scenario, secret?: string, errorDetail = 'summary fixture failed') {
  let failing = false
  const requests: Array<Record<string, unknown>> = []
  const providerFetch = createRestrictedProviderFetch(model.baseUrl, !secret, async (input, init) => {
    assert.equal(input instanceof Request ? input.url : String(input), `${model.baseUrl}/responses`)
    assert.equal(init?.redirect, 'manual')
    assert.equal(new Headers(init?.headers).get('authorization'), secret ? `Bearer ${secret}` : null)
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    if (failing && scenario === 'unauthorized') {
      return new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'fixture credential rejected' } }), {
        status: 401, headers: { 'content-type': 'application/json' },
      })
    }
    const events = [
      { type: 'response.created', response: { id: 'resp_summary_fixture' } },
      {
        type: 'response.output_item.added', output_index: 0,
        item: { type: 'message', id: 'msg_summary_fixture', role: 'assistant', status: 'in_progress', content: [] },
      },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: summary },
      ...terminalEvents(failing ? scenario : 'completed', errorDetail),
    ]
    // SSE、鉴权检查和错误均在内存完成，禁止触及用户模型或远端工具。
    const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })
  const harness = createCompactionTestHarness({
    model,
    thresholdPercent: 50,
    thinkingLevel: 'off',
    providerErrorSecrets: secret ? [secret] : [],
    streamFn: createRuntimeStreamFunction(secret, providerFetch),
  })
  return { harness, requests, failNextSummary: () => { failing = true } }
}

function terminalEvents(scenario: Scenario | 'completed', errorDetail: string) {
  const response = { id: 'resp_summary_fixture', output: [], usage: providerUsage }
  if (scenario === 'eof') return []
  if (scenario === 'server_error' || scenario === 'unknown') {
    return [{ type: 'response.failed', response: {
      ...response, status: 'failed', error: { code: scenario === 'unknown' ? 'fixture_unknown' : 'server_error', message: errorDetail },
    } }]
  }
  if (scenario === 'content_filter' || scenario === 'max_output_tokens') {
    return [{ type: 'response.incomplete', response: {
      ...response, status: 'incomplete', incomplete_details: { reason: scenario },
    } }]
  }
  return [{ type: 'response.completed', response: { ...response, status: 'completed' } }]
}

function history(label: string): AgentMessage[] {
  const messages: AgentMessage[] = []
  for (let index = 0; index < 4; index += 1) {
    messages.push(compactionTestUser(`${label}用户` + 'a'.repeat(20000)))
    messages.push({
      ...compactionTestAssistant(`${label}回复` + 'b'.repeat(20000), index === 3 ? 50702 : 0),
      api: model.api,
    })
  }
  messages.push(compactionTestUser('继续'))
  return messages
}

function totalUsage(usages: Array<{ total_tokens: number }>) {
  return usages.reduce((total, usage) => total + usage.total_tokens, 0)
}
