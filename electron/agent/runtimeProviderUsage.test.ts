import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateContextTokens } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Tool } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createRestrictedProviderFetch, createRuntimeModel, createRuntimeStreamFunction, hydrateRuntimeMessages } from './piAgentAdapter.ts'
import { compactionTestAssistant, compactionTestModel, createCompactionTestHarness } from './runtimeCompactionTestFixture.ts'
import {
  hasValidRuntimeProviderTokens,
  isRuntimeProviderUsage,
  restoreRuntimeProviderUsage,
  runtimeContextFingerprint,
  runtimeProviderUsage,
  type RuntimeProviderUsage,
} from './runtimeProviderUsage.ts'
import { runtimeCompactionEstimate } from './runtimeCompactionPolicy.ts'
import { WorkerCoreClient, type RuntimeBootstrap, type RuntimeMessagePart, type RuntimeMessageView } from './workerCoreClient.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'

const fingerprint = 'a'.repeat(64)
const knownUsage: RuntimeProviderUsage = {
  last_part_id: 'part_5', context_fingerprint: fingerprint,
  input_tokens: 100, output_tokens: 10, cache_read_tokens: 40, cache_write_tokens: 20, total_tokens: 190,
}

test('保留单次 Provider 缓存字段并优先使用 total，不将历史用量再次计费', () => {
  const message = { ...compactionTestAssistant('有效回复'), usage: restoreRuntimeProviderUsage(knownUsage) }
  const value = runtimeProviderUsage(message, 'part_5', fingerprint)
  assert.deepEqual(value, knownUsage)
  assert.equal(estimateContextTokens([message]).tokens, 190)
  assert.deepEqual(message.usage.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

  const withoutTotal = { ...knownUsage, total_tokens: 0 }
  assert.equal(isRuntimeProviderUsage(withoutTotal), true)
  const restored = restoreRuntimeProviderUsage(withoutTotal)
  assert.equal(restored.totalTokens, 0)
  assert.equal(estimateContextTokens([{ ...message, usage: restored }]).tokens, 170)
})

test('错误、取消、零用量及缺少本次尾 part 时不能生成用量锚点', () => {
  const message = { ...compactionTestAssistant('有效回复'), usage: restoreRuntimeProviderUsage(knownUsage) }
  for (const stopReason of ['stop', 'toolUse', 'length'] as const) {
    assert.ok(runtimeProviderUsage({ ...message, stopReason }, 'part_5', fingerprint))
  }
  for (const stopReason of ['error', 'aborted'] as const) {
    assert.equal(runtimeProviderUsage({ ...message, stopReason }, 'part_5', fingerprint), undefined)
  }
  assert.equal(runtimeProviderUsage(message, undefined, fingerprint), undefined)
  assert.equal(runtimeProviderUsage(message, '', fingerprint), undefined)
  assert.equal(runtimeProviderUsage(compactionTestAssistant('没有用量'), 'part_5', fingerprint), undefined)
  assert.equal(runtimeProviderUsage(message, 'part_5', 'invalid-fingerprint'), undefined)
})

test('用量校验拒绝无效身份、负数、小数、非有限值和不安全整数', () => {
  for (const patch of [
    { last_part_id: '' }, { last_part_id: 'x'.repeat(129) }, { last_part_id: 1 },
    { context_fingerprint: 'f'.repeat(63) }, { context_fingerprint: 'A'.repeat(64) }, { context_fingerprint: null },
  ]) {
    assert.equal(isRuntimeProviderUsage({ ...knownUsage, ...patch }), false)
  }
  for (const field of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens']) {
    for (const invalid of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '1']) {
      assert.equal(isRuntimeProviderUsage({ ...knownUsage, [field]: invalid }), false, `${field}: ${String(invalid)}`)
    }
  }
  assert.equal(isRuntimeProviderUsage({
    ...knownUsage, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0,
  }), false)
  assert.equal(isRuntimeProviderUsage({
    ...knownUsage, total_tokens: 0, input_tokens: Number.MAX_SAFE_INTEGER,
  }), false)
})

