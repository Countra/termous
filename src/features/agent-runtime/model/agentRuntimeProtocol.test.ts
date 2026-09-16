import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AgentRuntimeProtocolError,
  decodeAgentAttachment,
  decodeAgentMessage,
  decodeAgentMessagePage,
  decodeAgentQueuedTurn,
  decodeAgentQueuedTurnMoveResult,
  decodeAgentQueuedTurnPage,
  decodeAgentRunEventPage,
  decodeAgentSession,
  decodeAgentSessionContext,
  decodeAgentSessionUsage,
  decodeAgentWorkspaceEvent,
} from './agentRuntimeProtocol.ts'
import {
  agentFixtureTime,
  agentRunFixture,
  agentSessionFixture,
} from './agentRuntimeTestFixtures.ts'

test('Agent 会话严格解码可信 SSH 资源绑定', () => {
  const session = decodeAgentSession({
    ...agentSessionFixture(),
    resource_binding: {
      kind: 'ssh_session',
      session_id: 'ses-one',
      host_id: 'host-one',
      ssh_profile_id: 'ssh-one',
      host_name: 'Production',
      platform: 'linux',
      bound_at: agentFixtureTime,
    },
  })
  assert.equal(session.resource_bindings?.find((binding) => binding.kind === 'ssh_session')?.session_id, 'ses-one')
  assert.throws(() => decodeAgentSession({
    ...agentSessionFixture(),
    resource_binding: {
      ...session.resource_bindings?.find((binding) => binding.kind === 'ssh_session'),
      kind: 'file_session',
    },
  }), /绑定类型无效/)
})

test('Agent 双资源集合在 HTTP 和 Workspace 事件中采用同一合同', () => {
  const bindings = [{
    kind: 'ssh_session', session_id: 'ses-one', host_id: 'host-one', ssh_profile_id: 'ssh-one',
    host_name: 'Production', platform: 'linux', bound_at: agentFixtureTime,
  }, {
    kind: 'file_profile', file_access_profile_id: 'file-one', file_access_profile_name: '应用文件',
    host_id: 'host-two', ssh_profile_id: 'ssh-two', host_name: 'Files', engine: 'sftp', bound_at: agentFixtureTime,
  }]
  const response = { ...agentSessionFixture(), resource_bindings: bindings, resource_binding: bindings[0] }
  const session = decodeAgentSession(response)
  assert.deepEqual(session.resource_bindings, bindings)
  assert.equal('resource_binding' in session, false)

  const event = decodeAgentWorkspaceEvent({ type: 'upsert', revision: 2, session: response })
  assert.equal(event.type, 'upsert')
  assert.deepEqual(event.type === 'upsert' ? event.session?.resource_bindings : undefined, bindings)
  assert.deepEqual(decodeAgentSession({ ...response, resource_bindings: [] }).resource_bindings, [])
})

test('Agent 资源集合拒绝重复槽位、超过容量和混合身份字段', () => {
  const file = {
    kind: 'file_profile', file_access_profile_id: 'file-one', file_access_profile_name: '应用文件',
    host_id: 'host-one', ssh_profile_id: 'ssh-one', host_name: 'Production', engine: 'sftp', bound_at: agentFixtureTime,
  }
  const decode = (bindings: unknown) => decodeAgentSession({ ...agentSessionFixture(), resource_bindings: bindings })
  assert.throws(() => decode([file, { ...file, file_access_profile_id: 'file-two' }]), /绑定槽位重复/)
  assert.throws(() => decode([{
    kind: 'ssh_session', session_id: 'session-one', host_id: 'host-one', ssh_profile_id: 'ssh-one',
    host_name: 'Production', platform: 'linux', bound_at: agentFixtureTime,
  }, {
    kind: 'ssh_profile', ssh_profile_id: 'ssh-two', ssh_profile_name: '备用配置', host_id: 'host-two',
    host_name: 'Staging', platform: 'linux', bound_at: agentFixtureTime,
  }]), /绑定槽位重复/)
  assert.throws(() => decode([file, file, file]), /绑定集合无效/)
  assert.throws(() => decode(null), /绑定集合无效/)
  assert.throws(() => decode([{ ...file, session_id: 'original-file-tab' }]), /文件引用包含 SSH 身份/)
  const unknownEngineBinding = decode([{ ...file, engine: 'object-store' }]).resource_bindings?.[0]
  assert.equal(unknownEngineBinding?.kind, 'file_profile')
  assert.equal(unknownEngineBinding?.kind === 'file_profile' ? unknownEngineBinding.engine : '', 'object-store')
  assert.throws(() => decode([{ ...file, engine: '' }]), /文件引擎无效/)
  assert.throws(() => decode([{ ...file, file_access_profile_id: '' }]), /文件 Profile ID 无效/)
})

