import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRetryData, AgentRunEvent } from '#entities/agent'
import { mergeAgentRetryActivity } from '#entities/agent'
import { applyAgentWorkspaceEvent, createAgentWorkspaceState, mergeAgentMessages, mergeAgentRunEvents, replaceAgentMessages, type AgentWorkspaceState } from './agentWorkspaceState.ts'
import { agentDeltaEventFixture, agentFixtureTime, agentMessageFixture, agentRunFixture, agentSessionFixture, agentTextPartFixture } from './agentRuntimeTestFixtures.ts'
import { decodeAgentMessage, decodeAgentRunEvent } from './agentRuntimeProtocol.ts'

const retry: AgentRetryData = {
  retry_id: 'retry-one', assistant_message_id: 'agm-assistant', purpose: 'response',
  after_part_sequence: 0, status: 'waiting', attempt: 0, max_retries: 3,
  delay_ms: 2_000, error_message: '  upstream timeout\n请求失败  ',
}

function event(sequence: number, patch: Partial<AgentRetryData> = {}): Extract<AgentRunEvent, { kind: 'retry' }> {
  return {
    id: `retry-event-${sequence}`, run_id: 'agr-run', generation: 1, sequence,
    kind: 'retry', payload: { retry: { ...retry, ...patch } },
    created_at: new Date(Date.parse(agentFixtureTime) + sequence * 1_000).toISOString(),
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

test('首次等待、实际请求和终态原位归并，历史重载保持首个等待时间和原始错误', () => {
  let state = initialState()
  const events = [event(1), event(2, { status: 'requesting', attempt: 1 }),
    event(3, { status: 'waiting', attempt: 1 }), event(4, { status: 'requesting', attempt: 2 }),
    event(5, { status: 'completed', attempt: 2, duration_ms: 4_000 })]
  for (const current of events) {
    state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: current.sequence, run_event: current }).state
    assert.equal(state.messages['ags-session']![0]!.retries?.length, 1)
  }
  const activity = state.messages['ags-session']![0]!.retries![0]!
  assert.equal(activity.status, 'completed')
  assert.equal(activity.created_at, events[0]!.created_at)
  assert.equal(activity.duration_ms, 4_000)
  assert.equal(activity.error_message, retry.error_message)
  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture()])
  assert.deepEqual(state.messages['ags-session']![0]!.retries![0], activity)
  state.run_events = {}
  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture({
    revision: 2, retries: [{ ...retry, created_at: events[0]!.created_at }],
  })])
  assert.deepEqual(state.messages['ags-session']![0]!.retries![0], activity)
})

test('迟到请求和旧等待不倒退，后续等待推进计数，终态不会被活动快照覆盖', () => {
  const waiting = { ...retry, attempt: 1, created_at: agentFixtureTime }
  assert.equal(mergeAgentRetryActivity(waiting, { ...waiting, status: 'requesting' }), waiting)
  const requesting = { ...waiting, status: 'requesting' as const, attempt: 2 }
  assert.equal(mergeAgentRetryActivity(requesting, waiting), requesting)
  assert.equal(mergeAgentRetryActivity(waiting, requesting).status, 'requesting')
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    const terminal = { ...requesting, status, duration_ms: 1_200 }
    assert.equal(mergeAgentRetryActivity(terminal, requesting), terminal)
    assert.equal(mergeAgentRetryActivity({ ...terminal, duration_ms: undefined }, terminal).duration_ms, 1_200)
  }
})

test('活动事件不改变消息 revision，同版本消息仍可补入首次加载的历史重试', () => {
  const state = initialState()
  const activity = { ...retry, status: 'failed' as const, created_at: agentFixtureTime, duration_ms: 500 }
  const historical = agentMessageFixture({ retries: [activity] })
  const merged = mergeAgentMessages(state, 'ags-session', [historical])
  assert.deepEqual(merged.messages['ags-session']![0]!.retries, [activity])
  const replaced = replaceAgentMessages(state, 'ags-session', [agentMessageFixture(), historical])
  assert.deepEqual(replaced.messages['ags-session']![0]!.retries, [activity])
})