test('原生用量异常时回退前一个有效基准和增量，全部失效时保留纯估算', () => {
  const bootstrap = historyBootstrap()
  const model = createRuntimeModel(bootstrap)
  const raw = hydrateRuntimeMessages(bootstrap, model, fingerprint)
  const base = { ...compactionTestAssistant('正常回复'), model: model.id, provider: model.provider, api: model.api }
  const valid = restoreRuntimeProviderUsage(knownUsage)
  assert.equal(hasValidRuntimeProviderTokens(valid), true)
  assert.equal(hasValidRuntimeProviderTokens({ ...valid, totalTokens: 0 }), true)
  assert.equal(hasValidRuntimeProviderTokens({ ...valid, input: Number.MAX_SAFE_INTEGER, totalTokens: 1 }), true)
  for (const value of [undefined, null, [], 'invalid']) assert.equal(hasValidRuntimeProviderTokens(value), false)

  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) {
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '70000', undefined]) {
      const message = { ...base, usage: { ...valid, [field]: invalid } }
      const original = structuredClone(message)
      assert.equal(hasValidRuntimeProviderTokens(message.usage), false, `${field}: ${String(invalid)}`)
      assert.equal(runtimeCompactionEstimate([...raw, message], model, 100), 195)
      assert.equal(runtimeCompactionEstimate([raw[raw.length - 1]!, message], model, 100), 102)
      assert.deepEqual(message, original)
    }
  }
  const sumOverflow = { ...base, usage: { ...valid, input: Number.MAX_SAFE_INTEGER, totalTokens: 0 } }
  assert.equal(hasValidRuntimeProviderTokens(sumOverflow.usage), false)
  assert.equal(runtimeCompactionEstimate([...raw, sumOverflow], model, 100), 195)
  for (const stopReason of ['error', 'aborted'] as const) {
    assert.equal(runtimeCompactionEstimate([...raw, { ...base, usage: valid, stopReason }], model, 100), 195)
  }
})

for (const apiMode of ['chat_completions', 'responses'] as const) {
  test(`真实 ${apiMode} SSE 的异常 Token 不能污染消息结束后的窗口占用`, async () => {
    const bootstrap = historyBootstrap()
    bootstrap.model.snapshot.api_mode = apiMode
    const model = createRuntimeModel(bootstrap)
    const raw = hydrateRuntimeMessages(bootstrap, model, fingerprint)
    const providerFetch = createRestrictedProviderFetch(model.baseUrl, true, async () => fractionalUsageResponse(apiMode))
    const stream = await createRuntimeStreamFunction(undefined, providerFetch)(model,
      { systemPrompt: '', tools: [], messages: [{ role: 'user', content: '新的输入', timestamp: 1 }] }, {})
    const message = await stream.result()
    assert.equal(message.stopReason, 'stop')
    assert.equal(message.usage.totalTokens, 70010.5)
    assert.equal(runtimeProviderUsage(message, 'agp_fractional', fingerprint), undefined)
    const harness = createCompactionTestHarness({ model, systemPrompt: '系统提示' })
    await harness.controller.observeContext([...raw, message])
    assert.equal(harness.contexts[harness.contexts.length - 1]!.estimated_tokens, 195)
    assert.ok(harness.contexts.every((value) => Number.isSafeInteger(value.estimated_tokens)))
    assert.equal(harness.requests.length, 0)
    assert.equal(harness.controller.failure(), undefined)
    const projected = await harness.controller.transformContext([...raw, message])
    harness.controller.beforeProviderRequest()
    assert.equal(runtimeCompactionEstimate(projected, model, 1), 195)
    assert.equal(message.usage.totalTokens, 70010.5)

    const uncalibrated = createCompactionTestHarness({ model, systemPrompt: '系统提示' })
    await uncalibrated.controller.observeContext([raw[raw.length - 1]!, message])
    assert.equal(uncalibrated.contexts[0]!.estimated_tokens, 3)
  })
}

