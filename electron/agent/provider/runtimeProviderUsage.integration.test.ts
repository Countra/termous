import { withToolDiscovery } from '../test-support/runtimeDiscoveryTestFixture.ts'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent, type CreatePiAgentOptions } from '../runtime/piAgentAdapter.ts'
import { createRuntimeSystemPrompt } from '../runtime/runtimeSystemPrompt.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import type { RuntimeCompactionContextUsage } from '../context/compaction/runtimeCompaction.ts'
import type { RuntimeProviderUsage } from '../contracts/providerUsageContract.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { compactionTestAssistant } from '../test-support/runtimeCompactionTestFixture.ts'
import { WorkerCoreClient } from '../worker/workerCoreClient.ts'
import { type RuntimeBootstrap, type RuntimeMessagePart } from '../contracts/runtimeBootstrap.ts'
import { type RuntimeEventInput } from '../contracts/runtimeEvents.ts'

for (const apiMode of ['chat_completions', 'responses'] as const) {
  test(`真实 ${apiMode} 跨 Run 恢复 70% 基准，新增输入后不回退字符估算，最终同步 75%`, async () => {
    const bootstrap = usageBootstrap(apiMode)
    const first = await executeFixture(bootstrap, 70_000)
    const firstFinal = first.contexts[first.contexts.length - 1]!
    assert.equal(firstFinal.estimated_tokens, 70_000)
    assert.equal(firstFinal.basis, 'provider_usage')
    assert.equal(first.contexts[0]!.basis, 'pi_estimate')
    assert.ok(firstFinal.provider_usage)
    assert.equal(firstFinal.provider_usage.cache_read_tokens, 60_000)
    const parts = first.events.filter((event) => event.kind === 'message_part')
      .map((event) => event.payload.message_part as RuntimeMessagePart)
    assert.equal(firstFinal.provider_usage.last_part_id, parts[parts.length - 1]!.id)
    const anchorEvent = first.events.find((event) => event.kind === 'context_usage'
      && (event.payload.context_usage as RuntimeCompactionContextUsage).provider_usage)
    assert.ok(anchorEvent!.sequence > first.events.find((event) => event.kind === 'usage')!.sequence)

    const next = structuredClone(bootstrap)
    next.run = { ...next.run, id: 'agr_next', generation: 2, assistant_message_id: 'agm_next_reply' }
    next.messages.push({
      id: bootstrap.run.assistant_message_id, role: 'assistant', status: 'completed', sequence: 2,
      created_at: '2026-09-05T00:00:01Z', parts, attachments: [],
      provider_usage: firstFinal.provider_usage,
    }, {
      id: 'agm_next_user', role: 'user', status: 'completed', sequence: 3,
      created_at: '2026-09-05T00:00:02Z', attachments: [],
      parts: [{ id: 'agp_next_user', message_id: 'agm_next_user', kind: 'text', sequence: 1, content: { text: { text: '继续检查' } } }],
    })
    const second = await executeFixture(next, 75_000)
    assert.ok(second.contexts[0]!.estimated_tokens >= 70_000)
    assert.ok(second.contexts[0]!.estimated_tokens < 70_100)
    assert.equal(second.contexts[0]!.basis, 'provider_usage')
    assert.equal(second.contexts[0]!.provider_usage, undefined)
    assert.equal(second.contexts[second.contexts.length - 1]!.estimated_tokens, 75_000)
    assert.equal(second.requests, 1)
    assert.equal(second.events.some((event) => event.kind === 'compaction'), false)
    const billed = second.events.filter((event) => event.kind === 'usage').map((event) => event.payload.usage as { total_tokens: number })
    assert.equal(billed[billed.length - 1]!.total_tokens, 75_000)
  })
}

