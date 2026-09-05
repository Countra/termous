import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentCompactionData, AgentRunEvent } from '#entities/agent'
import { applyAgentWorkspaceEvent, createAgentWorkspaceState, mergeAgentRunEvents, replaceAgentMessages, replaceAgentSessions, type AgentWorkspaceState } from './agentWorkspaceState.ts'
import { acceptAgentSessionContext } from './agentWorkspaceContext.ts'
import { agentFixtureTime, agentMessageFixture, agentRunFixture, agentSessionFixture } from './agentRuntimeTestFixtures.ts'
import { decodeAgentMessage, decodeAgentRunEvent } from './agentRuntimeProtocol.ts'

const activity: AgentCompactionData = {
  compaction_id: 'compact-one', status: 'started', reason: 'threshold',
  assistant_message_id: 'agm-assistant', after_part_sequence: 0, tokens_before: 26_500,
}

function event(sequence: number, patch: Partial<AgentCompactionData> = {}): AgentRunEvent {
  return {
    id: `event-${sequence}`, run_id: 'agr-run', generation: 1, sequence,
    kind: 'compaction', payload: { compaction: { ...activity, ...patch } }, created_at: agentFixtureTime,
  }
}

function initialState(): AgentWorkspaceState {
  return {
    ...applyAgentWorkspaceEvent(createAgentWorkspaceState(), {
      type: 'snapshot', revision: 0, sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    }).state,
    messages: { 'ags-session': [agentMessageFixture()] },
  }
}

test('压缩生命周期原位合并，重复事件不重复插入，历史重载保留终态', () => {
  let state = initialState()
  state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1, run_event: event(1) }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 2, run_event: event(2, { status: 'completed', tokens_after: 8_000 }),
  }).state
  state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 3, run_event: event(1) }).state
  assert.equal(state.messages['ags-session']![0]!.compactions?.length, 1)
  assert.equal(state.messages['ags-session']![0]!.compactions?.[0]?.status, 'completed')
  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture()])
  assert.equal(state.messages['ags-session']![0]!.compactions?.[0]?.status, 'completed')
})

test('压缩事件缺口要求补拉，过期 generation 和错误消息归属不污染状态', () => {
  const state = initialState()
  const gap = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1, run_event: event(2) })
  assert.deepEqual(gap.reconcile_run, { id: 'agr-run', generation: 1 })
  const wrongMessage = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1, run_event: event(1, { assistant_message_id: 'other' }),
  })
  assert.ok(wrongMessage.reconcile_run)
  const old = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1, run_event: { ...event(1), generation: 0 },
  }).state
  assert.equal(old.messages['ags-session']![0]!.compactions, undefined)
})

test('真实压缩后的上下文占用允许降至 30%，不修改累计账单并保留 checkpoint', () => {
  let state = initialState()
  const checkpoint = { boundary_message_sequence: 4, estimated_tokens: 2_000, created_at: agentFixtureTime }
  state.session_contexts['ags-session'] = {
    phase: 'ready', compression_pending: false,
    value: { session_id: 'ags-session', estimated_tokens: 75_000, context_window_tokens: 100_000,
      estimated: true, warning: true, compression_available: true, checkpoint },
  }
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1,
    run_event: event(1, { tokens_before: 75_000, context_window_tokens: 100_000 }),
  }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 2,
    run_event: event(2, { status: 'completed', tokens_before: 75_000, tokens_after: 30_000, context_window_tokens: 100_000 }),
  }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 3,
    run_event: {
      ...event(3), kind: 'context_usage', payload: { context_usage: {
        estimated_tokens: 30_000, context_window_tokens: 100_000,
        estimated: true, warning: false, compression_available: false,
      } },
    },
  }).state
  assert.equal(state.session_contexts['ags-session']?.value?.estimated_tokens, 30_000)
  assert.equal(state.messages['ags-session']![0]!.compactions?.[0]?.status, 'completed')
  assert.deepEqual(state.session_contexts['ags-session']?.value?.checkpoint, checkpoint)
  assert.equal(state.runs['agr-run']?.usage.total_tokens, 0)
})

