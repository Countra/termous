import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { AgentMCPConnection, ConnectAgentMCPOptions } from './mcpClientAdapter.ts'
import type { CreatePiAgentOptions, PiAgentController } from './piAgentAdapter.ts'
import type {
  AgentWorkerOutboundMessage,
  AgentWorkerStartMessage,
} from './protocol.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'
import { AgentWorkerRuntime } from './workerRuntime.ts'
import type {
  RuntimeBootstrap,
  RuntimeCheckpointInput,
  RuntimeCheckpointResult,
  RuntimeEventInput,
  RuntimeSteerInput,
  WorkerCoreClientPort,
} from './workerCoreClient.ts'

class FakeCore implements WorkerCoreClientPort {
  readonly events: RuntimeEventInput[] = []
  readonly steers: RuntimeSteerInput[] = []
  readonly checkpoints: RuntimeCheckpointInput[] = []
  bootstrapValue = runtimeBootstrap()
  bootstrapError: unknown = null
  bootstrapGate: Promise<void> | null = null
  beforeAppendEvents: ((events: RuntimeEventInput[]) => Promise<void>) | null = null
  private lastSequence = 1
  private readonly order: string[]

  constructor(order: string[] = []) {
    this.order = order
  }

  async bootstrap() {
    await this.bootstrapGate
    if (this.bootstrapError) {
      throw this.bootstrapError
    }
    return structuredClone(this.bootstrapValue)
  }

  async appendEvents(
    _start: AgentWorkerStartMessage,
    _runtimeBearer: string,
    events: RuntimeEventInput[],
  ) {
    await this.beforeAppendEvents?.(events)
    for (const event of events) {
      assert.equal(event.sequence, this.lastSequence + 1)
      this.lastSequence = event.sequence
      this.events.push(event)
    }
    return this.lastSequence
  }

  async appendSteer(
    _start: AgentWorkerStartMessage,
    _runtimeBearer: string,
    input: RuntimeSteerInput,
  ) {
    assert.equal(input.sequence, this.lastSequence + 1)
    this.lastSequence = input.sequence
    this.order.push(`core:${input.text}`)
    this.steers.push(input)
    return { last_sequence: this.lastSequence, message_id: 'agm_steer', part_id: 'agp_steer' }
  }

  async commitCheckpoint(
    _start: AgentWorkerStartMessage,
    _runtimeBearer: string,
    input: RuntimeCheckpointInput,
    signal?: AbortSignal,
  ): Promise<RuntimeCheckpointResult> {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    assert.equal(input.sequence, this.lastSequence + 1)
    this.lastSequence = input.sequence
    this.checkpoints.push(input)
    return {
      last_sequence: input.sequence,
      checkpoint: {
        id: input.compaction_id, version: 2, boundary_message_sequence: 0,
        summary: input.summary, estimated_tokens: input.tokens_after,
        retained_tail: [], image_sources: [], run_id: 'agr_test', generation: 1,
        covered_event_sequence: input.covered_event_sequence,
      },
    }
  }
}

class FakeAgent implements PiAgentController {
  readonly order: string[]
  outcome: 'completed' | 'cancelled' | 'failed' = 'completed'
  continueGate: Promise<void> | null = null
  queued = false
  aborted = false

  constructor(order: string[]) {
    this.order = order
  }

  async continue() {
    await this.continueGate
    this.queued = false
    return this.outcome
  }

  abort() {
    this.aborted = true
  }

  waitForIdle() {
    return Promise.resolve()
  }

  steer(message: string) {
    this.order.push(`agent:${message}`)
    this.queued = true
  }

  hasQueuedMessages() {
    return this.queued
  }

  close() {}
}

test('Worker 完成 bootstrap、运行状态与终态的有序回写', async () => {
  const fixture = workerFixture()
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.deepEqual(fixture.outbound.map((message) => message.type), ['started', 'settled'])
  assert.equal(
    fixture.outbound[1]?.type === 'settled' ? fixture.outbound[1].outcome : '',
    'completed',
  )
  assert.deepEqual(
    fixture.core.events
      .filter((event) => event.kind === 'status')
      .map((event) => nested(nested(event.payload, 'status'), 'status')),
    ['running', 'completed'],
  )
})

