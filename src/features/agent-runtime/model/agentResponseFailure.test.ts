import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessagePart, AgentRunEvent } from '#entities/agent'
import { decodeAgentMessage, decodeAgentMessagePage, decodeAgentMessagePart, decodeAgentRunEvent } from './agentRuntimeProtocol.ts'
import { applyAgentWorkspaceEvent, createAgentWorkspaceState, mergeAgentMessages, replaceAgentMessages, type AgentWorkspaceState } from './agentWorkspaceState.ts'
import { agentDeltaEventFixture, agentFixtureTime, agentMessageFixture, agentRunFixture, agentSessionFixture, agentTextPartFixture } from './agentRuntimeTestFixtures.ts'

const failure = { attempt_id: 'attempt-one', error_message: '  upstream failure\n第二行\t详情  ' }
const failedPart = agentTextPartFixture({ text: '保留的失败正文', revision: 2, response_failure: failure })

function wirePart(kind = 'text', responseFailure: unknown = failure) {
  const body = kind === 'tool_call' ? { tool_call_id: 'call-one', tool_name: 'shell', arguments: {} }
    : kind === 'tool_result' ? { tool_call_id: 'call-one', tool_name: 'shell', content: {}, is_error: false }
      : { text: '正文' }
  return { id: 'agp-text', message_id: 'agm-assistant', sequence: 1, revision: 2,
    created_at: agentFixtureTime, updated_at: agentFixtureTime, kind,
    content: { [kind]: body, ...(responseFailure === undefined ? {} : { response_failure: responseFailure }) } }
}

function partEvent(sequence: number, part: AgentMessagePart = failedPart): Extract<AgentRunEvent, { kind: 'message_part' }> {
  return { id: `part-event-${sequence}`, run_id: 'agr-run', generation: 1, sequence,
    created_at: agentFixtureTime, kind: 'message_part', payload: { message_part: part } }
}

function initialState(): AgentWorkspaceState {
  return { ...applyAgentWorkspaceEvent(createAgentWorkspaceState(), {
    type: 'snapshot', revision: 0, sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  }).state, messages: { 'ags-session': [agentMessageFixture()] } }
}

test('失败标记在文本、思考和工具调用的 HTTP 历史及 WS 片段中保留原文', () => {
  for (const kind of ['text', 'reasoning', 'tool_call']) {
    const part = wirePart(kind)
    const message = decodeAgentMessage({ ...agentMessageFixture(), parts: [part] })
    assert.deepEqual(message.parts[0]?.response_failure, failure)
    const event = decodeAgentRunEvent({ ...partEvent(1), payload: { message_part: part } })
    assert.deepEqual(event.kind === 'message_part' && event.payload.message_part.response_failure, failure)
    const page = decodeAgentMessagePage({ items: [{ ...agentMessageFixture({ status: 'failed' }), parts: [part] }] })
    assert.deepEqual(page.items[0]?.parts[0]?.response_failure, failure)
  }
  const legacy = wirePart()
  delete (legacy.content as Record<string, unknown>).response_failure
  assert.equal(decodeAgentMessagePart(legacy).response_failure, undefined)
  assert.equal(decodeAgentMessagePart(wirePart('text', { ...failure, error_message: '' })).response_failure?.error_message, '')
})

test('失败标记按 UTF-8 限制原文长度，拒绝工具结果、用户消息及非法结构', () => {
  assert.equal(decodeAgentMessagePart(wirePart('text', { ...failure, error_message: 'a'.repeat(4096) })).response_failure?.error_message.length, 4096)
  for (const value of [null, {}, { ...failure, attempt_id: '' }, { ...failure, attempt_id: 1 },
    { ...failure, attempt_id: 'a'.repeat(129) }, { ...failure, error_message: null },
    { ...failure, error_message: 'a'.repeat(4097) }, { ...failure, error_message: '错'.repeat(1366) }]) {
    assert.throws(() => decodeAgentMessagePart(wirePart('text', value)))
  }
  assert.throws(() => decodeAgentMessagePart(wirePart('tool_result')), /工具结果不得携带/)
  assert.throws(() => decodeAgentMessage({ ...agentMessageFixture({ role: 'user' }), parts: [wirePart()] }), /只有 Agent 回复消息/)
})

test('流式失败片段冻结，新请求新片段独立累计，迟到旧 delta 不污染失败正文', () => {
  let state = initialState()
  const events: AgentRunEvent[] = [agentDeltaEventFixture(), partEvent(2),
    { ...agentDeltaEventFixture(), id: 'new-delta', sequence: 3,
      payload: { message_delta: { message_id: 'agm-assistant', part_id: 'agp-new', kind: 'text', delta: '新的回答' } } },
    { ...agentDeltaEventFixture(), id: 'late-delta', sequence: 4 }]
  for (const event of events) {
    state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: event.sequence, run_event: event }).state
  }
  const parts = state.messages['ags-session']![0]!.parts
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[0], failedPart)
  assert.equal(parts[1]?.kind === 'text' && parts[1].text, '新的回答')
  assert.equal(state.run_event_sequences['agr-run'], 4)
  assert.equal(state.run_part_overlays['agr-run']?.['agp-text'], undefined)
})

test('同版本消息合并和重连分页不抹掉失败片段，历史领先时旧完整片段也不能回退', () => {
  let state = initialState()
  state = mergeAgentMessages(state, 'ags-session', [agentMessageFixture({ parts: [failedPart] })])
  assert.deepEqual(state.messages['ags-session']![0]!.parts, [failedPart])
  state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1,
    run_event: partEvent(1, agentTextPartFixture({ text: '旧的正文' })) }).state
  assert.deepEqual(state.messages['ags-session']![0]!.parts, [failedPart])
  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture({ parts: [agentTextPartFixture()] })])
  assert.deepEqual(state.messages['ags-session']![0]!.parts, [failedPart])
  state = replaceAgentMessages({ ...state, run_events: {} }, 'ags-session', [agentMessageFixture({ revision: 3 })])
  assert.deepEqual(state.messages['ags-session']![0]!.parts, [failedPart])
  state = mergeAgentMessages(state, 'ags-session', [agentMessageFixture({ revision: 4, parts: [agentTextPartFixture()] })])
  assert.deepEqual(state.messages['ags-session']![0]!.parts, [failedPart])
})

test('更新后的失败完整片段可补全正文，过期失败版本不覆盖它', () => {
  let state = initialState()
  const updated = { ...failedPart, revision: 3, text: '最终失败正文' }
  for (const event of [partEvent(1), partEvent(2, updated), partEvent(3)]) {
    state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: event.sequence, run_event: event }).state
  }
  assert.deepEqual(state.messages['ags-session']![0]!.parts, [updated])
})

test('终态 Run 先到时保留统计，同时接纳并行历史新带回的失败片段', () => {
  let state = applyAgentWorkspaceEvent(initialState(), {
    type: 'upsert', revision: 1, run_event: agentDeltaEventFixture(),
  }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 2,
    run: agentRunFixture({ status: 'failed', revision: 2, error_message: failure.error_message }),
  }).state
  const usage = state.messages['ags-session']![0]!.turn_usage
  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture({
    status: 'streaming', parts: [failedPart],
  })])
  const message = state.messages['ags-session']![0]!
  assert.equal(message.status, 'failed')
  assert.deepEqual(message.turn_usage, usage)
  assert.deepEqual(message.parts, [failedPart])
})
