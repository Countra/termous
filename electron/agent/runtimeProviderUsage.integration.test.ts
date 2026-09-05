import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent, type CreatePiAgentOptions } from './piAgentAdapter.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import type { RuntimeCompactionContextUsage } from './runtimeCompaction.ts'
import type { RuntimeProviderUsage } from './runtimeProviderUsage.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'
import { encodeMCPToolName } from './toolNameCodec.ts'
import { WorkerCoreClient, type RuntimeBootstrap, type RuntimeEventInput, type RuntimeMessagePart } from './workerCoreClient.ts'

for (const apiMode of ['chat_completions', 'responses'] as const) {
  test(`真实 ${apiMode} 跨 Run 恢复 70% 基准，新增输入后不回退字符估算，最终同步 75%`, async () => {
    const bootstrap = usageBootstrap(apiMode)
    const first = await executeFixture(bootstrap, 70_000)
    const firstFinal = first.contexts[first.contexts.length - 1]!
    assert.equal(firstFinal.estimated_tokens, 70_000)
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
  const result = await executeFixture(bootstrap, 70_000)
  assert.equal(result.contexts[result.contexts.length - 1]!.estimated_tokens, 70_000)
  assert.ok(result.contexts.every((usage) => usage.provider_usage === undefined))
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
        order.push('summary')
        return providerResponse('chat_completions', 2000)
      }
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

async function executeFixture(
  bootstrap: RuntimeBootstrap, tokens: number,
  overrides: Partial<Pick<CreatePiAgentOptions, 'mcp' | 'fetch' | 'commitCheckpoint'>> = {},
) {
  // 经过真实 bootstrap 校验、pi Agent、Provider SSE 与事件写入器，网络和 Core 均由内存替身提供。
  const accepted = await new WorkerCoreClient({ fetch: async () => Response.json(bootstrap) }).bootstrap(fixtureStart(bootstrap))
  const events: RuntimeEventInput[] = []
  const writer = new RuntimeEventWriter({
    start: fixtureStart(bootstrap), runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0,
    onFailure: (error) => { throw error },
    core: {
      bootstrap: async () => bootstrap,
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
  })
  try {
    const outcome = await agent.continue()
    await writer.flush()
    assert.equal(outcome, 'completed', JSON.stringify(events.filter((event) => event.kind === 'error').map((event) => event.payload.error)))
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
    context: { estimated_tokens: 100, warning: false, provider_usage_supported: true },
  }
}