test('旧任务上下文补拉只推进游标，不覆盖同会话较新任务占用；其他会话互不干扰', () => {
  for (const sameSession of [true, false]) {
    let state = initialState()
    const previous = {
      session_id: 'ags-session', estimated_tokens: 8_000, context_window_tokens: 32_768,
      estimated: true, warning: false, compression_available: false,
    }
    state.session_contexts['ags-session'] = { phase: 'ready', compression_pending: false, value: previous }
    const oldRun = agentRunFixture({ status: 'completed', revision: 2 })
    state.runs[oldRun.id] = oldRun
    state.runs['agr-next'] = agentRunFixture({
      id: 'agr-next', generation: 2, session_id: sameSession ? 'ags-session' : 'ags-other',
    })
    const usageEvent: AgentRunEvent = {
      ...event(1), kind: 'context_usage', payload: { context_usage: {
        estimated_tokens: 26_000, context_window_tokens: 32_768,
        estimated: true, warning: true, compression_available: true,
      } },
    }
    state = mergeAgentRunEvents(state, oldRun, [usageEvent]).state
    assert.equal(state.run_event_sequences[oldRun.id], 1)
    assert.equal(state.session_contexts['ags-session']?.value?.estimated_tokens, sameSession ? 8_000 : 26_000)
    assert.equal(state.session_contexts['ags-session']?.value === previous, sameSession)
  }
})

test('切模型后没有新任务时，旧终态任务补拉仅更新参考；切回原模型仍由 HTTP 确认', () => {
  let state = initialState()
  const session = agentSessionFixture()
  const oldRun = agentRunFixture({ status: 'completed', revision: 2 })
  state.runs[oldRun.id] = oldRun
  state = acceptAgentSessionContext(state, {
    session_id: session.id, model_id: session.model_id, assessment: 'ready',
    estimated_tokens: 70_000, context_window_tokens: 100_000, estimated: true,
    warning: true, compression_available: true, compression_status: 'available',
  })
  state.session_contexts[session.id]!.compression_pending = true
  state = replaceAgentSessions(state, [{ ...session, model_id: 'apm-next', revision: 2 }])
  const usageEvent = (sequence: number): AgentRunEvent => ({
    ...event(sequence), kind: 'context_usage', payload: { context_usage: {
      estimated_tokens: 75_000, context_window_tokens: 100_000, estimated: true,
      warning: true, compression_available: false, compression_status: 'unavailable', basis: 'provider_usage',
    } },
  })
  state = mergeAgentRunEvents(state, oldRun, [usageEvent(1)]).state
  assert.equal(state.run_event_sequences[oldRun.id], 1)
  assert.equal(state.session_contexts[session.id]?.value?.model_id, 'apm-next')
  assert.equal(state.session_contexts[session.id]?.value?.assessment, 'pending')
  assert.equal(state.session_contexts[session.id]?.value?.estimated_tokens, 0)
  assert.equal(state.session_contexts[session.id]?.value?.last_snapshot?.estimated_tokens, 75_000)
  assert.equal(state.session_contexts[session.id]?.compression_pending, true)
  state = replaceAgentSessions(state, [{ ...session, revision: 3 }])
  state = mergeAgentRunEvents(state, oldRun, [usageEvent(2)]).state
  assert.equal(state.session_contexts[session.id]?.value?.assessment, 'pending')
  assert.equal(state.run_event_sequences[oldRun.id], 2)
  state = acceptAgentSessionContext(state, {
    session_id: session.id, model_id: session.model_id, assessment: 'ready',
    estimated_tokens: 76_000, context_window_tokens: 100_000, estimated: true,
    warning: true, compression_available: false, compression_status: 'unknown',
  })
  assert.equal(state.session_contexts[session.id]?.value?.assessment, 'ready')
  assert.equal(state.session_contexts[session.id]?.compression_pending, true)
})

test('当前模型新运行的上下文事件解除待评估并更新参考，旧模型事件不覆盖已评估值', () => {
  let state = initialState()
  const session = agentSessionFixture()
  state = replaceAgentSessions(state, [{ ...session, model_id: 'apm-next', revision: 2 }])
  const newRun = agentRunFixture({
    id: 'agr-next', model_id: 'apm-next', generation: 2,
    model_snapshot: { ...agentRunFixture().model_snapshot, model_display_name: 'GLM' },
  })
  const usageEvent: AgentRunEvent = {
    ...event(1), run_id: newRun.id, generation: 2, kind: 'context_usage', payload: { context_usage: {
      estimated_tokens: 20_000, context_window_tokens: 200_000, estimated: true,
      warning: false, compression_available: false, compression_status: 'unknown', basis: 'pi_estimate',
    } },
  }
  state = mergeAgentRunEvents(state, newRun, [usageEvent]).state
  const value = state.session_contexts[session.id]?.value
  assert.equal(value?.assessment, 'ready')
  assert.equal(value?.last_snapshot?.model_name, 'GLM')
  assert.equal(value?.last_snapshot?.context_window_tokens, 200_000)
  assert.equal(value?.last_snapshot?.estimated_tokens, 20_000)
  const oldRun = agentRunFixture({ status: 'completed', revision: 2 })
  state = mergeAgentRunEvents(state, oldRun, [{ ...usageEvent, run_id: oldRun.id, generation: 1 }]).state
  assert.equal(state.session_contexts[session.id]?.value, value)
})

