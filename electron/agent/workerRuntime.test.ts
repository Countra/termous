import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { AgentMCPConnection } from './mcpClientAdapter.ts'
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
  RuntimeContextCheckpoint,
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
    return this.lastSequence
  }

  async commitCheckpoint(
    _start: AgentWorkerStartMessage,
    _runtimeBearer: string,
    input: RuntimeCheckpointInput,
    signal?: AbortSignal,
  ): Promise<RuntimeContextCheckpoint> {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    this.checkpoints.push(input)
    return {
      boundary_message_sequence: input.boundary_message_sequence,
      summary: input.summary,
      estimated_tokens: 7000,
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

test('上下文摘要成功后提交 Checkpoint，再连接 MCP 并只保留边界后的消息', async () => {
  const order: string[] = []
  let agentBootstrap: RuntimeBootstrap | undefined
  const fixture = workerFixture(order, {
    summarizeContext: async () => {
      order.push('summary')
      return '压缩后的历史'
    },
    onConnectMCP: () => order.push('mcp'),
    onCreateAgent: (options) => {
      agentBootstrap = structuredClone(options.bootstrap)
    },
  })
  fixture.core.bootstrapValue.context = {
    estimated_tokens: 7000,
    warning: true,
    compression: {
      boundary_message_sequence: 1,
      source_hash: 'a'.repeat(64),
      estimated_tokens: 7000,
    },
  }
  fixture.core.bootstrapValue.messages = [
    runtimeMessage(1, '旧历史'),
    runtimeMessage(2, '当前请求'),
  ]

  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.deepEqual(order.slice(0, 2), ['summary', 'mcp'])
  assert.equal(fixture.core.checkpoints.length, 1)
  assert.equal(fixture.core.checkpoints[0]?.generation, 1)
  assert.deepEqual(agentBootstrap?.messages.map(({ sequence }) => sequence), [2])
  assert.equal(agentBootstrap?.context.checkpoint?.summary, '压缩后的历史')
  assert.equal(agentBootstrap?.context.compression, undefined)
})

test('上下文摘要失败时不连接 MCP，并以 failed 收口当前 Run', async () => {
  let mcpConnected = false
  const fixture = workerFixture([], {
    summarizeContext: async () => { throw new Error('summary failed') },
    onConnectMCP: () => { mcpConnected = true },
  })
  fixture.core.bootstrapValue.context = compressionContext()

  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.equal(mcpConnected, false)
  assert.equal(fixture.core.checkpoints.length, 0)
  assert.deepEqual(statuses(fixture.core.events), ['failed'])
})

test('上下文摘要返回空值时按压缩失败而非取消收口', async () => {
  let connectCount = 0
  const fixture = workerFixture([], {
    summarizeContext: async () => undefined,
    onConnectMCP: () => { connectCount += 1 },
  })
  fixture.core.bootstrapValue.context = compressionContext()
  fixture.runtime.handleMessage(startMessage())
  await fixture.finished

  assert.equal(connectCount, 0)
  assert.equal(fixture.core.checkpoints.length, 0)
  assert.deepEqual(statuses(fixture.core.events), ['failed'])
})

test('上下文摘要期间取消时不提交 Checkpoint，也不连接 MCP', async () => {
  let mcpConnected = false
  let summaryStarted = false
  const fixture = workerFixture([], {
    summarizeContext: async (_bootstrap, signal) => await new Promise<string>((_resolve, reject) => {
      summaryStarted = true
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    }),
    onConnectMCP: () => { mcpConnected = true },
  })
  fixture.core.bootstrapValue.context = compressionContext()
  fixture.runtime.handleMessage(startMessage())
  await waitUntil(() => summaryStarted)
  fixture.runtime.handleMessage({ type: 'abort', run_id: 'agr_test', generation: 1 })
  await fixture.finished

  assert.equal(mcpConnected, false)
  assert.equal(fixture.core.checkpoints.length, 0)
  assert.deepEqual(statuses(fixture.core.events), ['cancelled'])
})

function workerFixture(order: string[] = [], options: {
  summarizeContext?: (bootstrap: RuntimeBootstrap, signal: AbortSignal) => Promise<string | undefined>
  onConnectMCP?: () => void
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
    connectMCP: async () => {
      options.onConnectMCP?.()
      return mcp
    },
    createAgent: (createOptions) => {
      options.onCreateAgent?.(createOptions)
      return agent
    },
    summarizeContext: options.summarizeContext ?? (async () => '压缩后的历史'),
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

function compressionContext(): RuntimeBootstrap['context'] {
  return {
    estimated_tokens: 7000,
    warning: true,
    compression: {
      boundary_message_sequence: 1,
      source_hash: 'a'.repeat(64),
      estimated_tokens: 7000,
    },
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
        supports_reasoning: false,
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