test('模型执行异常写入统一的 AI 助手错误文案', async () => {
  const fixture = workerFixture()
  fixture.agent.continue = async () => {
    throw new Error('provider failed')
  }
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  const errorEvent = fixture.core.events.find((event) => event.kind === 'error')
  assert.equal(nested(nested(errorEvent?.payload, 'error'), 'code'), 'AGENT_RUNTIME_EXECUTION_FAILED')
  assert.equal(
    nested(nested(errorEvent?.payload, 'error'), 'message'),
    'AI 助手执行运行时失败',
  )
  assert.deepEqual(statuses(fixture.core.events), ['running', 'failed'])
})

for (const [code, message] of [
  ['AGENT_MCP_PROTOCOL_MISMATCH', 'AI 助手与 MCP 工具服务的协议版本不兼容'],
  ['AGENT_MCP_ENDPOINT_INVALID', 'AI 助手的 MCP 工具服务地址无效'],
  ['AGENT_MCP_ENDPOINT_VIOLATION', 'AI 助手的 MCP 工具服务地址不符合本地连接要求'],
  ['AGENT_MCP_TOOL_NAME_CONFLICT', 'MCP 工具名称重复或无效，AI 助手未能启动'],
  ['AGENT_MCP_TOOL_SCHEMA_INVALID', 'MCP 工具参数定义无效，AI 助手未能启动'],
  ['AGENT_MCP_TOOLS_EMPTY', 'MCP 工具服务没有返回可用工具，AI 助手未能启动'],
]) {
  test(`MCP 连接失败 ${code} 保存安全原因且不创建模型`, async () => {
    let createCount = 0
    const fixture = workerFixture([], {
      onConnectMCP: () => { throw new Error(code) },
      onCreateAgent: () => { createCount += 1 },
    })
    fixture.runtime.handleMessage(startMessage())
    await fixture.finished

    assert.equal(createCount, 0)
    assert.deepEqual(fixture.core.events.map((event) => event.kind), ['error', 'status'])
    assert.deepEqual(nested(fixture.core.events[0]?.payload, 'error'), { code, message })
    assert.deepEqual(statuses(fixture.core.events), ['failed'])
    assert.equal(fixture.outbound.length, 1)
    assert.equal(fixture.outbound[0]?.type === 'settled' && fixture.outbound[0].outcome, 'failed')
  })
}

for (const error of [
  new Error('AGENT_MCP_TOOL_SCHEMA_INVALID: http://secret.invalid/mcp?token=private-token schema-secret'),
  { message: 'http://secret.invalid/mcp', token: 'private-token', schema: 'schema-secret' },
  'private-token',
  new Error('constructor'),
]) {
  test('未知 MCP 连接异常使用固定工具连接失败原因，不保存原始异常', async () => {
    let createCount = 0
    const fixture = workerFixture([], {
      onConnectMCP: () => { throw error },
      onCreateAgent: () => { createCount += 1 },
    })
    fixture.runtime.handleMessage(startMessage())
    await fixture.finished

    assert.equal(createCount, 0)
    assert.deepEqual(nested(fixture.core.events[0]?.payload, 'error'), {
      code: 'AGENT_MCP_CONNECTION_FAILED',
      message: 'AI 助手连接 MCP 工具服务失败，请准备或修复后重试',
    })
    const persisted = JSON.stringify([fixture.core.events, fixture.outbound])
    for (const secret of ['secret.invalid', 'private-token', 'schema-secret']) {
      assert.equal(persisted.includes(secret), false)
    }
    assert.deepEqual(statuses(fixture.core.events), ['failed'])
  })
}

