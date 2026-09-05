import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createRuntimeModel, hydrateRuntimeMessages } from './piAgentAdapter.ts'
import { PiEventBridge } from './piEventBridge.ts'
import type { AgentWorkerStartMessage } from './protocol.ts'
import { createRuntimeContextGate } from './runtimeContextGate.ts'
import { RuntimeContextImages } from './runtimeContextImages.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import {
  compactionTestAssistant,
  compactionTestHistory,
  compactionTestModel,
  compactionTestStream,
  compactionTestUser,
} from './runtimeCompactionTestFixture.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'
import type {
  RuntimeBootstrap,
  RuntimeCheckpointInput,
  RuntimeContextCheckpoint,
  RuntimeEventInput,
  RuntimeSteerInput,
  WorkerCoreClientPort,
} from './workerCoreClient.ts'

test('真实门禁按开始、摘要用量、Core 原子完成顺序提交，普通通道不重复写完成', async () => {
  const fixture = gateFixture()
  const raw = compactionTestHistory()
  const projected = await fixture.gate.transformContext(raw)
  await fixture.writer.close()
  fixture.gate.beforeProviderRequest()
  assert.equal(fixture.requests, 1)
  assert.equal(fixture.commits.length, 1)
  assert.deepEqual(fixture.activities().map((event) => event.payload.compaction.status), ['started', 'completed'])
  const start = fixture.activities()[0]!
  const completion = fixture.activities()[1]!
  const usage = fixture.events.find((event) => event.kind === 'usage')!
  assert.ok(start.sequence < usage.sequence && usage.sequence < completion.sequence)
  assert.equal(fixture.commits[0]!.covered_event_sequence, start.sequence - 1)
  assert.equal(fixture.commits[0]!.summary, '## Goal\n继续原任务。')
  assert.equal(fixture.gate.checkpoint()!.coveredRawLength, raw.length)
  assert.equal(projected[projected.length - 1], raw[raw.length - 1])
  assert.equal(fixture.bridge.outcome(), 'completed')
  assert.deepEqual(fixture.failures, [])
})

for (const version of [1, 2] as const) {
  test(`恢复 v${version} 快照只生成一个摘要，保留原文尾部并追加 bootstrap 增量`, async () => {
    const bootstrap = gateBootstrap()
    const retained = version === 2 ? [compactionTestAssistant('保留原文', 100000)] : []
    bootstrap.context.checkpoint = {
      id: 'agc_previous', version, boundary_message_sequence: 1,
      summary: '旧摘要唯一标记', estimated_tokens: 400,
      ...(version === 2 ? {
        retained_tail: retained, image_sources: [], run_id: 'agr_previous',
        generation: 1, covered_event_sequence: 9,
      } : {}),
    }
    const fixture = gateFixture({ bootstrap })
    const raw = hydrateRuntimeMessages(bootstrap, createRuntimeModel(bootstrap))
    const projected = await fixture.gate.transformContext(raw)
    fixture.gate.beforeProviderRequest()
    await fixture.writer.close()
    assert.equal(projected.length, 2 + retained.length)
    assert.equal(JSON.stringify(projected).split('旧摘要唯一标记').length - 1, 1)
    assert.equal(projected[projected.length - 1], raw[raw.length - 1])
    assert.equal(fixture.gate.checkpoint()!.coveredRawLength, 1 + retained.length)
    assert.equal(fixture.requests, 0)
    assert.equal(fixture.commits.length, 0)
    const usage = fixture.events.find((event) => event.kind === 'context_usage')!
    assert.ok(Number((usage.payload.context_usage as Record<string, unknown>).estimated_tokens) < 400)
    if (retained[0]?.role === 'assistant') assert.equal(retained[0].usage.totalTokens, 100000)
  })
}