test('Agent 资源绑定接受 Host 领域允许的多字节长名称', () => {
  const hostName = '生产环境主机'.repeat(13)
  assert.equal(new TextEncoder().encode(hostName).byteLength > 200, true)
  const session = decodeAgentSession({
    ...agentSessionFixture(),
    resource_binding: {
      kind: 'ssh_session',
      session_id: 'ses-one',
      host_id: 'host-one',
      ssh_profile_id: 'ssh-one',
      host_name: hostName,
      platform: 'linux',
      bound_at: agentFixtureTime,
    },
  })

  assert.equal(session.resource_bindings?.find((binding) => binding.kind === 'ssh_session')?.host_name, hostName)
})

test('工作区协议接受 Core 新实例的 revision 0 权威快照', () => {
  const event = decodeAgentWorkspaceEvent({
    type: 'snapshot',
    revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [agentRunFixture()],
  })

  assert.equal(event.type, 'snapshot')
  assert.equal(event.revision, 0)
  assert.equal(event.type === 'snapshot' ? event.active_runs[0]?.model_snapshot.model_id : '', 'test-model')
})

test('Run 与模型快照必须归属于同一 Provider', () => {
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot',
    revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [agentRunFixture({ provider_id: 'apv-other' })],
  }), /Provider 归属不一致/)
})

test('Run 推理档位必须由快照明确支持且能力字段保持一致', () => {
  const run = agentRunFixture()
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot', revision: 0, sessions: [agentSessionFixture()],
    active_runs: [{
      ...run,
      reasoning_level: 'high',
      model_snapshot: {
        ...run.model_snapshot,
        supported_reasoning_levels: ['off', 'medium'],
      },
    }],
  }), /不受模型快照支持/)

  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot', revision: 0, sessions: [agentSessionFixture()],
    active_runs: [{
      ...run,
      model_snapshot: {
        ...run.model_snapshot,
        reasoning_control: 'none',
        supported_reasoning_levels: ['off', 'medium'],
        supports_reasoning: false,
      },
    }],
  }), /推理控制与支持级别不一致/)

  const maximum = decodeAgentWorkspaceEvent({
    type: 'snapshot', revision: 0, sessions: [agentSessionFixture()],
    active_runs: [{
      ...run,
      reasoning_level: 'max',
      model_snapshot: {
        ...run.model_snapshot,
        supported_reasoning_levels: ['off', 'medium', 'max'],
      },
    }],
  })
  assert.equal(
    maximum.type === 'snapshot' ? maximum.active_runs[0]?.reasoning_level : undefined,
    'max',
  )

  const highOnly = decodeAgentWorkspaceEvent({
    type: 'snapshot', revision: 0, sessions: [agentSessionFixture()],
    active_runs: [{
      ...run,
      reasoning_level: 'high',
      model_snapshot: {
        ...run.model_snapshot,
        supported_reasoning_levels: ['high', 'max'],
      },
    }],
  })
  assert.deepEqual(
    highOnly.type === 'snapshot'
      ? highOnly.active_runs[0]?.model_snapshot.supported_reasoning_levels
      : undefined,
    ['high', 'max'],
  )

  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot', revision: 0, sessions: [agentSessionFixture()],
    active_runs: [{
      ...run,
      reasoning_level: 'off',
      model_snapshot: {
        ...run.model_snapshot,
        supported_reasoning_levels: ['off'],
      },
    }],
  }), /至少一个推理档位/)
})

test('Run usage 要求缓存读写明细并校验完整分类和', () => {
  const run = agentRunFixture()
  const missingCacheRead = { ...run.usage } as Record<string, unknown>
  delete missingCacheRead.cache_read_tokens
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [{ ...run, usage: missingCacheRead }],
  }), /cache read token/)

  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [{
      ...run,
      usage: {
        ...run.usage,
        input_tokens: Number.MAX_SAFE_INTEGER,
        cache_read_tokens: 1,
        total_tokens: Number.MAX_SAFE_INTEGER,
      },
    }],
  }), /total token/)
})