test('重复事件、序号缺口、旧代次和跨消息重试沿用补拉防护', () => {
  let state = initialState()
  const gap = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1, run_event: event(2) })
  assert.deepEqual(gap.reconcile_run, { id: 'agr-run', generation: 1 })
  assert.ok(applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1,
    run_event: event(1, { assistant_message_id: 'other' }) }).reconcile_run)
  state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1,
    run_event: { ...event(1), generation: 0 } }).state
  assert.equal(state.messages['ags-session']![0]!.retries, undefined)
  const restored = mergeAgentRunEvents(state, agentRunFixture(), [event(1), event(1)]).state
  assert.equal(restored.messages['ags-session']![0]!.retries?.length, 1)
  assert.equal(restored.run_event_sequences['agr-run'], 1)
})

test('历史请求数零取消合法，错误原文与终态耗时零经协议完整保存', () => {
  const terminal = { ...retry, status: 'cancelled' as const, duration_ms: 0, created_at: agentFixtureTime }
  const message = decodeAgentMessage({ ...agentMessageFixture({ status: 'failed' }), retries: [terminal],
    turn_usage: { run_id: 'agr-run', usage: agentRunFixture().usage, error_message: retry.error_message } })
  assert.deepEqual(message.retries?.[0], terminal)
  assert.equal(message.turn_usage?.error_message, retry.error_message)
  assert.equal(decodeAgentRunEvent(event(1)).kind, 'retry')
  assert.equal(decodeAgentMessage(agentMessageFixture()).retries, undefined)
})

test('拒绝非法阶段计数、用途、统计、错误详情和消息归属', () => {
  for (const patch of [
    { status: 'waiting', attempt: 3 }, { status: 'requesting', attempt: 0 }, { status: 'completed', attempt: 0 },
    { status: 'waiting', duration_ms: 0 }, { status: 'requesting', attempt: 1, duration_ms: 0 }, { attempt: -1 },
    { attempt: 4 }, { attempt: 0.5 }, { max_retries: 4 }, { purpose: 'other' },
    { status: 'other' }, { delay_ms: -1 }, { delay_ms: Infinity }, { duration_ms: null },
    { duration_ms: -1 }, { after_part_sequence: -1 }, { error_message: null },
  ]) {
    assert.throws(() => decodeAgentRunEvent({ ...event(1), payload: { retry: { ...retry, ...patch } } }))
  }
  assert.throws(() => decodeAgentRunEvent({ ...event(1), payload: { retry, usage: {} } }))
  const activity = { ...retry, created_at: agentFixtureTime }
  assert.throws(() => decodeAgentMessage({ ...agentMessageFixture(), retries: [activity, activity] }))
  assert.throws(() => decodeAgentMessage({ ...agentMessageFixture({ role: 'user' }), retries: [activity] }))
  assert.throws(() => decodeAgentMessage({ ...agentMessageFixture(), retries: [{ ...activity, assistant_message_id: 'other' }] }))
})

test('运行终态的原始错误保存到消息，错误详情变化也会刷新状态', () => {
  let state = initialState()
  const run = agentRunFixture({ status: 'failed', revision: 2, error_message: retry.error_message })
  state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 1, run }).state
  assert.equal(state.messages['ags-session']![0]!.turn_usage?.error_message, retry.error_message)
  state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 2,
    run: { ...run, revision: 3, error_message: 'latest failure' } }).state
  assert.equal(state.messages['ags-session']![0]!.turn_usage?.error_message, 'latest failure')
})

test('消息历史比并行读取的 Run 更新时，旧活动 Run 不清除已确认终态与原始错误', () => {
  const historical = agentMessageFixture({
    status: 'failed', revision: 2,
    retries: [{ ...retry, status: 'failed', attempt: 3, duration_ms: 7_000, created_at: agentFixtureTime }],
    turn_usage: { run_id: 'agr-run', usage: agentRunFixture().usage, error_message: retry.error_message },
  })
  const state = replaceAgentMessages(initialState(), 'ags-session', [historical])
  assert.equal(state.messages['ags-session']![0]!.status, 'failed')
  assert.equal(state.messages['ags-session']![0]!.turn_usage?.error_message, retry.error_message)
  assert.equal(state.messages['ags-session']![0]!.retries?.[0]?.status, 'failed')
})