test('上下文指纹不受对象键及工具顺序影响，且不改写调用者对象', () => {
  const tools = fingerprintTools()
  const original = structuredClone(tools)
  const first = runtimeContextFingerprint(compactionTestModel, '系统约束', tools, 'provider-1', 'model-1')
  const reordered = reverseObjectKeys([...tools].reverse()) as Tool[]
  assert.equal(runtimeContextFingerprint(compactionTestModel, '系统约束', reordered, 'provider-1', 'model-1'), first)
  assert.match(first, /^[a-f0-9]{64}$/u)
  assert.deepEqual(tools, original)
})

test('模型与固定上下文变化使指纹失效，输出预算和展示名不会误失效', () => {
  const tools = fingerprintTools()
  const signature = (model = compactionTestModel, prompt = '系统约束', entries = tools, providerID = 'provider-1', modelID = 'model-1') =>
    runtimeContextFingerprint(model, prompt, entries, providerID, modelID)
  const first = signature()
  for (const changed of [
    runtimeContextFingerprint({ ...compactionTestModel, api: 'openai-responses' }, '系统约束', tools, 'provider-1', 'model-1'),
    signature({ ...compactionTestModel, id: 'other-remote-model' }),
    signature({ ...compactionTestModel, baseUrl: 'https://other.fixture/v1' }),
    signature({ ...compactionTestModel, contextWindow: compactionTestModel.contextWindow * 2 }),
    signature(undefined, '新的资源绑定'),
    signature(undefined, undefined, [{ ...tools[0]!, description: '改变工具约束' }, tools[1]!]),
    signature(undefined, undefined, undefined, 'provider-2'),
    signature(undefined, undefined, undefined, undefined, 'model-2'),
  ]) assert.notEqual(changed, first)
  assert.equal(signature({ ...compactionTestModel, maxTokens: 2048, name: '新展示名' }), first)
})

test('同一 assistant 的多段历史仅精确恢复尾 part 锚点，工具结果和 steer 增量补计一次', () => {
  const bootstrap = historyBootstrap()
  const model = createRuntimeModel(bootstrap)
  const messages = hydrateRuntimeMessages(bootstrap, model, fingerprint)
  assert.deepEqual(messages.map(({ role }) => role), ['user', 'assistant', 'toolResult', 'assistant', 'toolResult', 'user', 'user'])
  const assistants = messages.filter((message): message is AssistantMessage => message.role === 'assistant')
  assert.equal(assistants.length, 2)
  assert.equal(assistants[0]!.usage.totalTokens, 0)
  assert.equal(assistants[1]!.usage.totalTokens, 190)
  const estimate = estimateContextTokens(messages)
  assert.equal(estimate.lastUsageIndex, 3)
  // 第二个结果 4 字符、追加指令 8 字符、新输入 4 字符；第一个工具结果已包含在 Provider 基准中。
  assert.equal(estimate.tokens, 190 + 1 + 2 + 1)
  const toolResults = messages.filter((message) => message.role === 'toolResult')
  assert.deepEqual(toolResults.map(({ toolCallId }) => toolCallId), ['call-1', 'call-2'])
  assert.ok(toolResults.every((message) => !message.isError))
})

test('指纹不匹配、未提供指纹或锚点不是该段尾部时不复用历史 usage', () => {
  for (const suppliedFingerprint of ['b'.repeat(64), undefined]) {
    const bootstrap = historyBootstrap()
    const messages = hydrateRuntimeMessages(bootstrap, createRuntimeModel(bootstrap), suppliedFingerprint)
    assert.equal(estimateContextTokens(messages).lastUsageIndex, null)
  }
  const bootstrap = historyBootstrap()
  bootstrap.messages[1]!.provider_usage = { ...knownUsage, last_part_id: 'part_4' }
  const messages = hydrateRuntimeMessages(bootstrap, createRuntimeModel(bootstrap), fingerprint)
  assert.equal(estimateContextTokens(messages).lastUsageIndex, null)
})