test('工作区 upsert 严格要求一个实体且增量 revision 必须递增起步', () => {
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'upsert', revision: 1,
  }), AgentRuntimeProtocolError)
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'upsert', revision: 1,
    session: agentSessionFixture(),
    run: agentRunFixture(),
  }), AgentRuntimeProtocolError)
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'removed', revision: 0, entity: 'session', id: 'ags-session',
  }), AgentRuntimeProtocolError)
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'removed', revision: 1, entity: 'queued_turn', id: 'agq-turn',
  }), /缺少 Session ID/)

  const event = decodeAgentWorkspaceEvent({
    type: 'upsert', revision: 1, session: agentSessionFixture(),
  })
  assert.equal(event.type === 'upsert' ? event.session?.id : '', 'ags-session')
})

test('公开 reasoning 拒绝 thinking signature', () => {
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'upsert',
    revision: 1,
    message: messageResponse({
      parts: [partResponse('reasoning', {
        reasoning: { text: '分析', thinking_signature: 'private-signature' },
      })],
    }),
  }), /thinking signature/)
})

test('message delta 必须声明 text 或 reasoning 类型', () => {
  const valid = decodeAgentWorkspaceEvent({
    type: 'upsert', revision: 1,
    run_event: runEventResponse(1, 'message_delta', {
      message_delta: {
        message_id: 'agm-assistant', part_id: 'agp-text', kind: 'text', delta: '内容',
      },
    }),
  })
  assert.equal(
    valid.type === 'upsert' && valid.run_event?.kind === 'message_delta'
      ? valid.run_event.payload.message_delta.kind
      : '',
    'text',
  )

  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'upsert', revision: 1,
    run_event: runEventResponse(1, 'message_delta', {
      message_delta: {
        message_id: 'agm-assistant', part_id: 'agp-text', delta: '内容',
      },
    }),
  }), /片段类型/)
})

test('消息协议投影附件与结构化来源上下文', () => {
  const message = decodeAgentMessage(messageResponse({
    role: 'user',
    status: 'completed',
    sequence: 1,
    attachments: [attachmentResponse()],
    parts: [partResponse('text', {
      text: {
        text: '请检查此连接',
        source_context: {
          kind: 'workbench',
          entity_id: 'host-one',
          title: '生产主机',
          summary: 'SSH 连接已断开',
        },
      },
    })],
  }))

  assert.equal(message.attachments[0]?.original_name, 'diagnostic.txt')
  assert.equal(message.parts[0]?.kind === 'text' ? message.parts[0].source_context?.entity_id : '', 'host-one')
  assert.throws(() => decodeAgentMessage(messageResponse({
    attachments: [attachmentResponse({ session_id: 'ags-other' })],
  })), /附件归属/)
})

test('消息协议仅允许终态 Agent 回复携带唯一的本轮 Token 用量', () => {
  const usage = {
    input_tokens: 120,
    cache_read_tokens: 30,
    cache_write_tokens: 10,
    output_tokens: 40,
    reasoning_tokens: 8,
    total_tokens: 200,
    estimated: false,
  }
  const message = decodeAgentMessage(messageResponse({
    status: 'completed',
    turn_usage: { run_id: 'agr-run', usage, error_code: 'AGENT_RUN_STEERED' },
  }))

  assert.deepEqual(message.turn_usage, { run_id: 'agr-run', usage, error_code: 'AGENT_RUN_STEERED' })
  assert.throws(() => decodeAgentMessage(messageResponse({
    role: 'user',
    status: 'completed',
    turn_usage: { run_id: 'agr-run', usage },
  })), /只有 Agent 回复/)
  assert.throws(() => decodeAgentMessage(messageResponse({
    status: 'streaming',
    turn_usage: { run_id: 'agr-run', usage },
  })), /流式回复/)
  assert.throws(() => decodeAgentMessagePage({
    items: [
      messageResponse({
        id: 'agm-assistant-one', sequence: 1, status: 'completed',
        turn_usage: { run_id: 'agr-run', usage },
      }),
      messageResponse({
        id: 'agm-assistant-two', sequence: 2, status: 'completed',
        turn_usage: { run_id: 'agr-run', usage },
      }),
    ],
  }), /重复的本轮 Run/)
})

