import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRunEvent } from '#entities/agent'
import {
  applyAgentWorkspaceEvent,
  createAgentWorkspaceState,
  mergeAgentMessages,
  replaceAgentMessages,
  selectAgentSession,
  setAgentDraft,
} from './agentWorkspaceState.ts'
import {
  agentDeltaEventFixture,
  agentFixtureTime,
  agentMessageFixture,
  agentRunFixture,
  agentSessionFixture,
} from './agentRuntimeTestFixtures.ts'

test('revision 0 快照是权威状态并只选择未归档会话', () => {
  const archived = agentSessionFixture({ id: 'ags-archived', archived_at: agentFixtureTime })
  const active = agentSessionFixture({ id: 'ags-active', updated_at: '2026-08-29T00:01:00Z' })
  const result = applyAgentWorkspaceEvent(createAgentWorkspaceState(), {
    type: 'snapshot', revision: 0, sessions: [archived, active], active_runs: [],
  })

  assert.equal(result.state.sessions.length, 2)
  assert.equal(result.state.selected_session_id, 'ags-active')
  assert.equal(selectAgentSession(result.state, 'ags-archived'), result.state)
})

test('草稿按会话隔离并在清空后只删除目标草稿', () => {
  let state = createAgentWorkspaceState()
  state = setAgentDraft(state, 'ags-one', '第一份', 1)
  state = setAgentDraft(state, 'ags-two', '第二份', 2)
  state = setAgentDraft(state, 'ags-one', '', 3)

  assert.equal(state.drafts['ags-one'], undefined)
  assert.equal(state.drafts['ags-two']?.text, '第二份')
})

test('显式新会话选择不被列表水合或快照回选为历史会话', () => {
  const historical = agentSessionFixture({ id: 'ags-historical' })
  let state = applyAgentWorkspaceEvent(createAgentWorkspaceState(), {
    type: 'snapshot', revision: 0, sessions: [historical], active_runs: [],
  }).state
  state = selectAgentSession(state, undefined)
  state = setAgentDraft(state, 'new', '尚未提交的请求', 1)

  state = applyAgentWorkspaceEvent(state, {
    type: 'snapshot', revision: 1, sessions: [historical], active_runs: [],
  }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 2,
    session: agentSessionFixture({ id: 'ags-newer', updated_at: '2026-08-29T00:02:00Z' }),
  }).state

  assert.equal(state.selected_session_id, undefined)
  assert.equal(state.new_session_selected, true)
  assert.equal(state.drafts.new?.text, '尚未提交的请求')
})

test('连续 delta 直接合入消息且重复与旧 generation 不重复追加', () => {
  let state = workspaceWithRun()
  const first = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1, run_event: agentDeltaEventFixture(),
  })
  state = first.state
  const secondDelta = agentDeltaEventFixture({
    id: 'age-delta-2',
    sequence: 2,
    payload: {
      message_delta: {
        message_id: 'agm-assistant', part_id: 'agp-text', kind: 'text', delta: '好',
      },
    },
  })
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 2, run_event: secondDelta,
  }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 3, run_event: secondDelta,
  }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 4,
    run_event: agentDeltaEventFixture({ id: 'age-old', generation: 0, sequence: 3 }),
  }).state

  const part = state.messages['ags-session']?.[0]?.parts[0]
  assert.equal(part?.kind === 'text' ? part.text : '', '你好')
  assert.equal(state.run_event_sequences['agr-run'], 2)
  assert.deepEqual(state.run_events['agr-run'] ?? [], [])
})

test('长流只保留消息投影和游标，同时保留 Tool 与审批时间线', () => {
  const deltaCount = 4_096
  let state = workspaceWithRun()
  for (let sequence = 1; sequence <= deltaCount; sequence += 1) {
    state = applyAgentWorkspaceEvent(state, {
      type: 'upsert',
      revision: sequence,
      run_event: agentDeltaEventFixture({
        id: `age-delta-${sequence}`,
        sequence,
        payload: {
          message_delta: {
            message_id: 'agm-assistant',
            part_id: 'agp-text',
            kind: 'text',
            delta: 'x',
          },
        },
      }),
    }).state
  }
  const toolEvent: AgentRunEvent = {
    id: 'age-tool', run_id: 'agr-run', generation: 1, sequence: deltaCount + 1,
    kind: 'tool_started',
    payload: { tool: { tool_call_id: 'call-one', tool_name: 'termous.test' } },
    created_at: agentFixtureTime,
  }
  const approvalEvent: AgentRunEvent = {
    id: 'age-approval', run_id: 'agr-run', generation: 1, sequence: deltaCount + 2,
    kind: 'approval_waiting', payload: { approval: { approval_id: 'approval-one' } },
    created_at: agentFixtureTime,
  }
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: deltaCount + 1, run_event: toolEvent,
  }).state
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: deltaCount + 2, run_event: approvalEvent,
  }).state

  const part = state.messages['ags-session']?.[0]?.parts[0]
  assert.equal(part?.kind === 'text' ? part.text.length : 0, deltaCount)
  assert.equal(state.run_event_sequences['agr-run'], deltaCount + 2)
  assert.equal(Object.keys(state.run_part_overlays['agr-run'] ?? {}).length, 1)
  const overlay = state.run_part_overlays['agr-run']?.['agp-text']
  assert.equal(overlay?.kind === 'text' ? overlay.text.length : 0, deltaCount)
  assert.deepEqual(state.run_events['agr-run']?.map(({ kind }) => kind), [
    'tool_started',
    'approval_waiting',
  ])
})