test('bootstrap 拒绝不可恢复的单次用量，不把用户或工具结果当作 Provider 基准', async () => {
  const valid = usageBootstrap('chat_completions')
  const usage: RuntimeProviderUsage = {
    last_part_id: 'agp_reply', input_tokens: 100, output_tokens: 10,
    cache_read_tokens: 20, cache_write_tokens: 0, total_tokens: 130,
    context_fingerprint: 'a'.repeat(64),
  }
  valid.messages.push({
    id: 'agm_previous', role: 'assistant', status: 'completed', sequence: 2,
    created_at: '2026-09-05T00:00:01Z', attachments: [], provider_usage: usage,
    parts: [{ id: 'agp_reply', message_id: 'agm_previous', kind: 'text', sequence: 1, content: { text: { text: '完成' } } }],
  })
  for (const mutate of [
    (value: RuntimeBootstrap) => { value.messages[1]!.role = 'user' },
    (value: RuntimeBootstrap) => { value.messages[1]!.parts[0]!.kind = 'tool_result' },
    (value: RuntimeBootstrap) => { value.messages[1]!.provider_usage!.last_part_id = 'agp_missing' },
    (value: RuntimeBootstrap) => { value.messages[1]!.provider_usage!.input_tokens = -1 },
    (value: RuntimeBootstrap) => { value.messages[1]!.provider_usage!.context_fingerprint = 'invalid' },
  ]) {
    const invalid = structuredClone(valid)
    mutate(invalid)
    const client = new WorkerCoreClient({ fetch: async () => Response.json(invalid) })
    await assert.rejects(client.bootstrap(fixtureStart(invalid)), /AGENT_RUNTIME_BOOTSTRAP_INVALID/u)
  }
})

test('旧 Core 未声明支持时只发送已有占用字段，仍在最终回复后更新数据', async () => {
  const bootstrap = usageBootstrap('chat_completions')
  delete bootstrap.context.provider_usage_supported
  delete bootstrap.context.context_assessment_supported
  const result = await executeFixture(bootstrap, 70_000)
  assert.equal(result.contexts[result.contexts.length - 1]!.estimated_tokens, 70_000)
  assert.ok(result.contexts.every((usage) => usage.provider_usage === undefined))
  assert.ok(result.contexts.every((usage) => usage.basis === undefined && usage.compression_status === undefined))
})

test('只支持用量恢复的 Core 不接收新评估字段，非法能力声明被拒绝', async () => {
  const bootstrap = usageBootstrap('chat_completions')
  delete bootstrap.context.context_assessment_supported
  const result = await executeFixture(bootstrap, 70_000)
  assert.ok(result.contexts[result.contexts.length - 1]!.provider_usage)
  assert.ok(result.contexts.every((usage) => usage.basis === undefined && usage.compression_status === undefined))
  const invalid = { ...bootstrap, context: { ...bootstrap.context, context_assessment_supported: 'true' } }
  const client = new WorkerCoreClient({ fetch: async () => Response.json(invalid) })
  await assert.rejects(client.bootstrap(fixtureStart(bootstrap)), /AGENT_RUNTIME_BOOTSTRAP_INVALID/u)
})