test('较晚 Run 的指纹失配使更早匹配的用量基准失效，不跨变化边界回溯', () => {
  const bootstrap = historyBootstrap()
  bootstrap.messages = [
    userMessage('agm_first', 1, '首次输入'),
    anchoredAssistant('agm_old', 2, fingerprint, 190),
    userMessage('agm_middle', 3, '中间输入'),
    anchoredAssistant('agm_changed', 4, 'b'.repeat(64), 250),
    userMessage('agm_new', 5, '新的输入'),
  ]
  const original = structuredClone(bootstrap.messages)
  const messages = hydrateRuntimeMessages(bootstrap, createRuntimeModel(bootstrap), fingerprint)
  assert.equal(estimateContextTokens(messages).lastUsageIndex, null)
  assert.ok(messages.filter((message) => message.role === 'assistant').every((message) => message.usage.totalTokens === 0))
  assert.deepEqual(bootstrap.messages, original)
})

test('指纹失配之后的新匹配锚点可恢复，后续输入继续按 pi 增量估算', () => {
  const bootstrap = historyBootstrap()
  bootstrap.messages = [
    userMessage('agm_first', 1, '首次输入'),
    anchoredAssistant('agm_old', 2, fingerprint, 190),
    userMessage('agm_middle', 3, '中间输入'),
    anchoredAssistant('agm_changed', 4, 'b'.repeat(64), 250),
    userMessage('agm_return', 5, '恢复输入'),
    anchoredAssistant('agm_fresh', 6, fingerprint, 300),
    userMessage('agm_new', 7, '新的输入'),
  ]
  const messages = hydrateRuntimeMessages(bootstrap, createRuntimeModel(bootstrap), fingerprint)
  assert.deepEqual(messages.filter((message) => message.role === 'assistant').map((message) => message.usage.totalTokens), [0, 0, 300])
  assert.equal(estimateContextTokens(messages).lastUsageIndex, 5)
  assert.equal(estimateContextTokens(messages).tokens, 301)
})

test('恢复真实用量后新输入越过默认 80% 门禁，首次主请求前完成官方压缩', async () => {
  const bootstrap = historyBootstrap()
  const oldText = '历史正文'.repeat(1000)
  const newText = '本轮新输入：' + '新'.repeat(50000)
  bootstrap.messages = [
    userMessage('agm_first', 1, oldText),
    anchoredAssistant('agm_old', 2, fingerprint, 70000),
    userMessage('agm_new', 3, newText),
  ]
  const model = createRuntimeModel(bootstrap)
  const raw = hydrateRuntimeMessages(bootstrap, model, fingerprint)
  const original = structuredClone(raw)
  const triggerTokens = Math.min(Math.floor(model.contextWindow * 0.8), model.contextWindow - model.maxTokens)
  assert.equal(estimateContextTokens(raw.slice(0, -1)).tokens, 70000)
  assert.ok(70000 < triggerTokens)
  assert.ok(estimateContextTokens(raw).tokens > triggerTokens)

  const harness = createCompactionTestHarness({ model })
  const projected = await harness.controller.transformContext(raw)
  harness.controller.beforeProviderRequest()
  harness.order.push('provider')

  assert.equal(harness.requests.length, 1)
  assert.equal(harness.commits.length, 1)
  assert.deepEqual(harness.order, ['capture', 'started', 'summary', 'commit', 'completed', 'provider'])
  assert.equal(harness.commits[0]!.tokensBefore, estimateContextTokens(raw).tokens)
  assert.ok(harness.commits[0]!.tokensAfter < triggerTokens)
  assert.equal(estimateContextTokens(projected).lastUsageIndex, null)
  assert.ok(estimateContextTokens(projected).tokens < triggerTokens)
  assert.ok(JSON.stringify(harness.requests[0]!.context).includes(oldText))
  assert.match(JSON.stringify(projected[0]), /继续原任务/u)
  assert.deepEqual(projected[projected.length - 1], raw[raw.length - 1])
  assert.deepEqual(raw, original)
})