test('reasoning delta 保持独立类型且最终 message part 覆盖临时投影', () => {
  let state = workspaceWithRun()
  const reasoning = agentDeltaEventFixture({
    payload: {
      message_delta: {
        message_id: 'agm-assistant', part_id: 'agp-reasoning', kind: 'reasoning', delta: '分析中',
      },
    },
  })
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1, run_event: reasoning,
  }).state
  const finalPart = {
    id: 'agp-reasoning',
    message_id: 'agm-assistant',
    sequence: 1,
    revision: 1,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    kind: 'reasoning' as const,
    text: '完整分析',
  }
  const finalEvent: AgentRunEvent = {
    id: 'age-part', run_id: 'agr-run', generation: 1, sequence: 2,
    kind: 'message_part', payload: { message_part: finalPart }, created_at: agentFixtureTime,
  }
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 2, run_event: finalEvent,
  }).state

  const part = state.messages['ags-session']?.[0]?.parts[0]
  assert.equal(part?.kind, 'reasoning')
  assert.equal(part?.kind === 'reasoning' ? part.text : '', '完整分析')
  assert.deepEqual(state.run_events['agr-run']?.map(({ kind }) => kind), ['message_part'])
  assert.equal(state.run_part_overlays['agr-run'], undefined)

  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture()])
  const replayedPart = state.messages['ags-session']?.[0]?.parts[0]
  assert.equal(replayedPart?.kind === 'reasoning' ? replayedPart.text : '', '完整分析')
})

test('活动流在权威消息替换后重放未完成 Part 投影', () => {
  let state = workspaceWithRun()
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1, run_event: agentDeltaEventFixture(),
  }).state

  state = replaceAgentMessages(state, 'ags-session', [agentMessageFixture()])

  const part = state.messages['ags-session']?.[0]?.parts[0]
  assert.equal(part?.kind === 'text' ? part.text : '', '你')
  const overlay = state.run_part_overlays['agr-run']?.['agp-text']
  assert.equal(overlay?.kind === 'text' ? overlay.text : '', '你')
  assert.deepEqual(state.run_events['agr-run'] ?? [], [])
})

test('未完成 Part overlay 保留权威消息中的既有顺序', () => {
  const authoritative = agentMessageFixture({
    parts: [{
      id: 'agp-existing', message_id: 'agm-assistant', sequence: 1, revision: 1,
      created_at: agentFixtureTime, updated_at: agentFixtureTime, kind: 'text', text: '已有内容',
    }],
  })
  let state = workspaceWithRun(authoritative)
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1, run_event: agentDeltaEventFixture(),
  }).state

  state = replaceAgentMessages(state, 'ags-session', [authoritative])

  assert.deepEqual(
    state.messages['ags-session']?.[0]?.parts.map(({ id, sequence }) => ({ id, sequence })),
    [{ id: 'agp-existing', sequence: 1 }, { id: 'agp-text', sequence: 2 }],
  )
  assert.equal(state.run_part_overlays['agr-run']?.['agp-text']?.sequence, 2)
})

test('sequence 缺口和未知 Run 请求权威补偿而不推进游标', () => {
  const state = workspaceWithRun()
  const gap = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1,
    run_event: agentDeltaEventFixture({ id: 'age-gap', sequence: 2 }),
  })
  assert.deepEqual(gap.reconcile_run, { id: 'agr-run', generation: 1 })
  assert.equal(gap.state.run_event_sequences['agr-run'], undefined)

  const unknown = applyAgentWorkspaceEvent(createAgentWorkspaceState(), {
    type: 'upsert', revision: 1,
    run_event: agentDeltaEventFixture({ run_id: 'agr-missing' }),
  })
  assert.deepEqual(unknown.reconcile_run, { id: 'agr-missing', generation: 1 })
})

test('新活动 Run 清理被替代 Run 的事件且删除会话同步清理子状态', () => {
  let state = workspaceWithRun()
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1, run_event: agentDeltaEventFixture(),
  }).state
  const nextRun = agentRunFixture({
    id: 'agr-next', client_request_id: 'request-2',
    user_message_id: 'agm-user-2', assistant_message_id: 'agm-assistant-2',
  })
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 2, run: nextRun,
  }).state
  assert.equal(state.runs['agr-run'], undefined)
  assert.equal(state.run_events['agr-run'], undefined)
  assert.equal(state.active_run_id, 'agr-next')

  state = applyAgentWorkspaceEvent(state, {
    type: 'removed', revision: 3, entity: 'session', id: 'ags-session',
  }).state
  assert.deepEqual(state.runs, {})
  assert.deepEqual(state.messages, {})
  assert.equal(state.active_run_id, undefined)
})

test('Run 终态同步收口 assistant 消息状态', () => {
  let state = workspaceWithRun()
  state = applyAgentWorkspaceEvent(state, {
    type: 'upsert', revision: 1,
    run: agentRunFixture({ status: 'completed', revision: 2, completed_at: agentFixtureTime }),
  }).state
  assert.equal(state.messages['ags-session']?.[0]?.status, 'completed')
})

function workspaceWithRun(message = agentMessageFixture()) {
  let state = applyAgentWorkspaceEvent(createAgentWorkspaceState(), {
    type: 'snapshot',
    revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [agentRunFixture()],
  }).state
  state = mergeAgentMessages(state, 'ags-session', [message])
  return state
}