test('用量观察不打断未执行工具，工具结果越过阈值后在下一主请求前压缩', async () => {
  const bootstrap = usageBootstrap('chat_completions')
  bootstrap.messages[0]!.sequence = 3
  bootstrap.messages.unshift({
    id: 'agm_history_user', role: 'user', status: 'completed', sequence: 1, created_at: '2026-09-04T00:00:00Z', attachments: [],
    parts: [{ id: 'agp_history_user', message_id: 'agm_history_user', kind: 'text', sequence: 1,
      content: { text: { text: 'old-input-'.repeat(3000) } } }],
  }, {
    id: 'agm_history_reply', role: 'assistant', status: 'completed', sequence: 2, created_at: '2026-09-04T00:00:01Z', attachments: [],
    parts: [{ id: 'agp_history_reply', message_id: 'agm_history_reply', kind: 'text', sequence: 1,
      content: { text: { text: 'old-answer-'.repeat(3000) } } }],
  })
  const toolName = encodeMCPToolName('termous.fixture.read')
  const toolResult = 'result-'.repeat(9000)
  const order: string[] = []
  let mainRequests = 0
  const result = await executeFixture(bootstrap, 75_000, {
    mcp: {
      originalName: (name) => name === toolName ? 'termous.fixture.read' : null,
      close: async () => {},
      tools: [{ name: toolName, label: '读取测试数据', description: '仅读取内存测试数据', parameters: Type.Object({}),
        execute: async () => { order.push('tool'); return { content: [{ type: 'text', text: toolResult }], details: {} } } }],
    },
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { tools?: unknown[]; messages: Array<{ role: string; content: unknown }> }
      if (!body.tools?.length) {
        assert.equal(order[order.length - 1], 'tool')
        const system = body.messages.filter((message) => message.role === 'system')
        assert.equal(system.length, 1)
        assert.match(JSON.stringify(system), /不得执行，也不得调用任何工具/u)
        assert.doesNotMatch(JSON.stringify(body), /你是 Termous 内置 AI 助手/u)
        order.push('summary')
        return providerResponse('chat_completions', 2000)
      }
      const system = body.messages.filter((message) => message.role === 'system')
      assert.equal(system.length, 1)
      assert.equal(system[0]!.content, createRuntimeSystemPrompt(bootstrap, testAgentSkillBundle()))
      assert.match(JSON.stringify(body.tools), new RegExp(toolName, 'u'))
      mainRequests += 1
      order.push(`provider-${mainRequests}`)
      if (mainRequests > 1) {
        assert.equal(order[order.length - 2], 'checkpoint')
        assert.ok(body.messages.some((message) => message.role === 'tool' && JSON.stringify(message.content).includes(toolResult)))
        return providerResponse('chat_completions', 75_000)
      }
      const chunk = {
        id: 'chatcmpl_tool', object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [
          { index: 0, id: 'call_read', type: 'function', function: { name: toolName, arguments: '{}' } },
        ] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 69_990, completion_tokens: 10, total_tokens: 70_000 },
      }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    },
    commitCheckpoint: async (input) => {
      assert.ok(input.retained_tail.every((message) => (message as AgentMessage).role !== 'system'))
      assert.doesNotMatch(JSON.stringify(input.retained_tail), /你是 Termous 内置 AI 助手/u)
      assert.equal(/TERMOUS_EXECUTION_STATE|当前能力说明/u.test(JSON.stringify(input.retained_tail)), false)
      order.push('checkpoint')
      return { last_sequence: input.sequence, checkpoint: {
        id: input.compaction_id, version: 2, boundary_message_sequence: 1, summary: input.summary,
        run_id: bootstrap.run.id, generation: bootstrap.run.generation, covered_event_sequence: input.covered_event_sequence,
        estimated_tokens: input.tokens_after, retained_tail: input.retained_tail as AgentMessage[], image_sources: [],
      } }
    },
  })
  assert.deepEqual(order, ['provider-1', 'tool', 'summary', 'checkpoint', 'provider-2'])
  const anchors = result.events.filter((event) => event.kind === 'context_usage'
    && (event.payload.context_usage as RuntimeCompactionContextUsage).provider_usage)
  assert.equal(anchors.length, 2)
  for (const anchor of anchors) {
    const usage = (anchor.payload.context_usage as RuntimeCompactionContextUsage).provider_usage!
    const tail = result.events.find((event) => event.sequence === anchor.sequence - 2)
    assert.equal((tail!.payload.message_part as RuntimeMessagePart).id, usage.last_part_id)
    assert.equal(result.events.find((event) => event.sequence === anchor.sequence - 1)!.kind, 'usage')
  }
})

test('失败正文保留历史但不提高即时上下文占用，终态仍使用请求前有效内容', async () => {
  const bootstrap = usageBootstrap('responses')
  const result = await executeFixture(bootstrap, 0, {
    fetch: async () => {
      const events = [
        { type: 'response.created', response: { id: 'resp_failed' } },
        { type: 'response.output_item.added', output_index: 0,
          item: { type: 'message', id: 'msg_failed', role: 'assistant', content: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '未完成内容'.repeat(2000) },
        { type: 'response.incomplete', response: { status: 'incomplete',
          incomplete_details: { reason: 'content_filter' }, usage: { input_tokens: 90000, output_tokens: 1000, total_tokens: 91000 } } },
      ]
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } })
    },
  }, 'failed')
  const initial = result.contexts[0]!
  const final = result.contexts[result.contexts.length - 1]!
  assert.equal(final.estimated_tokens, initial.estimated_tokens)
  assert.equal(final.provider_usage, undefined)
  assert.equal(final.basis, 'pi_estimate')
  const part = result.events.find((event) => event.kind === 'message_part')!.payload.message_part as RuntimeMessagePart
  assert.ok(part.content.response_failure)
  assert.ok(JSON.stringify(part.content).includes('未完成内容'))
  const usages = result.events.filter((event) => event.kind === 'usage')
  const usage = usages[usages.length - 1]!.payload.usage as { total_tokens: number }
  assert.equal(usage.total_tokens, 91000)
})