test('checkpoint 保留尾部的旧 usage 在活动上下文投影中失效，不误触发新一轮压缩', async () => {
  const bootstrap = historyBootstrap()
  const model = createRuntimeModel(bootstrap)
  const retained = { ...compactionTestAssistant('保留原文', 200000), model: model.id, provider: model.provider, api: model.api }
  const checkpoint = {
    id: 'agc_previous', version: 2 as const, boundary_message_sequence: 1,
    run_id: 'agr_previous', generation: 1, covered_event_sequence: 5,
    summary: '已整理的历史', estimated_tokens: 1000, retained_tail: [retained], image_sources: [],
  }
  bootstrap.context.checkpoint = checkpoint
  bootstrap.messages = [userMessage('agm_new', 4, '新输入值')]
  const raw = hydrateRuntimeMessages(bootstrap, model, fingerprint)
  const harness = createCompactionTestHarness({
    model,
    initialCheckpoint: {
      summary: checkpoint.summary, retainedTail: checkpoint.retained_tail,
      coveredRawLength: 2, tokensBefore: checkpoint.estimated_tokens, timestamp: 0,
    },
  })
  const projected = await harness.controller.transformContext(raw)
  harness.controller.beforeProviderRequest()
  assert.equal(estimateContextTokens(projected).lastUsageIndex, null)
  assert.ok(estimateContextTokens(projected).tokens < 1000)
  assert.equal(harness.requests.length, 0)
  assert.equal(retained.usage.totalTokens, 200000)
})

test('Worker bootstrap 接受合法锚点，拒绝跨段尾部、用户消息及工具结果上的锚点', async () => {
  const accepted = await readBootstrap(historyBootstrap())
  assert.deepEqual(accepted.messages[1]!.provider_usage, knownUsage)
  for (const mutate of [
    (value: RuntimeBootstrap) => { value.messages[1]!.provider_usage!.last_part_id = 'part_4' },
    (value: RuntimeBootstrap) => { value.messages[1]!.provider_usage!.input_tokens = -1 },
    (value: RuntimeBootstrap) => { value.messages[0]!.provider_usage = { ...knownUsage, last_part_id: 'agm_first_text' } },
    (value: RuntimeBootstrap) => { value.messages[2]!.provider_usage = { ...knownUsage, last_part_id: 'part_6' } },
  ]) {
    const bootstrap = historyBootstrap()
    mutate(bootstrap)
    await assert.rejects(readBootstrap(bootstrap), /AGENT_RUNTIME_BOOTSTRAP_INVALID/u)
  }
})

function fingerprintTools(): Tool[] {
  return [
    { name: 'second', description: '第二项工具', parameters: Type.Object({ path: Type.String(), count: Type.Number() }) },
    { name: 'first', description: '第一项工具', parameters: Type.Object({ nested: Type.Object({ active: Type.Boolean() }) }) },
  ]
}

function fractionalUsageResponse(apiMode: RuntimeBootstrap['model']['snapshot']['api_mode']) {
  if (apiMode === 'chat_completions') {
    const chunk = {
      id: 'chat_fractional', object: 'chat.completion.chunk', created: 1, model: 'test-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: '正常回复' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 70000.5, completion_tokens: 10, total_tokens: 70010.5 },
    }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  const events = [
    { type: 'response.created', response: { id: 'resp_fractional' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_fractional', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '正常回复' },
    { type: 'response.completed', response: { status: 'completed', usage: {
      input_tokens: 70000.5, output_tokens: 10, total_tokens: 70010.5,
    } } },
  ]
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]))
  }
  return value
}