test('任务已切换时，迟到的同版本旧消息列表不能清掉已有终态和历史错误', () => {
  const historical = agentMessageFixture({
    status: 'failed',
    retries: [{ ...retry, status: 'failed', attempt: 3, duration_ms: 7_000, created_at: agentFixtureTime }],
    turn_usage: { run_id: 'agr-run', usage: agentRunFixture().usage, error_message: retry.error_message },
  })
  const current = { ...initialState(), runs: {}, messages: { 'ags-session': [historical] } }
  const state = replaceAgentMessages(current, 'ags-session', [agentMessageFixture()])
  assert.equal(state.messages['ags-session']![0]!.status, 'failed')
  assert.equal(state.messages['ags-session']![0]!.turn_usage?.error_message, retry.error_message)
  const incoming = mergeAgentMessages({ ...initialState(), runs: {} }, 'ags-session', [historical])
  assert.equal(incoming.messages['ags-session']![0]!.status, 'failed')
  assert.equal(incoming.messages['ags-session']![0]!.turn_usage?.error_message, retry.error_message)
})

test('重试失败历史已保存完整片段时，旧流式 overlay 和补拉 delta 均不能覆盖或重复正文', () => {
  const delta = agentDeltaEventFixture({ payload: { message_delta: {
    message_id: 'agm-assistant', part_id: 'agp-text', kind: 'text', delta: '部分',
  } } })
  const historical = agentMessageFixture({
    status: 'failed', revision: 2, parts: [agentTextPartFixture({ text: '部分正文已保存' })],
    retries: [{ ...retry, status: 'failed', attempt: 1, duration_ms: 1_000, created_at: agentFixtureTime }],
    turn_usage: { run_id: 'agr-run', usage: agentRunFixture().usage, error_message: retry.error_message },
  })
  const live = applyAgentWorkspaceEvent(initialState(), { type: 'upsert', revision: 1, run_event: delta }).state
  const reloaded = replaceAgentMessages(live, 'ags-session', [historical])
  assert.equal(reloaded.messages['ags-session']![0]!.parts[0]!.kind, 'text')
  assert.deepEqual(reloaded.messages['ags-session']![0]!.parts, historical.parts)
  const historyFirst = replaceAgentMessages(initialState(), 'ags-session', [historical])
  const replayed = mergeAgentRunEvents(historyFirst, agentRunFixture(), [delta]).state
  assert.deepEqual(replayed.messages['ags-session']![0]!.parts, historical.parts)
  assert.equal(replayed.run_event_sequences['agr-run'], 1)
  assert.equal(replayed.run_part_overlays['agr-run'], undefined)
})

test('终态 Run 先于片段到达时，仍补齐缺失 delta、已有 overlay 和最终 message_part', () => {
  for (const deltaFirst of [false, true]) {
    let state = initialState()
    if (deltaFirst) state = applyAgentWorkspaceEvent(state, {
      type: 'upsert', revision: 1, run_event: agentDeltaEventFixture(),
    }).state
    state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: 2,
      run: agentRunFixture({ status: 'failed', revision: 2, error_message: retry.error_message }),
    }).state
    state = replaceAgentMessages(state, 'ags-session', [...state.messages['ags-session']!])
    const sequence = deltaFirst ? 2 : 1
    const delta = agentDeltaEventFixture({ sequence, payload: { message_delta: {
      message_id: 'agm-assistant', part_id: 'agp-text', kind: 'text', delta: '好',
    } } })
    state = mergeAgentRunEvents(state, state.runs['agr-run']!, [delta]).state
    const part = state.messages['ags-session']![0]!.parts[0]!
    assert.equal(part.kind === 'text' ? part.text : '', deltaFirst ? '你好' : '好')
    const finalPart = agentTextPartFixture({ text: '完整正文' })
    state = mergeAgentRunEvents(state, state.runs['agr-run']!, [{
      id: 'age-final', run_id: 'agr-run', generation: 1, sequence: sequence + 1,
      kind: 'message_part', payload: { message_part: finalPart }, created_at: agentFixtureTime,
    }]).state
    assert.deepEqual(state.messages['ags-session']![0]!.parts, [finalPart])
    assert.equal(state.messages['ags-session']![0]!.status, 'failed')
    assert.equal(state.run_part_overlays['agr-run'], undefined)
  }
})