test('capture 和 started 之间收到追加指令时，以开始事件前一项作为原子覆盖水位', async () => {
  const fixture = gateFixture()
  const currentSequence = fixture.writer.currentSequence.bind(fixture.writer)
  let receipt: Promise<unknown> | undefined
  fixture.writer.currentSequence = () => {
    const captured = currentSequence()
    // 模拟 IPC 已排队的微任务在 capture 返回后、started 写入前分配收件事件。
    queueMicrotask(() => {
      receipt = fixture.writer.writeExternal(async (eventID, sequence) => {
        const value = await fixture.core.appendSteer(fixture.start, 'runtime-token', {
          event_id: eventID, sequence, client_request_id: 'agsr_race', text: '补充约束',
        })
        return { lastSequence: value.last_sequence, value }
      })
    })
    return captured
  }
  await fixture.gate.transformContext(compactionTestHistory())
  await receipt
  await fixture.writer.close()
  fixture.gate.beforeProviderRequest()
  assert.equal(fixture.receipts.length, 1)
  assert.equal(fixture.commits[0]!.covered_event_sequence, fixture.receipts[0]!.sequence)
  assert.equal(fixture.activities()[0]!.sequence, fixture.receipts[0]!.sequence + 1)
  assert.equal(fixture.events.some((event) => event.kind === 'steer_applied'), false)
  assert.deepEqual(fixture.failures, [])
})

test('保留尾部信封超限时可正常写入失败活动，不破坏事件流水线', async () => {
  const fixture = gateFixture()
  const raw = compactionTestHistory()
  const recent = raw[raw.length - 2]!
  Object.assign(recent, { responseId: 'x'.repeat(1024 * 1024) })
  await fixture.gate.transformContext(raw)
  await fixture.writer.close()
  assert.equal(fixture.commits.length, 0)
  assert.deepEqual(fixture.activities().map((event) => event.payload.compaction.status), ['started', 'failed'])
  assert.deepEqual(fixture.failures, [])
  assert.throws(() => fixture.gate.beforeProviderRequest())
})

test('完成提交在途取消仍等待回执，保留完成活动并阻止下一次请求', async () => {
  const fixture = gateFixture()
  const abort = new AbortController()
  const commit = fixture.core.commitCheckpoint.bind(fixture.core)
  fixture.core.commitCheckpoint = async (start, bearer, input, signal) => {
    assert.equal(signal, undefined)
    abort.abort()
    return commit(start, bearer, input, signal)
  }
  await fixture.gate.transformContext(compactionTestHistory(), abort.signal)
  await fixture.writer.close()
  assert.equal(fixture.commits.length, 1)
  assert.deepEqual(fixture.activities().map((event) => event.payload.compaction.status), ['started', 'completed'])
  assert.deepEqual(fixture.failures, [])
  assert.throws(() => fixture.gate.beforeProviderRequest(), /COMPRESSION_ABORTED/u)
})

test('未 flush 的工具图片先由消息桥接落盘，再通过引用进入 retained tail', async () => {
  const fixture = gateFixture()
  const call = {
    ...compactionTestAssistant('', 7000), stopReason: 'toolUse' as const,
    content: [{ type: 'toolCall' as const, id: 'call_image', name: 'read_image', arguments: {} }],
  }
  const data = Buffer.from('image-content-for-source-reference').toString('base64')
  const result: ToolResultMessage = {
    role: 'toolResult', toolCallId: 'call_image', toolName: 'read_image', timestamp: 4,
    isError: false, content: [{ type: 'text', text: '图片说明' }, { type: 'image', data, mimeType: 'image/png' }],
  }
  fixture.bridge.handle({ type: 'message_end', message: call })
  fixture.bridge.handle({ type: 'message_end', message: result })
  assert.equal(fixture.events.length, 0)
  await fixture.gate.transformContext([...compactionTestHistory(), call, result])
  await fixture.writer.close()
  fixture.gate.beforeProviderRequest()
  const commit = fixture.commits[0]!
  const imagePart = fixture.events.find((event) => event.kind === 'message_part'
    && (event.payload.message_part as Record<string, unknown>).kind === 'tool_result')!
  assert.ok(imagePart.sequence <= commit.covered_event_sequence)
  assert.equal(fixture.activities()[0]!.payload.compaction.after_part_sequence, 2)
  const tail = commit.retained_tail as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const reference = tail.find((message) => message.role === 'toolResult')!.content[1]!
  assert.equal(reference.type, 'image_ref')
  assert.equal(reference.message_part_id, (imagePart.payload.message_part as Record<string, unknown>).id)
  assert.equal(reference.content_index, 1)
  assert.match(String(reference.sha256), /^[0-9a-f]{64}$/u)
  assert.equal(JSON.stringify(commit.retained_tail).includes(data), false)
  assert.equal(JSON.stringify(fixture.gate.checkpoint()!.retainedTail).includes(data), true)
})