function historyBootstrap(): RuntimeBootstrap {
  return {
    core_instance_id: 'core_fixture',
    run: {
      id: 'agr_current', session_id: 'ags_fixture', generation: 2, event_sequence: 1, status: 'starting',
      assistant_message_id: 'agm_current', provider_id: 'provider-1', model_id: 'model-1', reasoning_level: 'off',
    },
    session: { id: 'ags_fixture' }, runtime_bearer: 'r'.repeat(48),
    mcp: { endpoint: '/mcp', bearer_token: 'm'.repeat(48), protocol_version: '2025-11-25' },
    model: { snapshot: {
      api_mode: 'chat_completions', base_url: compactionTestModel.baseUrl, model_id: compactionTestModel.id,
      provider_id: 'provider-1', provider_name: '测试 Provider', model_display_name: '测试模型',
      provider_revision: 1, model_revision: 1, context_window_tokens: 101072, max_output_tokens: 4096,
      supports_images: false, reasoning_control: 'none', supported_reasoning_levels: ['off'],
    } },
    context: { estimated_tokens: 190, warning: false },
    messages: [
      userMessage('agm_first', 1, '开始任务'),
      {
        id: 'agm_history', role: 'assistant', status: 'completed', sequence: 2, created_at: '2026-09-05T00:00:00Z',
        attachments: [], provider_usage: { ...knownUsage },
        parts: [
          part('text', 1, { text: { text: '前文说明' } }),
          toolCall(2, 'call-1'),
          toolResult(3, 'call-1', '此前工具結果'.repeat(50)),
          part('text', 4, { text: { text: '继续处理' } }),
          toolCall(5, 'call-2'),
        ],
      },
      {
        id: 'agm_history', role: 'assistant', status: 'completed', sequence: 2, created_at: '2026-09-05T00:00:00Z',
        attachments: [], parts: [toolResult(6, 'call-2', '1234')],
      },
      userMessage('agm_steer', 3, '新增指令1234'),
      userMessage('agm_new', 4, '新的输入'),
    ],
  }
}

function userMessage(id: string, sequence: number, text: string): RuntimeMessageView {
  return {
    id, role: 'user', status: 'completed', sequence, created_at: '2026-09-05T00:00:00Z', attachments: [],
    parts: [{ id: `${id}_text`, message_id: id, kind: 'text', sequence: 1, content: { text: { text } } }],
  }
}

function anchoredAssistant(id: string, sequence: number, contextFingerprint: string, totalTokens: number): RuntimeMessageView {
  return {
    ...userMessage(id, sequence, '有效回复'),
    role: 'assistant',
    provider_usage: {
      ...knownUsage, last_part_id: `${id}_text`, context_fingerprint: contextFingerprint, total_tokens: totalTokens,
    },
  }
}

function part(kind: RuntimeMessagePart['kind'], sequence: number, content: Record<string, unknown>): RuntimeMessagePart {
  return { id: `part_${sequence}`, message_id: 'agm_history', kind, sequence, content }
}

function toolCall(sequence: number, id: string) {
  return part('tool_call', sequence, { tool_call: { tool_call_id: id, tool_name: 'termous.hosts.list', arguments: {} } })
}

function toolResult(sequence: number, id: string, text: string) {
  return part('tool_result', sequence, { tool_result: {
    tool_call_id: id, tool_name: 'termous.hosts.list', content: [{ type: 'text', text }], is_error: false,
  } })
}

async function readBootstrap(value: RuntimeBootstrap) {
  const client = new WorkerCoreClient({ fetch: async () => Response.json(value) })
  return client.bootstrap({
    type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:18192',
    ticket: 't'.repeat(48), run_id: 'agr_current', generation: 2, skills: testAgentSkillBundle(),
  })
}