test('MCP 连接期间用户取消导致连接拒绝时只保存 cancelled', async () => {
  let connecting = false
  let createCount = 0
  const fixture = workerFixture([], {
    onConnectMCP: ({ signal }) => new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('AGENT_MCP_ENDPOINT_INVALID')), { once: true })
      connecting = true
    }),
    onCreateAgent: () => { createCount += 1 },
  })
  fixture.runtime.handleMessage(startMessage())
  await waitUntil(() => connecting)
  fixture.runtime.handleMessage({ type: 'abort', run_id: 'agr_test', generation: 1 })
  await fixture.finished

  assert.equal(createCount, 0)
  assert.deepEqual(fixture.core.events.map((event) => event.kind), ['status'])
  assert.deepEqual(statuses(fixture.core.events), ['cancelled'])
  assert.equal(fixture.outbound.length, 1)
  assert.equal(fixture.outbound[0]?.type === 'settled' && fixture.outbound[0].outcome, 'cancelled')
})

test('MCP 连接成功后的模型创建异常不按工具连接错误投影', async () => {
  const fixture = workerFixture([], {
    onCreateAgent: () => { throw new Error('AGENT_MCP_TOOL_SCHEMA_INVALID') },
  })
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.deepEqual(nested(fixture.core.events[0]?.payload, 'error'), {
    code: 'AGENT_RUNTIME_EXECUTION_FAILED', message: 'AI 助手执行运行时失败',
  })
  assert.deepEqual(statuses(fixture.core.events), ['failed'])
})

test('steer 严格隔离 generation 并先持久化再交给 pi', async () => {
  const order: string[] = []
  const fixture = workerFixture(order)
  let releaseContinue: () => void = () => undefined
  fixture.agent.continueGate = new Promise<void>((resolve) => {
    releaseContinue = resolve
  })
  fixture.runtime.handleMessage(startMessage())
  await waitUntil(() => fixture.outbound.some((message) => message.type === 'started'))
  fixture.runtime.handleMessage({
    type: 'steer',
    run_id: 'agr_test',
    generation: 0,
    client_request_id: 'agsr_old_generation',
    message: '旧代消息',
  })
  fixture.runtime.handleMessage({
    type: 'steer',
    run_id: 'agr_other',
    generation: 1,
    client_request_id: 'agsr_other_run',
    message: '其他任务',
  })
  fixture.runtime.handleMessage({
    type: 'steer',
    run_id: 'agr_test',
    generation: 1,
    client_request_id: 'agsr_valid',
    message: '有效调整',
  })
  await waitUntil(() => order.length === 3)
  releaseContinue()
  fixture.agent.continueGate = null
  await fixture.finished

  assert.deepEqual(order, ['core:有效调整', 'ack:agsr_valid', 'agent:有效调整'])
  assert.equal(fixture.core.steers.length, 1)
  assert.deepEqual(fixture.outbound.find((message) => message.type === 'steer_ack'), {
    type: 'steer_ack',
    protocol_version: agentRuntimeProtocolVersion,
    run_id: 'agr_test',
    generation: 1,
    client_request_id: 'agsr_valid',
    accepted: true,
  })
})

test('bootstrap 期间取消仍消费 Ticket 并持久化 cancelled', async () => {
  const fixture = workerFixture()
  let releaseBootstrap: () => void = () => undefined
  fixture.core.bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve
  })
  fixture.runtime.handleMessage(startMessage())
  fixture.runtime.handleMessage({
    type: 'abort',
    run_id: 'agr_test',
    generation: 1,
  })
  releaseBootstrap()
  await fixture.finished

  assert.deepEqual(fixture.outbound.map((message) => message.type), ['settled'])
  assert.equal(
    fixture.outbound[0]?.type === 'settled' ? fixture.outbound[0].outcome : '',
    'cancelled',
  )
  const statuses = fixture.core.events
    .filter((event) => event.kind === 'status')
    .map((event) => nested(nested(event.payload, 'status'), 'status'))
  assert.deepEqual(statuses, ['cancelled'])
})

test('压缩失败时保留未执行的追加指令，不再次进入失败的 Agent loop', async () => {
  const fixture = workerFixture()
  let calls = 0
  fixture.agent.continue = async () => {
    calls += 1
    fixture.agent.queued = calls === 1
    return 'failed'
  }
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished
  assert.equal(calls, 1)
  assert.equal(fixture.agent.queued, true)
  assert.deepEqual(statuses(fixture.core.events), ['running', 'failed'])
})