test('压缩协议支持位置零和持久活动，拒绝错误分支、状态及跨消息活动', () => {
  assert.equal(decodeAgentRunEvent(event(1)).kind, 'compaction')
  assert.throws(() => decodeAgentRunEvent({ ...event(1), payload: { compaction: { ...activity, after_part_sequence: -1 } } }))
  assert.throws(() => decodeAgentRunEvent({ ...event(1), payload: { compaction: { ...activity, status: 'unknown' } } }))
  assert.throws(() => decodeAgentRunEvent({ ...event(1), payload: { compaction: activity, usage: {} } }))
  const message = { ...agentMessageFixture(), compactions: [{ ...activity, created_at: agentFixtureTime }] }
  assert.equal(decodeAgentMessage(message).compactions?.[0]?.after_part_sequence, 0)
  assert.throws(() => decodeAgentMessage({ ...message, id: 'other' }))
  assert.throws(() => decodeAgentMessage({ ...message, compactions: [...message.compactions, ...message.compactions] }))
})

test('取消和失败均持久化为终态，不能被较旧的 started 快照倒退', () => {
  for (const status of ['cancelled', 'failed'] as const) {
    let state = initialState()
    state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1, run_event: event(1, { status }) }).state
    const message = state.messages['ags-session']![0]!
    state.run_events['agr-run'] = [event(1)]
    state = replaceAgentMessages(state, 'ags-session', [message])
    assert.equal(state.messages['ags-session']![0]!.compactions?.[0]?.status, status)
  }
})

test('压缩窗口与终态耗时随事件归并、消息重载保留，不引用当前模型设置', () => {
  let state = initialState()
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1,
    run_event: event(1, { tokens_before: 80_000, context_window_tokens: 100_000 }),
  }).state
  const completed = event(2, { status: 'completed', tokens_before: 80_000, tokens_after: 30_000, duration_ms: 2_400 })
  state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 2, run_event: completed }).state
  const expected = state.messages['ags-session']![0]!.compactions![0]!
  assert.equal(expected.context_window_tokens, 100_000)
  assert.equal(expected.duration_ms, 2_400)
  assert.equal(expected.tokens_after, 30_000)
  assert.equal(expected.created_at, agentFixtureTime)
  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture()])
  assert.deepEqual(state.messages['ags-session']![0]!.compactions![0], expected)
})

test('历史压缩统计与实时统计使用相同协议，保留零耗时并兼容缺少统计的旧数据', () => {
  const value = { ...activity, status: 'completed', context_window_tokens: 100_000, duration_ms: 0, tokens_after: 0 }
  const decoded = decodeAgentRunEvent({ ...event(1), payload: { compaction: value } })
  assert.equal(decoded.kind, 'compaction')
  if (decoded.kind !== 'compaction') throw new Error('压缩事件类型不匹配')
  assert.equal(decoded.payload.compaction.duration_ms, 0)
  assert.equal(decoded.payload.compaction.context_window_tokens, 100_000)
  const historical = decodeAgentMessage({
    ...agentMessageFixture(), compactions: [{ ...value, created_at: agentFixtureTime }],
  })
  assert.equal(historical.compactions?.[0]?.duration_ms, 0)
  assert.equal(decodeAgentMessage({ ...agentMessageFixture(), compactions: [{ ...activity, created_at: agentFixtureTime }] }).compactions?.[0]?.duration_ms, undefined)
})

test('拒绝非正窗口、负数耗时、非整数与超出安全范围的压缩统计', () => {
  for (const [key, invalid] of [
    ['context_window_tokens', 0], ['context_window_tokens', -1], ['context_window_tokens', 1.5],
    ['context_window_tokens', null], ['context_window_tokens', Number.MAX_SAFE_INTEGER + 1],
    ['duration_ms', -1], ['duration_ms', 0.5], ['duration_ms', null], ['duration_ms', Infinity],
  ] as const) {
    assert.throws(() => decodeAgentRunEvent({ ...event(1), payload: { compaction: { ...activity, [key]: invalid } } }), key)
  }
})
