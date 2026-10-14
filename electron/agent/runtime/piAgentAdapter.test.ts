import { withToolDiscovery } from '../test-support/runtimeDiscoveryTestFixture.ts'
import { runtimeBootstrap, runtimePart, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeContext } from '@earendil-works/pi-ai'
import type { RuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'
import type { RuntimeEventInput } from '../contracts/runtimeEvents.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { agentRuntimeProtocolVersion, defaultExecutionBudget } from '#common/contracts'
import { createRestrictedProviderFetch, createRuntimeStreamFunction } from '../provider/runtimeProviderAdapter.ts'
import { createPiAgent, createRuntimeModel, handlePiEvent } from './piAgentAdapter.ts'
import { hydrateRuntimeMessages } from '../context/runtimeMessages.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { mapMCPTools } from '../tools/mcpClientAdapter.ts'

for (const [history, apiMode] of [
  ['raw', 'chat_completions'], ['checkpoint', 'chat_completions'], ['checkpoint_tail', 'chat_completions'],
  ['raw', 'responses'], ['checkpoint', 'responses'], ['checkpoint_tail', 'responses'],
] as const) {
  test(`替换 SSH 后 ${apiMode} 的 ${history} 历史旧 ID 不会下发，真实 Agent 工具轮可修正为新绑定`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = apiMode
    bootstrap.model.snapshot.context_window_tokens = 128000
    bootstrap.session.resource_bindings = [{
      kind: 'ssh_session', session_id: 'ses_new', host_id: 'host_new', ssh_profile_id: 'ssh_new',
      host_name: '测试主机', platform: 'linux', bound_at: '2026-09-09T14:32:55Z',
    }]
    const historical = { ...runtimeUserMessage([], { text: '之前的 SSH 是 ses_old' }), sequence: 1 }
    const previous: RuntimeBootstrap['messages'][number] = {
      id: 'agm_previous', role: 'assistant', status: 'completed', sequence: 2, created_at: historical.created_at,
      attachments: [], parts: [
        runtimePart('tool_call', 1, { tool_call: { tool_call_id: 'historical_call', tool_name: 'termous.commands.dispatch',
          arguments: { session_ids: ['ses_old'], command: 'ls /root', client_request_id: 'historical_operation' } } }),
        runtimePart('tool_result', 2, { tool_result: { tool_call_id: 'historical_call', tool_name: 'termous.commands.dispatch',
          content: [{ type: 'text', text: 'ses_old: SESSION_NOT_FOUND' }], is_error: true } }),
      ],
    }
    const current = { ...runtimeUserMessage([], { text: '已更换连接，请执行 ls /root' }), id: 'agm_current', sequence: 3 }
    bootstrap.messages = history === 'raw' ? [historical, previous, current] : [current]
    if (history !== 'raw') bootstrap.context.checkpoint = {
      boundary_message_sequence: 2, summary: '之前使用 ses_old，旧连接现已失效，需要重新绑定。', estimated_tokens: 40,
      ...(history === 'checkpoint_tail' ? { version: 2, id: 'acc_old', run_id: 'agr_old', generation: 1,
        covered_event_sequence: 5, image_sources: [],
        retained_tail: hydrateRuntimeMessages({ ...bootstrap, messages: [historical, previous, current] }, createRuntimeModel(bootstrap)).slice(0, -1),
      } : {}),
    }
    const original = structuredClone(bootstrap)
    const calls: Record<string, unknown>[] = []
    const events: RuntimeEventInput[] = []
    const mapped = mapMCPTools([{
      name: 'termous.commands.dispatch', inputSchema: {
        type: 'object', properties: {
          session_ids: { type: 'array', items: { type: 'string' } },
          command: { type: 'string' }, client_request_id: { type: 'string' },
        }, required: ['session_ids', 'command', 'client_request_id'], additionalProperties: false,
      },
    }], async (_definition, args) => {
      calls.push(args)
      return { content: [{ type: 'text', text: '新连接执行成功' }] }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
        core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48),
        run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1,
      onFailure: (error) => { throw error },
      core: {
        bootstrap: async () => bootstrap,
        appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => {
          events.push(...batch)
          return batch[batch.length - 1]!.sequence
        },
        appendSteer: async () => { throw new Error('不应保存追加指令') },
        commitCheckpoint: async () => { throw new Error('短上下文不应重新压缩') },
      },
    })
    let requests = 0
    const agent = createPiAgent({
      bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('短上下文不应重新压缩') },
      fetch: withToolDiscovery(async (_input, init) => {
        requests++
        const body = JSON.parse(String(init?.body))
        const requestMessages = body.messages ?? body.input
        const system = requestMessages.filter((message: { role: string }) => message.role === 'system' || message.role === 'developer')
        assert.equal(system.length, 1)
        assert.match(JSON.stringify(system), /远程操作只能通过当前提供的 MCP 工具/u)
        assert.match(JSON.stringify(system), /ses_new/u)
        assert.doesNotMatch(JSON.stringify(system), /ses_old/u)
        assert.match(JSON.stringify(body.tools), /ses_new/u)
        assert.doesNotMatch(JSON.stringify(body.tools), /ses_old/u)
        if (requests === 1) assert.match(JSON.stringify(requestMessages), /ses_old/u)
        if (requests === 2) {
          assert.equal(calls.length, 0)
          const localError = requestMessages.findLast((message: { role?: string; type?: string }) =>
            message.role === 'tool' || message.type === 'function_call_output')
          const errorText = localError.content ?? localError.output
          assert.match(errorText, /AGENT_RESOURCE_BINDING_MISMATCH/u)
          assert.match(errorText, /"dispatched":false/u)
          assert.match(errorText, /ses_new/u)
        }
        assert.ok(requests <= 3)
        const argumentsJSON = JSON.stringify({ session_ids: [requests === 1 ? 'ses_old' : 'ses_new'],
          command: 'ls /root', client_request_id: 'new_operation' })
        if (apiMode === 'responses') {
          const item = requests < 3
            ? { type: 'function_call', id: `fc_${requests}`, call_id: `call_${requests}`,
              name: mapped.tools[0]!.name, arguments: argumentsJSON, status: 'completed' }
            : { type: 'message', id: 'msg_complete', role: 'assistant', status: 'completed',
              content: [{ type: 'output_text', text: '新连接执行成功', annotations: [] }] }
          const responseID = `resp_${requests}`
          const responseEvents = [
            { type: 'response.created', response: { id: responseID } },
            { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress',
              ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } },
            { type: 'response.output_item.done', output_index: 0, item },
            { type: 'response.completed', response: { id: responseID, status: 'completed', output: [item] } },
          ]
          return new Response(responseEvents.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
            { headers: { 'Content-Type': 'text/event-stream' } })
        }
        const delta = requests < 3 ? {
          role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests}`, type: 'function', function: {
            name: mapped.tools[0]!.name,
            arguments: argumentsJSON,
          } }],
        } : { role: 'assistant', content: '新连接执行成功' }
        const chunk = { id: `chatcmpl_${requests}`, object: 'chat.completion.chunk', created: 1, model: 'test-model',
          choices: [{ index: 0, delta, finish_reason: requests < 3 ? 'tool_calls' : 'stop' }] }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      }, mapped.tools.map((tool) => tool.name)),
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      await writer.flush()
      assert.equal(requests, 3)
      assert.deepEqual(calls, [{ session_ids: ['ses_new'], command: 'ls /root', client_request_id: 'new_operation' }])
      assert.deepEqual(bootstrap, original)
      assert.equal(events.filter((event) => event.kind === 'tool_failed').length, 1)
      assert.equal(events.filter((event) => event.kind === 'tool_completed').length, 2)
    } finally {
      agent.close()
      await writer.close()
    }
  })
}

for (const apiMode of ['chat_completions', 'responses'] as const) {
  test(`${apiMode} 纯图片消息不附加空文本，保留受控请求边界`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = apiMode
    bootstrap.model.snapshot.supports_images = true
    const model = createRuntimeModel(bootstrap)
    let requests = 0
    const fetcher = createRestrictedProviderFetch(model.baseUrl, true, async (_input, init) => {
      requests += 1
      assert.equal(init?.redirect, 'manual')
      assert.equal(new Headers(init?.headers).get('authorization'), null)
      const body = JSON.parse(String(init?.body))
      const user = (body.messages ?? body.input).find((message: { role: string }) => message.role === 'user')
      assert.equal(user.content.length, 1)
      const imageURL = 'data:image/png;base64,aW1hZ2U='
      assert.deepEqual(user.content[0], apiMode === 'chat_completions'
        ? { type: 'image_url', image_url: { url: imageURL } }
        : { type: 'input_image', detail: 'auto', image_url: imageURL })
      const chunk = apiMode === 'chat_completions'
        ? { id: 'chat_image', choices: [{ index: 0, delta: { content: '图片已收到' }, finish_reason: 'stop' }] }
        : { type: 'response.completed', response: { id: 'resp_image', status: 'completed', output: [] } }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    })
    const stream = await createRuntimeStreamFunction(undefined, fetcher)(model, normalizeContext({
      systemPrompt: '描述用户图片',
      messages: [{ role: 'user', timestamp: 1, content: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }] }],
    }))
    assert.equal((await stream.result()).stopReason, 'stop')
    assert.equal(requests, 1)
  })
}

test('真实 pi 消费追加指令时只发送消息引用，不泄漏持久化回执字段', async () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.messages = [runtimeUserMessage([])]
  const events: RuntimeEventInput[] = []
  const writer = new RuntimeEventWriter({
    start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
      core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48),
      run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
    runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1,
    onFailure: (error) => { throw error },
    core: {
      bootstrap: async () => bootstrap,
      appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => {
        events.push(...batch)
        return batch[batch.length - 1]!.sequence
      },
      appendSteer: async () => { throw new Error('不应重新保存追加指令') },
      commitCheckpoint: async () => { throw new Error('不应压缩短上下文') },
    },
  })
  let requests = 0
  const persisted = { message_id: 'agm_applied', part_id: 'agp_applied', last_sequence: 9 }
  const agent = createPiAgent({
    bootstrap, events: writer, skills: testAgentSkillBundle(),
    mcp: { tools: [], originalName: () => null, close: async () => {} },
    commitCheckpoint: async () => { throw new Error('不应压缩短上下文') },
    fetch: async () => {
      if (requests++ === 0) agent.steer('追加约束', persisted)
      const chunk = {
        id: `chatcmpl_${requests}`, object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
      }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })
  try {
    assert.equal(await agent.continue(), 'completed')
    await writer.flush()
    assert.equal(requests, 2)
    assert.deepEqual(events.filter((event) => event.kind === 'steer_applied').map((event) => event.payload), [
      { steer_applied: { message_id: 'agm_applied', part_id: 'agp_applied' } },
    ])
  } finally {
    agent.close()
    await writer.close()
  }
})

for (const apiMode of ['responses', 'chat_completions'] as const) {
  test(`真实 ${apiMode} 摘要失败原因经门禁和消息桥落盘，凭据不进入事件`, async () => {
    const bootstrap = runtimeBootstrap()
    const secret = 'summary-fixture-key+/value'
    bootstrap.model.api_key = secret
    bootstrap.model.snapshot.api_mode = apiMode
    bootstrap.model.snapshot.force_context_compression = true
    bootstrap.messages = ['旧记录'.repeat(4000), '近期记录'.repeat(4000), '继续'].map((text, index) => ({
      ...runtimeUserMessage([], { text }), id: `agm_history_${index}`, sequence: index + 1,
    }))
    const original = structuredClone(bootstrap.messages)
    const events: RuntimeEventInput[] = []
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
        core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48),
        run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1,
      onFailure: (error) => { throw error },
      core: {
        bootstrap: async () => bootstrap,
        appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => {
          events.push(...batch)
          return batch[batch.length - 1]!.sequence
        },
        appendSteer: async () => { throw new Error('不应保存追加指令') },
        commitCheckpoint: async () => { throw new Error('失败摘要不能提交') },
      },
    })
    let requests = 0
    const agent = createPiAgent({
      bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { tools: [], originalName: () => null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('失败摘要不能提交') },
      fetch: async (_input, init) => {
        requests += 1
        const body = JSON.parse(String(init?.body)) as { tools?: unknown[] }
        assert.equal(body.tools?.length ?? 0, 0)
        return new Response(JSON.stringify({ error: {
          code: 'server_error', message: `fixture upstream failure ${secret} ${encodeURIComponent(secret)}`,
        } }), { status: 503, headers: { 'content-type': 'application/json' } })
      },
    })
    try {
      assert.equal(await agent.continue(), 'failed')
      await writer.flush()
      assert.equal(requests, 4)
      const retries = events.filter((event) => event.kind === 'retry')
        .map((event) => event.payload.retry as Record<string, unknown>)
      assert.deepEqual(retries.map((activity) => [activity.status, activity.attempt]), [
        ['waiting', 0], ['requesting', 1], ['waiting', 1], ['requesting', 2],
        ['waiting', 2], ['requesting', 3], ['failed', 3],
      ])
      assert.ok(retries.every((activity) => activity.purpose === 'compaction'
        && activity.assistant_message_id === bootstrap.run.assistant_message_id
        && activity.after_part_sequence === 0 && activity.max_retries === 3))
      assert.equal(new Set(retries.map((activity) => activity.retry_id)).size, 1)
      const error = events.find((event) => event.kind === 'error')?.payload.error as Record<string, unknown>
      assert.equal(error.code, 'AGENT_RUNTIME_CONTEXT_COMPRESSION_PROVIDER_FAILED')
      assert.match(String(error.message), /fixture upstream failure/u)
      assert.equal(error.message, retries[retries.length - 1]!.error_message)
      const activities = events.filter((event) => event.kind === 'compaction')
        .map((event) => event.payload.compaction as Record<string, unknown>)
      assert.deepEqual(activities.map((activity) => activity.status), ['started', 'failed'])
      assert.equal(activities[1]!.error_code, error.code)
      assert.equal(JSON.stringify(events).includes(secret), false)
      assert.equal(JSON.stringify(events).includes(encodeURIComponent(secret)), false)
      assert.deepEqual(bootstrap.messages, original)
    } finally {
      agent.close()
      await writer.close()
    }
  })
}

for (const purpose of ['response', 'compaction'] as const) {
  test(`${purpose} waiting 状态写入失败时及时终止，不启动额外 Provider 请求`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.messages = [runtimeUserMessage([])]
    if (purpose === 'compaction') {
      bootstrap.model.snapshot.force_context_compression = true
      bootstrap.messages = ['旧记录'.repeat(4000), '近期记录'.repeat(4000), '继续'].map((text, index) => ({
        ...runtimeUserMessage([], { text }), id: `agm_retry_history_${index}`, sequence: index + 1,
      }))
    }
    const failures: unknown[] = []
    const retryPurposes: unknown[] = []
    const rejected = new Error('fixture Core rejected retry status')
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
        core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48),
        run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1,
      onFailure: (error) => { failures.push(error); agent.abort() },
      core: {
        bootstrap: async () => bootstrap,
        appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => {
          const retry = batch.find((event) => event.kind === 'retry')
          if (retry) {
            retryPurposes.push((retry.payload.retry as Record<string, unknown>).purpose)
            throw rejected
          }
          return batch[batch.length - 1]!.sequence
        },
        appendSteer: async () => { throw new Error('不应保存追加指令') },
        commitCheckpoint: async () => { throw new Error('失败摘要不能提交') },
      },
    })
    let requests = 0
    const agent = createPiAgent({
      bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { tools: [], originalName: () => null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('失败摘要不能提交') },
      onFailure: (error) => { failures.push(error) },
      fetch: async () => {
        requests += 1
        return new Response(JSON.stringify({ error: { message: 'fixture upstream unavailable' } }), {
          status: 503, headers: { 'content-type': 'application/json' },
        })
      },
    })
    try {
      await agent.continue()
      assert.equal(requests, 1)
      assert.deepEqual(retryPurposes, [purpose])
      assert.ok(failures.includes(rejected))
    } finally {
      agent.close()
      await assert.rejects(writer.close(), (error) => error === rejected)
    }
  })
}

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

test('运行时模型只开放快照明确声明的推理档位', () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.run.reasoning_level = 'xhigh'
  bootstrap.model.snapshot.reasoning_control = 'openai_effort'
  bootstrap.model.snapshot.supported_reasoning_levels = ['off', 'low', 'high', 'xhigh']

  const model = createRuntimeModel(bootstrap)

  assert.equal(model.reasoning, true)
  assert.deepEqual(model.thinkingLevelMap, {
    off: 'none',
    minimal: null,
    low: 'low',
    medium: null,
    high: 'high',
    xhigh: 'xhigh',
    max: null,
  })
  assert.equal(
    model.api === 'openai-completions'
      ? model.compat?.supportsReasoningEffort
      : undefined,
    true,
  )
})

test('运行时模型允许仅声明较高推理档位', () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.run.reasoning_level = 'max'
  bootstrap.model.snapshot.reasoning_control = 'openai_effort'
  bootstrap.model.snapshot.supported_reasoning_levels = ['high', 'max']

  const model = createRuntimeModel(bootstrap)

  assert.deepEqual(model.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: 'high',
    xhigh: null,
    max: 'max',
  })
})

test('无推理控制模型不会向 Chat Completions 声明 reasoning_effort', () => {
  const model = createRuntimeModel(runtimeBootstrap())

  assert.equal(model.reasoning, false)
  assert.equal(
    model.api === 'openai-completions'
      ? model.compat?.supportsReasoningEffort
      : undefined,
    false,
  )
})

test('运行时模型完全使用 Run 快照且保留 Provider 目录身份', () => {
  const bootstrap = runtimeBootstrap()
  const model = createRuntimeModel(bootstrap)

  assert.equal(model.id, 'test-model')
  assert.equal(model.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(model.contextWindow, 8192)
  assert.equal(model.maxTokens, 1024)
  assert.deepEqual(model.input, ['text'])
  assert.equal(bootstrap.model.snapshot.provider_id, 'amp_provider')
  assert.equal(bootstrap.model.snapshot.provider_revision, 3)
  assert.equal(bootstrap.model.snapshot.model_revision, 5)
})

test('pi 监听器异常通知失败并取消 Agent，且不反向抛出', async () => {
  const failure = new Error('bridge failed')
  let received: unknown
  let aborted = false

  await assert.doesNotReject(() => handlePiEvent(
    { type: 'agent_start' },
    { handle: () => { throw failure } },
    (error) => { received = error },
    () => { aborted = true },
  ))
  assert.equal(received, failure)
  assert.equal(aborted, true)
})

test('pi 异步占用回调失败时等待通知和取消，不产生未处理拒绝', async () => {
  const failure = new Error('context write failed')
  let received: unknown
  let aborted = false
  await assert.doesNotReject(() => handlePiEvent(
    { type: 'agent_start' },
    { handle: async () => { await Promise.resolve(); throw failure } },
    (error) => { received = error },
    () => { aborted = true },
  ))
  assert.equal(received, failure)
  assert.equal(aborted, true)
})

for (const mode of ['bounded', 'unbounded', 'uncertain', 'cancelled'] as const) test(`真实 pi 工具调用组边界：${mode}`, async () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.model.snapshot.execution_budget = { ...defaultExecutionBudget, enabled: mode === 'bounded' || mode === 'cancelled' }
  bootstrap.model.snapshot.context_window_tokens = 128000
  bootstrap.messages = [runtimeUserMessage([], { text: '测试失败边界' })]
  bootstrap.context.request_usage_supported = true
  const events: RuntimeEventInput[] = []
  let dispatched = 0
  const mapped = mapMCPTools([{ name: 'termous.desktops.pointer.click', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], async () => {
    dispatched++
    if (mode === 'cancelled' && dispatched === 3) agent.abort()
    if (mode === 'uncertain') return { isError: true, content: [{ type: 'text', text: '{"error":{"code":"desktop_input_uncertain"}}' }] }
    return { isError: true, content: [{ type: 'text', text: '{"error":{"code":"desktop_invalid","diagnostic":{"reason":"out_of_bounds"}}}' }] }
  })
  const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() }, runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1, onFailure: (error) => { throw error }, core: {
    bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence }, appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应压缩') },
  } })
  let requests = 0
  const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(), mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} }, commitCheckpoint: async () => { throw new Error('不应压缩') }, fetch: withToolDiscovery(async () => {
    requests++
    if (mode === 'unbounded' && requests === 2) return completionFixture({ content: '已完成' })
    assert.equal(requests, 1)
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: Array.from({ length: 4 }, (_, index) => ({ index, id: `click${index}`, type: 'function', function: { name: mapped.tools[0]!.name, arguments: '{}' } })) }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }, ['termous.desktops.pointer.click']) })
  try {
    assert.equal(await agent.continue(), mode === 'unbounded' ? 'completed' : mode === 'cancelled' ? 'cancelled' : 'failed')
    await writer.flush()
    assert.equal(dispatched, mode === 'uncertain' ? 1 : mode === 'unbounded' ? 4 : 3)
    assert.equal(events.filter((event) => event.kind === 'request_usage').length, mode === 'unbounded' ? 3 : 2)
    const errors = JSON.stringify(events.filter((event) => event.kind === 'error'))
    if (mode === 'bounded') assert.match(errors, /AGENT_RUNTIME_NO_PROGRESS/u)
    if (mode === 'uncertain') assert.match(errors, /AGENT_RUNTIME_INPUT_UNCERTAIN/u)
    if (mode === 'cancelled' || mode === 'unbounded') assert.doesNotMatch(errors, /AGENT_RUNTIME_NO_PROGRESS/u)
  } finally { agent.close(); await writer.close() }
})

function completionFixture(delta: Record<string, unknown>, tokens = 100) {
  const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: tokens - 10, completion_tokens: 10, total_tokens: tokens } }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

for (const mode of ['final', 'tool', 'request'] as const) test(`真实 pi 预算请求边界：${mode}`, async () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.model.snapshot.context_window_tokens = 128000
  bootstrap.model.snapshot.execution_budget = { enabled: true, limits: { ...defaultExecutionBudget.limits, total_tokens: 10000, model_requests: mode === 'request' ? 1 : 60 } }
  bootstrap.context.request_usage_supported = true
  bootstrap.messages = [runtimeUserMessage([], { text: '预算边界' })]
  const events: RuntimeEventInput[] = []
  let dispatched = 0
  let requests = 0
  const mapped = mapMCPTools([{ name: 'termous.hosts.list', inputSchema: { type: 'object', properties: {} } }], async () => {
    dispatched++
    return { content: [{ type: 'text', text: '完成' }] }
  })
  const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() }, runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1, onFailure: (error) => { throw error }, core: {
    bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence }, appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应压缩') },
  } })
  const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(), mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} }, commitCheckpoint: async () => { throw new Error('不应压缩') }, fetch: async () => {
    requests++
    assert.ok(requests <= 2)
    if (requests === 1 && mode !== 'final') return completionFixture({ tool_calls: [{ index: 0, id: 'discover', type: 'function', function: { name: 'discover_tools', arguments: JSON.stringify({ query: '工具', names: ['termous.hosts.list'] }) } }] })
    if (mode === 'request') assert.fail('本地请求上限未阻止第二次网络请求')
    return completionFixture(mode === 'final' ? { content: '已完成答案' } : { tool_calls: [{ index: 0, id: 'list', type: 'function', function: { name: mapped.tools[0]!.name, arguments: '{}' } }] }, 11000)
  } })
  try {
    assert.equal(await agent.continue(), mode === 'final' ? 'completed' : 'failed')
    await writer.flush()
    assert.equal(dispatched, 0)
    assert.equal(requests, mode === 'tool' ? 2 : 1)
    const errors = JSON.stringify(events.filter((event) => event.kind === 'error'))
    if (mode === 'final') {
      assert.equal(errors, '[]')
      assert.match(JSON.stringify(events.filter((event) => event.kind === 'request_usage')), /11000/u)
    } else assert.match(errors, mode === 'tool' ? /AGENT_RUNTIME_TOKEN_LIMIT/u : /AGENT_RUNTIME_REQUEST_LIMIT/u)
    assert.equal(events.filter((event) => event.kind === 'retry').length, 0)
  } finally { agent.close(); await writer.close() }
})