test('摘要失败保留旧 checkpoint，发布失败活动和已发生用量，阻断主请求', async () => {
  const bootstrap = gateBootstrap()
  bootstrap.context.checkpoint = previousCheckpoint()
  const fixture = gateFixture({
    bootstrap,
    streamFn: compactionTestStream({ ...compactionTestAssistant('部分摘要', 100), stopReason: 'length' }),
  })
  const raw: AgentMessage[] = [compactionTestUser('已恢复摘要占位'), ...compactionTestHistory()]
  await fixture.gate.transformContext(raw)
  await fixture.writer.close()
  assert.throws(() => fixture.gate.beforeProviderRequest(), /COMPRESSION_TRUNCATED/u)
  assert.equal(fixture.commits.length, 0)
  assert.equal(fixture.gate.checkpoint()!.summary, bootstrap.context.checkpoint.summary)
  assert.deepEqual(fixture.activities().map((event) => event.payload.compaction.status), ['started', 'failed'])
  assert.equal((fixture.events.find((event) => event.kind === 'usage')!.payload.usage as Record<string, unknown>).input_tokens, 100)
  assert.deepEqual(fixture.failures, [])
})

test('摘要中途取消发布 cancelled，保留原始上下文且不提交快照', async () => {
  const abort = new AbortController()
  const fixture = gateFixture({
    streamFn: compactionTestStream(async (_context, options) => {
      assert.equal(options?.signal, abort.signal)
      abort.abort()
      return compactionTestAssistant('取消前已消耗用量', 100)
    }),
  })
  const raw = compactionTestHistory()
  const projected = await fixture.gate.transformContext(raw, abort.signal)
  await fixture.writer.close()
  assert.deepEqual(projected, raw)
  assert.throws(() => fixture.gate.beforeProviderRequest(), /COMPRESSION_ABORTED/u)
  assert.equal(fixture.commits.length, 0)
  assert.deepEqual(fixture.activities().map((event) => event.payload.compaction.status), ['started', 'cancelled'])
  assert.equal(fixture.events.filter((event) => event.kind === 'usage').length, 1)
  assert.deepEqual(fixture.failures, [])
})

interface GateFixtureOptions {
  bootstrap?: RuntimeBootstrap
  streamFn?: StreamFn
}

