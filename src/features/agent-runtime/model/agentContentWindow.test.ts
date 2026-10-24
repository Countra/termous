import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentContentWindow, mergeTimelineMessages, trimAgentMessages } from './agentContentWindow.ts'
import { createAgentWorkspaceState } from './agentWorkspaceState.ts'
import { agentMessageFixture, agentTextPartFixture, agentRunFixture, agentStatusEventFixture } from './agentRuntimeTestFixtures.ts'

test('单轮两千片段只保留二百条，正文事件不重复保存', () => {
  const state = createAgentWorkspaceState()
  const message = agentMessageFixture({ parts: Array.from({ length: 2000 }, (_, i) => agentTextPartFixture({ id: `p${i}`, sequence: i + 1 })) })
  state.selected_session_id = message.session_id
  state.messages[message.session_id] = [message]
  const bounded = new AgentContentWindow().apply(state)
  assert.equal(bounded.messages[message.session_id]![0]!.parts.length, 200)
  assert.equal(bounded.messages[message.session_id]![0]!.parts[0]!.sequence, 1801)
  assert.equal(message.parts.length, 2000)
  assert.equal(trimAgentMessages([message], 200, true)[0]!.parts[199]!.sequence, 200)
})

test('内容预算回收非当前会话，草稿和事件水位独立保留', () => {
  const state = createAgentWorkspaceState()
  state.selected_session_id = 's0'
  for (let i = 0; i < 8; i++) {
    const id = `s${i}`
    state.messages[id] = [agentMessageFixture({ session_id: id, parts: [agentTextPartFixture({ text: 'x'.repeat(3 * 1024 * 1024) })] })]
    state.drafts[id] = { text: '未发送', updated_at: 0 }
    state.run_event_sequences[id] = 2000
  }
  const bounded = new AgentContentWindow().apply(state)
  assert.ok(bounded.messages.s0)
  assert.equal(Object.keys(bounded.messages).length, 2)
  assert.deepEqual(bounded.drafts, state.drafts)
  assert.deepEqual(bounded.run_event_sequences, state.run_event_sequences)
})

test('历史分页合并保留引用，回收片段时同步释放不用的图片元数据', () => {
  const reference = 'termous-image://tool/call/0'
  const source = { reference, mime_type: 'image/png', size_bytes: 100, session_id: 'ags-session', message_id: 'old', part_id: 'image', content_index: 0, revision: 1 }
  const old = agentMessageFixture({ parts: [agentTextPartFixture({ id: 'p1', text: reference })], image_sources: [source] })
  const next = agentMessageFixture({ parts: [agentTextPartFixture({ id: 'p2', sequence: 2 })] })
  const merged = mergeTimelineMessages([old], [next])
  assert.deepEqual(merged[0]!.image_sources, [source])
  assert.deepEqual(trimAgentMessages(merged, 1)[0]!.image_sources, [])
  assert.deepEqual(trimAgentMessages(merged, 1, true)[0]!.image_sources, [source])
})

test('归档与当前会话复用字节预算，裁掉正文后仍能向旧页读取', () => {
  const window = new AgentContentWindow()
  const message = agentMessageFixture({ parts: Array.from({ length: 100 }, (_, i) => agentTextPartFixture({
    id: `large-${i}`, sequence: i + 1, text: 'x'.repeat(256 * 1024),
  })) })
  const latest = window.boundMessages([message])
  const oldest = window.boundMessages([message], true)
  assert.ok(latest[0]!.parts.length < 32)
  assert.equal(latest[0]!.parts[latest[0]!.parts.length - 1]!.sequence, 100)
  assert.equal(oldest[0]!.parts[0]!.sequence, 1)
  const state = createAgentWorkspaceState()
  state.messages[message.session_id] = [message]
  state.selected_session_id = message.session_id
  window.hasOlder.set(message.session_id, false)
  window.apply(state)
  assert.equal(window.hasOlder.get(message.session_id), true)
})

test('其他会话的事件不重建未变化的正文，避免投影缓存失效', () => {
  const message = agentMessageFixture({ parts: [agentTextPartFixture()] })
  const values = [message]
  assert.equal(trimAgentMessages(values), values)
  assert.equal(new AgentContentWindow().boundMessages(values)[0], message)
})

test('连续输入草稿不重建历史与事件，后续正文更新仍裁剪窗口', () => {
  const window = new AgentContentWindow()
  const initial = createAgentWorkspaceState()
  const message = agentMessageFixture({ parts: Array.from({ length: 200 }, (_, i) => agentTextPartFixture({ id: `p${i}`, sequence: i + 1 })) })
  initial.selected_session_id = message.session_id
  initial.messages[message.session_id] = [message]
  const run = agentRunFixture()
  initial.runs[run.id] = run
  initial.active_run_ids[message.session_id] = run.id
  initial.run_events[run.id] = [agentStatusEventFixture()]
  const bounded = window.apply(initial)
  for (let i = 0; i < 2000; i++) {
    const next = { ...bounded, drafts: { [message.session_id]: { text: `草稿 ${i}`, updated_at: i } } }
    assert.equal(window.apply(next), next)
    assert.equal(next.messages, initial.messages)
    assert.equal(next.run_events[run.id], initial.run_events[run.id])
  }
  const changed = window.apply({ ...bounded, messages: { [message.session_id]: [{ ...message,
    parts: [...message.parts, agentTextPartFixture({ id: 'latest', sequence: 201 })],
  }] } })
  assert.equal(changed.messages[message.session_id]![0]!.parts.length, 200)
  assert.equal(changed.messages[message.session_id]![0]!.parts[199]!.id, 'latest')
})