test('历史本轮时间兼容旧响应和未开始取消，拒绝无效时间而不依赖 Token 数量', () => {
  const usage = agentRunFixture().usage
  const completedAt = '2026-08-29T00:00:02.400Z'
  const decode = (timing: Record<string, unknown>) => decodeAgentMessage(messageResponse({
    status: 'interrupted',
    turn_usage: { run_id: 'agr-run', usage, ...timing },
  })).turn_usage

  assert.deepEqual(decode({}), { run_id: 'agr-run', usage })
  assert.deepEqual(decode({ started_at: agentFixtureTime, completed_at: completedAt }), {
    run_id: 'agr-run', usage, started_at: agentFixtureTime, completed_at: completedAt,
  })
  assert.equal(decode({ completed_at: completedAt })?.started_at, undefined)
  assert.equal(decode({ completed_at: completedAt })?.completed_at, completedAt)
  for (const field of ['started_at', 'completed_at']) {
    for (const value of ['', 'invalid', null, 0, '999999-01-01T00:00:00Z']) {
      assert.throws(() => decode({ [field]: value }), AgentRuntimeProtocolError)
    }
  }
})

test('附件协议拒绝无效大小与未知状态', () => {
  assert.equal(decodeAgentAttachment(attachmentResponse()).kind, 'text')
  assert.equal(decodeAgentAttachment(attachmentResponse({ state: 'reserved' })).state, 'reserved')
  assert.throws(() => decodeAgentAttachment(attachmentResponse({ size_bytes: 0 })), /大小/)
  assert.throws(() => decodeAgentAttachment(attachmentResponse({ state: 'pending' })), /状态/)
  assert.throws(() => decodeAgentAttachment(attachmentResponse({ state: 'unknown' })), /状态/)
})

test('附件协议保留终端引用来源并拒绝元数据类型与日期不一致', () => {
  const origin = { kind: 'terminal_selection', source_session_id: 'ses_one', host_name: '主机', captured_at: agentFixtureTime, line_count: 2 }
  assert.deepEqual(decodeAgentAttachment(attachmentResponse({ origin })).origin, origin)
  assert.equal(decodeAgentAttachment(attachmentResponse()).origin, undefined)
  for (const patch of [
    { origin: { ...origin, captured_at: '2026-02-30T00:00:00Z' } },
    { origin: { ...origin, source_session_id: 'bad/id' } },
    { origin: { ...origin, line_count: 0 } },
    { origin, kind: 'image' },
    { origin, mime_type: 'application/json' },
  ]) assert.throws(() => decodeAgentAttachment(attachmentResponse(patch)), AgentRuntimeProtocolError)
})

test('排队消息 Prompt 与 Core 统一使用 1 MiB UTF-8 上限', () => {
  const prompt = 'a'.repeat(1 << 20)
  assert.equal(decodeAgentQueuedTurn(queuedTurnResponse({ prompt })).prompt.length, prompt.length)
  assert.throws(
    () => decodeAgentQueuedTurn(queuedTurnResponse({ prompt: `${prompt}a` })),
    /排队消息内容无效/,
  )
})

test('排队消息列表与工作区快照拒绝重复顺序和跨会话队列状态', () => {
  const first = queuedTurnResponse({ id: 'agq-first', queue_sequence: 1 })
  const duplicateSequence = queuedTurnResponse({ id: 'agq-second', queue_sequence: 1 })
  assert.throws(
    () => decodeAgentQueuedTurnPage({ items: [first, duplicateSequence] }),
    /重复 sequence/,
  )
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot',
    revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [],
    queued_turns: [first, duplicateSequence],
  }), /重复 sequence/)
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'snapshot',
    revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [],
    queued_turns: [first],
    queue_state: {
      session_id: 'ags-other',
      state: 'running',
      revision: 1,
    },
  }), /快照归属无效/)
})

test('排队消息移动响应严格校验顺序、revision 与更新时间', () => {
  const first = {
    id: 'agq-first', queue_sequence: 1, revision: 2, updated_at: agentFixtureTime,
  }
  const second = {
    id: 'agq-second', queue_sequence: 2, revision: 3, updated_at: agentFixtureTime,
  }

  assert.deepEqual(decodeAgentQueuedTurnMoveResult({ items: [first, second] }), {
    items: [first, second],
  })
  assert.deepEqual(decodeAgentQueuedTurnMoveResult({ items: [] }), { items: [] })
  assert.throws(
    () => decodeAgentQueuedTurnMoveResult({ items: [first, { ...second, id: first.id }] }),
    /重复 ID/,
  )
  assert.throws(
    () => decodeAgentQueuedTurnMoveResult({ items: [first, { ...second, queue_sequence: 1 }] }),
    /重复 sequence/,
  )
  assert.throws(
    () => decodeAgentQueuedTurnMoveResult({ items: [second, first] }),
    /sequence 无序/,
  )
  assert.throws(
    () => decodeAgentQueuedTurnMoveResult({ items: [{ ...first, revision: 0 }] }),
    /revision 无效/,
  )
  assert.throws(
    () => decodeAgentQueuedTurnMoveResult({ items: [{ ...first, updated_at: 'invalid' }] }),
    /时间无效/,
  )
})