function gateFixture(options: GateFixtureOptions = {}) {
  const bootstrap = options.bootstrap ?? gateBootstrap()
  const events: RuntimeEventInput[] = []
  const commits: RuntimeCheckpointInput[] = []
  const receipts: RuntimeSteerInput[] = []
  const failures: unknown[] = []
  let lastSequence = bootstrap.run.event_sequence
  let requests = 0
  const start: AgentWorkerStartMessage = {
    type: 'start', protocol_version: agentRuntimeProtocolVersion,
    core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48),
    run_id: bootstrap.run.id, generation: bootstrap.run.generation, skills: testAgentSkillBundle(),
  }
  const acceptSequence = (sequence: number) => {
    assert.equal(sequence, lastSequence + 1)
    lastSequence = sequence
  }
  const core: WorkerCoreClientPort = {
    bootstrap: async () => bootstrap,
    appendEvents: async (_start, _bearer, batch) => {
      for (const event of batch) {
        acceptSequence(event.sequence)
        assert.ok(event.kind !== 'compaction'
          || (event.payload.compaction as Record<string, unknown>).status !== 'completed')
        events.push(event)
      }
      return lastSequence
    },
    appendSteer: async (_start, _bearer, input) => {
      acceptSequence(input.sequence)
      receipts.push(input)
      return { last_sequence: input.sequence, message_id: 'agm_steer', part_id: 'agp_steer' }
    },
    commitCheckpoint: async (_start, _bearer, input) => {
      acceptSequence(input.sequence)
      const started = activities().find((event) => event.payload.compaction.compaction_id === input.compaction_id)!
      assert.ok(started)
      assert.equal(started.sequence, input.covered_event_sequence + 1)
      commits.push(input)
      events.push({
        event_id: input.event_id, generation: start.generation, sequence: input.sequence,
        kind: 'compaction', payload: { compaction: {
          ...started.payload.compaction, status: 'completed', tokens_after: input.tokens_after,
        } },
      })
      return {
        last_sequence: input.sequence,
        checkpoint: { ...previousCheckpoint(), id: `agc_saved_${commits.length}`,
          summary: input.summary, estimated_tokens: input.tokens_after },
      }
    },
  }
  const writer = new RuntimeEventWriter({
    core, start, runtimeBearer: bootstrap.runtime_bearer, initialSequence: lastSequence,
    flushDelayMs: 60000, onFailure: (error) => { failures.push(error) },
  })
  const images = new RuntimeContextImages(bootstrap)
  const bridge = new PiEventBridge({
    writer, assistantMessageID: bootstrap.run.assistant_message_id, originalToolName: (name) => name,
    onToolResult: (partID, message) => images.registerToolResult(partID, message),
  })
  const gate = createRuntimeContextGate({
    bootstrap, model: { ...compactionTestModel, reasoning: true }, systemPrompt: '', tools: [], bridge, images, events: writer,
    streamFn: options.streamFn ?? compactionTestStream(async (_context, request) => {
      requests += 1
      assert.equal(activities()[activities().length - 1]?.payload.compaction.status, 'started')
      assert.equal(request?.reasoning, 'minimal')
      return compactionTestAssistant(' \n## Goal\n继续原任务。\n ', 100)
    }),
    commitCheckpoint: (input, signal) => core.commitCheckpoint(start, bootstrap.runtime_bearer, input, signal),
  })
  function activities() {
    return events.filter((event) => event.kind === 'compaction') as Array<RuntimeEventInput & {
      payload: { compaction: Record<string, unknown> }
    }>
  }
  return { gate, writer, bridge, core, start, events, commits, receipts, failures, activities,
    get requests() { return requests } }
}

function previousCheckpoint(): RuntimeContextCheckpoint {
  return {
    id: 'agc_previous', version: 2, boundary_message_sequence: 1,
    summary: '旧摘要必须保留', estimated_tokens: 400,
    retained_tail: [], image_sources: [], run_id: 'agr_previous', generation: 1, covered_event_sequence: 9,
  }
}

function gateBootstrap(): RuntimeBootstrap {
  return {
    core_instance_id: 'core_test', runtime_bearer: 'r'.repeat(48),
    run: { id: 'agr_test', session_id: 'ags_test', generation: 2, event_sequence: 1,
      status: 'running', assistant_message_id: 'agm_assistant', provider_id: 'provider_test',
      model_id: 'model_test', reasoning_level: 'high' },
    session: { id: 'ags_test' },
    messages: [{
      id: 'agm_user', role: 'user', status: 'completed', sequence: 2,
      created_at: '2026-09-05T00:00:00Z', attachments: [],
      parts: [{ id: 'agp_user', message_id: 'agm_user', kind: 'text', sequence: 1,
        content: { text: { text: '新增请求唯一标记' } } }],
    }],
    mcp: { endpoint: '/mcp', bearer_token: 'm'.repeat(48), protocol_version: '2025-11-25' },
    model: { snapshot: {
      api_mode: 'chat_completions', base_url: compactionTestModel.baseUrl, model_id: compactionTestModel.id,
      provider_id: 'provider_test', provider_name: 'Test', model_display_name: 'Test',
      provider_revision: 1, model_revision: 1, context_window_tokens: 8000, max_output_tokens: 1600,
      supports_images: true, reasoning_control: 'openai_effort', supported_reasoning_levels: ['high', 'minimal'],
    } },
    context: { estimated_tokens: 10, warning: false },
  }
}
