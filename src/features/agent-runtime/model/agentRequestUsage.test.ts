import assert from 'node:assert/strict'
import test from 'node:test'
import { maxAgentMessageRequestUsage } from '#common/contracts'
import type { AgentRequestUsage } from '#entities/agent'
import { applyAgentWorkspaceEvent, createAgentWorkspaceState, mergeAgentMessages, replaceAgentRun } from './agentWorkspaceState.ts'
import { agentMessageFixture, agentRunFixture, agentSessionFixture, agentFixtureTime } from './agentRuntimeTestFixtures.ts'

const usage = (index: number): AgentRequestUsage => ({
  request_index: index, purpose: 'response', tool_count: 3, schema_bytes: 100, schema_tokens_estimate: 34,
  images: [], usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 2, estimated: false }, duration_ms: 10, outcome: 'completed',
})

test('长任务的实时统计和迟到水合均保留最近窗口，不重置序号或累计用量', () => {
  const run = agentRunFixture()
  const message = agentMessageFixture({ id: run.assistant_message_id, session_id: run.session_id })
  let state = replaceAgentRun(createAgentWorkspaceState(), run)
  state.sessions = [agentSessionFixture()]
  state = mergeAgentMessages(state, run.session_id, [message])
  for (let i = 1; i <= maxAgentMessageRequestUsage + 2; i++) {
    state = applyAgentWorkspaceEvent(state, { type: 'upsert', revision: i, run_event: {
      id: `metrics-${i}`, run_id: run.id, generation: run.generation, sequence: i,
      kind: 'request_usage', payload: { request_usage: usage(i) }, created_at: agentFixtureTime,
    } }).state
  }
  state = mergeAgentMessages(state, run.session_id, [{ ...message, request_usage: [usage(1)] }])
  const requests = state.messages[run.session_id]![0]!.request_usage!
  assert.equal(requests.length, maxAgentMessageRequestUsage)
  assert.equal(requests[0]!.request_index, 3)
  assert.equal(requests[requests.length - 1]!.request_index, maxAgentMessageRequestUsage + 2)
  assert.equal(state.run_events[run.id]?.filter((event) => event.kind === 'request_usage').length, maxAgentMessageRequestUsage)
  assert.deepEqual(state.runs[run.id]!.usage, run.usage)
})