test('成功工具轮之后无 start 的请求失败，不把上一轮正文误标为失败或重复保存', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const bootstrap = usageBootstrap('chat_completions')
  const toolName = encodeMCPToolName('termous.fixture.inspect')
  let requests = 0
  let tools = 0
  const task = executeFixture(bootstrap, 0, {
    mcp: { originalName: (name) => name === toolName ? 'termous.fixture.inspect' : null, close: async () => {},
      tools: [{ name: toolName, label: '检查', description: '内存夹具', parameters: Type.Object({}),
        execute: async () => { tools += 1; return { content: [{ type: 'text', text: '已执行结果' }], details: {} } } }] },
    fetch: async () => {
      requests += 1
      if (requests === 2) return Response.json({ error: { message: '503 Service unavailable' } }, { status: 503 })
      if (requests === 3) return providerResponse('chat_completions', 100)
      assert.equal(requests, 1)
      const chunk = { id: 'tool_start', object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: { content: '这段是成功工具轮的正文', tool_calls: [
          { index: 0, id: 'call_inspect', type: 'function', function: { name: toolName, arguments: '{}' } },
        ] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  for (let wait = 0; wait < 30 && requests < 2; wait++) await setImmediate()
  await setImmediate()
  assert.equal(requests, 2)
  t.mock.timers.tick(3000)
  const result = await task
  assert.equal(requests, 3)
  assert.equal(tools, 1)
  const parts = result.events.filter((event) => event.kind === 'message_part')
    .map((event) => event.payload.message_part as RuntimeMessagePart)
  assert.ok(parts.every((part) => part.content.response_failure === undefined))
  assert.equal(parts.filter((part) => JSON.stringify(part.content).includes('这段是成功工具轮的正文')).length, 1)
  const retries = result.events.filter((event) => event.kind === 'retry').map((event) => event.payload.retry as { after_part_sequence: number })
  assert.equal(retries.length, 3)
  assert.equal(new Set(retries.map((retry) => retry.after_part_sequence)).size, 1)
})

test('连续工具轮更新执行摘要不累积副本、不重复叠加 Provider 用量', async () => {
  const bootstrap = usageBootstrap('chat_completions')
  bootstrap.context.progress_supported = true
  const original = 'termous.fixture.inspect'
  const toolName = encodeMCPToolName(original)
  let requests = 0
  const result = await executeFixture(bootstrap, 70000, {
    mcp: { originalName: (name) => name === toolName ? original : null, close: async () => {},
      tools: [{ name: toolName, label: '检查', description: '内存夹具', parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'text', text: '{"status":"ready"}' }],
          details: { kind: 'mcp', originalToolName: original, readOnly: true, result: { content: [], structuredContent: { status: 'ready' } } } }) }] },
    fetch: async (_url, init) => {
      requests++
      if (requests > 1) assert.equal((String(init?.body).match(/\[TERMOUS_EXECUTION_STATE\]/gu) ?? []).length, 1)
      if (requests === 7) return providerResponse('chat_completions', 70000)
      const chunk = { id: `chat_${requests}`, object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${requests}`, type: 'function', function: { name: toolName, arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 69990, completion_tokens: 10, total_tokens: 70000, prompt_tokens_details: { cached_tokens: 60000 } } }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  assert.equal(requests, 7)
  const calibrated = result.contexts.filter((context) => context.basis === 'provider_usage')
  assert.ok(calibrated.length >= 7)
  assert.ok(calibrated.every((context) => context.estimated_tokens >= 69500 && context.estimated_tokens < 71000))
  assert.equal(result.events.some((event) => event.kind === 'compaction'), false)
})

test('旧检查点缺少执行状态时，从保留工具回执重建当前诊断', async () => {
  const bootstrap = usageBootstrap('chat_completions')
  const name = encodeMCPToolName('termous.desktops.capture')
  const retained: AgentMessage[] = []
  for (let index = 1; index <= 3; index++) {
    retained.push({ ...compactionTestAssistant(''), stopReason: 'toolUse', content: [
      { type: 'toolCall', id: `old-${index}`, name, arguments: { attachment_id: 'historical' } },
    ] }, { role: 'toolResult', toolCallId: `old-${index}`, toolName: name, isError: false, timestamp: index,
      content: [{ type: 'text', text: JSON.stringify({ capture: { screenshot_id: `old-${index}`, metadata: { connection_generation: 1 } } }) }] })
  }
  bootstrap.context.checkpoint = { id: 'agc_previous', version: 2, boundary_message_sequence: 1,
    summary: '此前只取得普通截图，尚未创建固定快照。', estimated_tokens: 100,
    retained_tail: retained, image_sources: [], run_id: 'agr_previous', generation: 1, covered_event_sequence: 0 }
  let requests = 0
  await executeFixture(bootstrap, 1000, { fetch: async (_input, init) => {
    requests++
    const body = String(init?.body)
    assert.equal((body.match(/\[TERMOUS_EXECUTION_STATE\]/gu) ?? []).length, 1)
    assert.match(body, /repeated_observation/u)
    assert.match(body, /不恢复历史授权/u)
    return providerResponse('chat_completions', 1000)
  } })
  assert.equal(requests, 1)
})

test('连续截图改变图片工作集后丢弃旧 Provider 基准，实际请求只保留最近两帧', async () => {
  const bootstrap = usageBootstrap('chat_completions')
  bootstrap.model.snapshot.supports_images = true
  const original = 'termous.desktops.capture'
  const name = encodeMCPToolName(original)
  let requests = 0
  let captures = 0
  const result = await executeFixture(bootstrap, 70000, {
    mcp: { originalName: (value) => value === name ? original : null, close: async () => {},
      tools: [{ name, label: '截图', description: '内存图片夹具', parameters: Type.Object({}), execute: async () => {
        captures++
        const data = { capture: { screenshot_id: `shot-${captures}`, metadata: { connection_generation: 1 } } }
        return { content: [{ type: 'text', text: JSON.stringify(data) },
          { type: 'image', mimeType: 'image/png', data: Buffer.from(`image-fixture-${captures}`).toString('base64') }],
          details: { kind: 'mcp', originalToolName: original, readOnly: true, result: { content: [], structuredContent: data } } }
      } }] },
    fetch: async (_input, init) => {
      requests++
      assert.equal((String(init?.body).match(/"type":"image_url"/gu) ?? []).length, Math.min(captures, 2))
      if (captures === 3) {
        assert.match(String(init?.body), /history_image/u)
        return providerResponse('chat_completions', 70000)
      }
      const chunk = { id: `image_${requests}`, object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `capture_${requests}`, type: 'function', function: { name, arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 69990, completion_tokens: 10, total_tokens: 70000 } }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  assert.equal(captures, 3)
  const projections = result.contexts.filter((context) => !context.provider_usage)
  assert.ok(projections.length >= 4)
  assert.ok(projections.every((context) => context.basis === 'pi_estimate' && context.estimated_tokens < 10000))
  assert.equal(result.contexts[result.contexts.length - 1]!.basis, 'provider_usage')
})

async function executeFixture(
  bootstrap: RuntimeBootstrap, tokens: number,
  overrides: Partial<Pick<CreatePiAgentOptions, 'mcp' | 'fetch' | 'commitCheckpoint'>> = {},
  expectedOutcome = 'completed',
) {
  // 经过真实 bootstrap 校验、pi Agent、Provider SSE 与事件写入器，网络和 Core 均由内存替身提供。
  const accepted = await new WorkerCoreClient({ fetch: async () => Response.json(bootstrap) }).bootstrap(fixtureStart(bootstrap))
  const events: RuntimeEventInput[] = []
  const writer = new RuntimeEventWriter({
    start: fixtureStart(bootstrap), runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0,
    onFailure: (error) => { throw error },
    core: {
      bootstrap: async () => bootstrap,
      appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence },
      appendSteer: async () => { throw new Error('不应追加指令') },
      commitCheckpoint: async () => { throw new Error('未到阈值不应压缩') },
    },
  })
  let requests = 0
  const agent = createPiAgent({
    bootstrap: accepted, events: writer, skills: testAgentSkillBundle(),
    mcp: { tools: [], originalName: () => null, close: async () => {} },
    commitCheckpoint: async () => { throw new Error('未到阈值不应压缩') },
    fetch: async () => { requests += 1; return providerResponse(bootstrap.model.snapshot.api_mode, tokens) },
    ...overrides,
    ...(overrides.fetch && overrides.mcp ? { fetch: withToolDiscovery(overrides.fetch, overrides.mcp.tools.map((tool) => tool.name)) } : {}),
  })
  try {
    const outcome = await agent.continue()
    await writer.flush()
    assert.equal(outcome, expectedOutcome, JSON.stringify(events.filter((event) => event.kind === 'error').map((event) => event.payload.error)))
    return { requests, events, contexts: events.filter((event) => event.kind === 'context_usage')
      .map((event) => event.payload.context_usage as RuntimeCompactionContextUsage) }
  } finally {
    agent.close()
    await writer.close()
  }
}

function providerResponse(apiMode: RuntimeBootstrap['model']['snapshot']['api_mode'], tokens: number) {
  if (apiMode === 'chat_completions') {
    const chunk = {
      id: 'chatcmpl_usage', object: 'chat.completion.chunk', created: 1, model: 'test-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: '检查完成' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: tokens - 10, completion_tokens: 10, total_tokens: tokens, prompt_tokens_details: { cached_tokens: Math.min(60_000, tokens - 10) } },
    }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  const events = [
    { type: 'response.created', response: { id: 'resp_usage' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_usage', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '检查完成' },
    { type: 'response.completed', response: { status: 'completed', usage: {
      input_tokens: tokens - 10, output_tokens: 10, total_tokens: tokens, input_tokens_details: { cached_tokens: Math.min(60_000, tokens - 10) },
    } } },
  ]
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function fixtureStart(bootstrap: RuntimeBootstrap) {
  return { type: 'start' as const, protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122',
    ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: bootstrap.run.generation, skills: testAgentSkillBundle() }
}

function usageBootstrap(apiMode: RuntimeBootstrap['model']['snapshot']['api_mode']): RuntimeBootstrap {
  return {
    core_instance_id: 'core-usage',
    run: { id: 'agr_usage', session_id: 'ags_usage', generation: 1, event_sequence: 0, status: 'starting',
      assistant_message_id: 'agm_reply', provider_id: 'amp_provider', model_id: 'apm_model', reasoning_level: 'off' },
    session: { id: 'ags_usage' }, runtime_bearer: 'r'.repeat(48),
    messages: [{ id: 'agm_user', role: 'user', status: 'completed', sequence: 1, created_at: '2026-09-05T00:00:00Z', attachments: [],
      parts: [{ id: 'agp_user', message_id: 'agm_user', kind: 'text', sequence: 1, content: { text: { text: '检查当前状态' } } }] }],
    mcp: { endpoint: '/mcp', bearer_token: 'm'.repeat(48), protocol_version: '2025-11-25' },
    model: { snapshot: { api_mode: apiMode, base_url: 'http://127.0.0.1:18191/v1', model_id: 'test-model',
      provider_id: 'amp_provider', provider_name: 'Fixture', model_display_name: 'Fixture', provider_revision: 1, model_revision: 1,
      context_window_tokens: 100_000, max_output_tokens: 4096, supports_images: false,
      reasoning_control: 'none', supported_reasoning_levels: ['off'] } },
    context: { estimated_tokens: 100, warning: false, provider_usage_supported: true, context_assessment_supported: true },
  }
}