test('bootstrap 失败通过 fatal 交给 Supervisor 收口', async () => {
  const fixture = workerFixture()
  fixture.core.bootstrapError = new Error('unavailable')
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.equal(fixture.outbound.length, 1)
  assert.deepEqual(fixture.outbound[0], {
    type: 'fatal',
    category: 'bootstrap_failed',
    protocol_version: agentRuntimeProtocolVersion,
    run_id: 'agr_test',
    generation: 1,
  })
})

test('start 前的旧 generation 控制消息不会污染首次 Run', async () => {
  const fixture = workerFixture()
  fixture.runtime.handleMessage({
    type: 'abort',
    run_id: 'agr_test',
    generation: 2,
  })
  fixture.runtime.handleMessage({
    type: 'steer',
    run_id: 'agr_old',
    generation: 1,
    client_request_id: 'agsr_before_start',
    message: '不应执行',
  })
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.equal(fixture.agent.aborted, true)
  assert.equal(fixture.core.steers.length, 0)
  assert.equal(
    fixture.outbound[1]?.type === 'settled' ? fixture.outbound[1].outcome : '',
    'completed',
  )
})

test('终态回写期间拒绝迟到 steer，避免事件落在终态之后', async () => {
  const fixture = workerFixture()
  let releaseTerminal: () => void = () => undefined
  let terminalStarted = false
  const terminalGate = new Promise<void>((resolve) => {
    releaseTerminal = resolve
  })
  fixture.core.beforeAppendEvents = async (events) => {
    const terminal = events.some((event) => event.kind === 'status'
      && nested(nested(event.payload, 'status'), 'status') === 'completed')
    if (!terminal) {
      return
    }
    terminalStarted = true
    await terminalGate
  }

  fixture.runtime.handleMessage(startMessage())
  await waitUntil(() => terminalStarted)
  fixture.runtime.handleMessage({
    type: 'steer',
    run_id: 'agr_test',
    generation: 1,
    client_request_id: 'agsr_late',
    message: '迟到调整',
  })
  releaseTerminal()
  await fixture.finished

  assert.equal(fixture.core.steers.length, 0)
  assert.equal(fixture.agent.order.includes('agent:迟到调整'), false)
  assert.deepEqual(fixture.outbound.find((message) => message.type === 'steer_ack'), {
    type: 'steer_ack',
    protocol_version: agentRuntimeProtocolVersion,
    run_id: 'agr_test',
    generation: 1,
    client_request_id: 'agsr_late',
    accepted: false,
    error_code: 'AGENT_RUNTIME_STEER_CLOSED',
  })
})

test('终态持久化后先通知主进程，再等待运行资源关闭', async () => {
  const fixture = workerFixture()
  let releaseClose: () => void = () => undefined
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve
  })
  fixture.mcp.close = async () => closeGate

  fixture.runtime.handleMessage(startMessage())
  await waitUntil(() => fixture.outbound.some((message) => message.type === 'settled'))

  assert.equal(fixture.finishedState.value, false)
  releaseClose()
  await fixture.finished
  assert.equal(fixture.finishedState.value, true)
})

test('Worker 先连接工具，再将完整上下文与冻结阈值交给请求门禁', async () => {
  const order: string[] = []
  let agentBootstrap: RuntimeBootstrap | undefined
  const fixture = workerFixture(order, {
    onConnectMCP: () => { order.push('mcp') },
    onCreateAgent: (options) => {
      order.push('agent')
      agentBootstrap = structuredClone(options.bootstrap)
      assert.equal(typeof options.commitCheckpoint, 'function')
    },
  })
  fixture.core.bootstrapValue.context = {
    estimated_tokens: 7000, warning: true,
    checkpoint: { boundary_message_sequence: 1, summary: '已提交的历史摘要', estimated_tokens: 1000 },
  }
  fixture.core.bootstrapValue.model.snapshot.context_compaction_threshold_percent = 75
  fixture.core.bootstrapValue.model.snapshot.force_context_compression = true
  fixture.core.bootstrapValue.messages = [runtimeMessage(2, '近期原文'), runtimeMessage(3, '当前请求')]
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.deepEqual(order, ['mcp', 'agent'])
  assert.equal(fixture.core.checkpoints.length, 0)
  assert.deepEqual(agentBootstrap, fixture.core.bootstrapValue)
  assert.deepEqual(statuses(fixture.core.events), ['running', 'completed'])
})