test('会话上下文协议严格校验归属、容量和 Checkpoint', () => {
  const context = decodeAgentSessionContext({
    session_id: 'ags-session',
    estimated_tokens: 23_000,
    context_window_tokens: 32_768,
    estimated: true,
    warning: true,
    compression_available: true,
    checkpoint: {
      boundary_message_sequence: 12,
      estimated_tokens: 18_000,
      created_at: agentFixtureTime,
    },
  }, 'ags-session')

  assert.equal(context.checkpoint?.boundary_message_sequence, 12)
  assert.equal(decodeAgentSessionContext({
    ...context,
    checkpoint: undefined,
  }, 'ags-session').checkpoint, undefined)
  assert.throws(() => decodeAgentSessionContext({
    ...context,
    session_id: 'ags-other',
  }, 'ags-session'), /归属/)
  assert.throws(() => decodeAgentSessionContext({
    ...context,
    estimated_tokens: -1,
  }), /Token/)
  assert.throws(() => decodeAgentSessionContext({
    ...context,
    checkpoint: { ...context.checkpoint, created_at: 'not-a-time' },
  }), /创建时间/)
})

test('上下文协议兼容旧字段，并严格保留模型评估状态、估算来源和原模型参考', () => {
  const legacy = {
    session_id: 'ags-session', estimated_tokens: 0, context_window_tokens: 200_000,
    estimated: true, warning: false, compression_available: false,
  }
  assert.deepEqual(decodeAgentSessionContext(legacy), legacy)
  const pending = {
    ...legacy, model_id: 'apm-next', assessment: 'pending', compression_status: 'unknown',
    last_snapshot: { model_id: 'apm-old', model_name: 'GPT', estimated_tokens: 75_000, context_window_tokens: 100_000, basis: 'provider_usage' },
  }
  assert.deepEqual(decodeAgentSessionContext(pending), pending)
  for (const basis of ['pi_estimate', 'provider_usage']) {
    const ready = { ...legacy, model_id: 'apm-next', assessment: 'ready', basis, compression_status: 'unavailable' }
    assert.deepEqual(decodeAgentSessionContext(ready), ready)
    const event = decodeAgentWorkspaceEvent({
      type: 'upsert', revision: 1, run_event: {
        id: 'are-one', run_id: 'agr-run', generation: 1, sequence: 1, kind: 'context_usage',
        created_at: agentFixtureTime, payload: { context_usage: { ...legacy, basis, compression_status: 'unknown' } },
      },
    })
    assert.equal(event.type, 'upsert')
    assert.equal(event.type === 'upsert' && event.run_event?.kind === 'context_usage'
      && event.run_event.payload.context_usage.basis, basis)
  }
  for (const patch of [
    { estimated_tokens: undefined }, { estimated_tokens: null }, { estimated_tokens: 1 },
    { assessment: 'invalid' }, { basis: 'invalid' }, { basis: 'pi_estimate' }, { basis: 'provider_usage' }, { warning: true },
    { compression_status: 'available' }, { compression_status: 'unavailable' },
    { last_snapshot: { ...pending.last_snapshot, context_window_tokens: 0 } },
    { last_snapshot: { ...pending.last_snapshot, model_id: '' } },
    { last_snapshot: { ...pending.last_snapshot, estimated_tokens: -1 } },
  ]) assert.throws(() => decodeAgentSessionContext({ ...pending, ...patch }))
  assert.throws(() => decodeAgentSessionContext({ ...legacy, compression_status: 'available' }))
  assert.throws(() => decodeAgentSessionContext({ ...legacy, compression_available: true, compression_status: 'unknown' }))
})

