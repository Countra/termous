import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AgentRuntimeProtocolError,
  decodeAgentAttachment,
  decodeAgentMessage,
  decodeAgentRunEventPage,
  decodeAgentSessionContext,
  decodeAgentWorkspaceEvent,
} from './agentRuntimeProtocol.ts'
import {
  agentFixtureTime,
  agentRunFixture,
  agentSessionFixture,
} from './agentRuntimeTestFixtures.ts'

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

test('附件协议拒绝无效大小与未知状态', () => {
  assert.equal(decodeAgentAttachment(attachmentResponse()).kind, 'text')
  assert.throws(() => decodeAgentAttachment(attachmentResponse({ size_bytes: 0 })), /大小/)
  assert.throws(() => decodeAgentAttachment(attachmentResponse({ state: 'unknown' })), /状态/)
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