function workerFixture(order: string[] = [], options: {
  onConnectMCP?: (options: ConnectAgentMCPOptions) => void | Promise<void>
  onCreateAgent?: (options: CreatePiAgentOptions) => void
} = {}) {
  const core = new FakeCore(order)
  const agent = new FakeAgent(order)
  const outbound: AgentWorkerOutboundMessage[] = []
  let resolveFinished: () => void = () => undefined
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })
  const mcp: AgentMCPConnection = {
    tools: [],
    originalName: () => null,
    close: async () => undefined,
  }
  const finishedState = { value: false }
  const runtime = new AgentWorkerRuntime({
    core,
    connectMCP: async (connectOptions) => {
      await options.onConnectMCP?.(connectOptions)
      return mcp
    },
    createAgent: (createOptions) => {
      options.onCreateAgent?.(createOptions)
      return agent
    },
    send: (message) => {
      outbound.push(message)
      if (message.type === 'steer_ack') order.push(`ack:${message.client_request_id}`)
    },
    finish: () => {
      finishedState.value = true
      resolveFinished()
    },
  })
  return { runtime, core, agent, mcp, outbound, finished, finishedState }
}

function runtimeMessage(sequence: number, text: string): RuntimeBootstrap['messages'][number] {
  return {
    id: `agm_user_${sequence}`,
    role: 'user',
    status: 'completed',
    sequence,
    created_at: '2026-08-28T00:00:00Z',
    attachments: [],
    parts: [{
      id: `agp_user_${sequence}`,
      message_id: `agm_user_${sequence}`,
      kind: 'text',
      sequence: 1,
      content: { text: { text } },
    }],
  }
}

function statuses(events: RuntimeEventInput[]) {
  return events
    .filter((event) => event.kind === 'status')
    .map((event) => nested(nested(event.payload, 'status'), 'status'))
}

function startMessage(): AgentWorkerStartMessage {
  return {
    type: 'start',
    protocol_version: agentRuntimeProtocolVersion,
    core_base_url: 'http://127.0.0.1:52000',
    ticket: 't'.repeat(48),
    run_id: 'agr_test',
    generation: 1,
    skills: testAgentSkillBundle(),
  }
}

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
      provider_id: 'amp_provider',
      model_id: 'apm_model',
      reasoning_level: 'off',
    },
    session: { id: 'ags_test' },
    messages: [{
      id: 'agm_user',
      role: 'user',
      status: 'completed',
      sequence: 1,
      created_at: '2026-08-28T00:00:00Z',
      attachments: [],
      parts: [{
        id: 'agp_user',
        message_id: 'agm_user',
        kind: 'text',
        sequence: 1,
        content: { text: { text: 'hello' } },
      }],
    }],
    runtime_bearer: 'r'.repeat(48),
    mcp: {
      endpoint: '/mcp',
      bearer_token: 'm'.repeat(48),
      protocol_version: '2025-11-25',
    },
    model: {
      snapshot: {
        api_mode: 'responses',
        base_url: 'http://127.0.0.1:11434/v1',
        model_id: 'test-model',
        provider_id: 'amp_provider',
        provider_name: '本地 Provider',
        model_display_name: '测试模型',
        provider_revision: 3,
        model_revision: 5,
        context_window_tokens: 8192,
        max_output_tokens: 1024,
        supports_images: false,
        reasoning_control: 'none',
        supported_reasoning_levels: ['off'],
      },
    },
    context: { estimated_tokens: 1280, warning: false },
  }
}

function nested(value: unknown, key: string) {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  return (value as Record<string, unknown>)[key]
}

async function waitUntil(condition: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('等待测试条件超时')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