test('会话 Token 统计严格校验归属和聚合关系', () => {
  const response = {
    session_id: 'ags-session',
    run_count: 3,
    input_tokens: 1_200,
    output_tokens: 320,
    cache_read_tokens: 80,
    cache_write_tokens: 20,
    reasoning_tokens: 80,
    total_tokens: 1_620,
    estimated: false,
    updated_at: agentFixtureTime,
  }

  const usage = decodeAgentSessionUsage(response, 'ags-session')
  assert.equal(usage.total_tokens, 1_620)
  assert.equal(usage.updated_at, agentFixtureTime)
  assert.throws(() => decodeAgentSessionUsage({
    ...response, session_id: 'ags-other',
  }, 'ags-session'), /归属/)
  assert.throws(() => decodeAgentSessionUsage({
    ...response, run_count: Number.MAX_SAFE_INTEGER + 1,
  }), /Run 数量/)
  assert.throws(() => decodeAgentSessionUsage({
    ...response, cache_read_tokens: Number.MAX_SAFE_INTEGER + 1,
  }), /cache read token/)
  assert.throws(() => decodeAgentSessionUsage({
    ...response, cache_write_tokens: Number.MAX_SAFE_INTEGER + 1,
  }), /cache write token/)
  assert.throws(() => decodeAgentSessionUsage({
    ...response, reasoning_tokens: 321,
  }), /reasoning token/)
  assert.throws(() => decodeAgentSessionUsage({
    ...response, total_tokens: 1_619,
  }), /total token/)
  assert.throws(() => decodeAgentSessionUsage({
    ...response,
    input_tokens: Number.MAX_SAFE_INTEGER,
    output_tokens: 1,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: Number.MAX_SAFE_INTEGER,
  }), /total token/)
})

test('Run Event 补偿页拒绝跨 Run、跨 generation 和 sequence 缺口', () => {
  const first = runEventResponse(1, 'status', { status: { status: 'running' } })
  const second = runEventResponse(2, 'status', { status: { status: 'running' } })
  assert.equal(decodeAgentRunEventPage({ items: [first, second] }).items.length, 2)

  assert.throws(() => decodeAgentRunEventPage({
    items: [first, { ...second, sequence: 3 }],
  }), /不连续/)
  assert.throws(() => decodeAgentRunEventPage({
    items: [first, { ...second, run_id: 'agr-other' }],
  }), /归属/)
  assert.throws(() => decodeAgentRunEventPage({
    items: [first, { ...second, generation: 2 }],
  }), /归属/)
})

test('steer_applied 在实时与 HTTP 补偿页使用相同严格分支，兼容旧 steer 事件', () => {
  const received = runEventResponse(1, 'steer', {
    steer: { client_request_id: 'request-steer', message_id: 'agm-steer', part_id: 'agp-steer' },
  })
  const applied = runEventResponse(2, 'steer_applied', {
    steer_applied: { message_id: 'agm-steer', part_id: 'agp-steer' },
  })
  const live = decodeAgentWorkspaceEvent({ type: 'upsert', revision: 1, run_event: applied })
  assert.equal(live.type === 'upsert' && live.run_event?.kind, 'steer_applied')
  assert.deepEqual(decodeAgentRunEventPage({ items: [received, applied] }).items.map(({ kind }) => kind), ['steer', 'steer_applied'])
  for (const payload of [
    { steer_applied: { message_id: 'agm-steer' } },
    { steer_applied: { message_id: '', part_id: 'agp-steer' } },
    { ...applied.payload, steer: received.payload.steer },
  ]) {
    assert.throws(() => decodeAgentRunEventPage({ items: [{ ...applied, payload }] }), AgentRuntimeProtocolError)
  }
})

function messageResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agm-assistant',
    session_id: 'ags-session',
    role: 'assistant',
    status: 'streaming',
    sequence: 2,
    revision: 2,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    parts: [],
    ...overrides,
  }
}

function partResponse(kind: string, content: Record<string, unknown>) {
  return {
    id: 'agp-part',
    message_id: 'agm-assistant',
    kind,
    sequence: 1,
    content,
    revision: 1,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
  }
}

function attachmentResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aga-attachment',
    session_id: 'ags-session',
    original_name: 'diagnostic.txt',
    mime_type: 'text/plain',
    kind: 'text',
    size_bytes: 10,
    state: 'bound',
    revision: 1,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    ...overrides,
  }
}

function queuedTurnResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agq-turn',
    session_id: 'ags-session',
    client_request_id: 'request-turn',
    queue_sequence: 1,
    prompt: '检查主机',
    model_id: 'apm-model',
    reasoning_level: 'medium',
    force_context_compression: false,
    state: 'queued',
    editing: false,
    revision: 1,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    attachments: [],
    ...overrides,
  }
}

function runEventResponse(sequence: number, kind: string, payload: Record<string, unknown>) {
  return {
    id: `age-${sequence}`,
    run_id: 'agr-run',
    generation: 1,
    sequence,
    kind,
    payload,
    created_at: agentFixtureTime,
  }
}
