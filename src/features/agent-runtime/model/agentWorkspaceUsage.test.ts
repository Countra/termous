import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSessionUsage } from '#entities/agent'
import { agentFixtureTime, agentSessionFixture } from './agentRuntimeTestFixtures.ts'
import { createAgentWorkspaceState, replaceAgentSessions } from './agentWorkspaceState.ts'
import {
  acceptAgentSessionUsage,
  beginAgentSessionUsageLoad,
  failAgentSessionUsageLoad,
} from './agentWorkspaceUsage.ts'

test('Token 统计加载和失败时保留最近一次成功快照', () => {
  const session = agentSessionFixture()
  let state = { ...createAgentWorkspaceState(), sessions: [session] }
  const usage = usageFixture()

  state = acceptAgentSessionUsage(state, usage)
  state = beginAgentSessionUsageLoad(state, session.id)
  assert.equal(state.session_usages[session.id]?.phase, 'loading')
  assert.equal(state.session_usages[session.id]?.value, usage)

  state = failAgentSessionUsageLoad(state, session.id, 'NETWORK_ERROR')
  assert.equal(state.session_usages[session.id]?.phase, 'error')
  assert.equal(state.session_usages[session.id]?.value, usage)
  assert.equal(state.session_usages[session.id]?.error_code, 'NETWORK_ERROR')
})

test('会话列表替换会清理已删除会话的 Token 统计', () => {
  const session = agentSessionFixture()
  let state = { ...createAgentWorkspaceState(), sessions: [session] }
  state = acceptAgentSessionUsage(state, usageFixture())

  state = replaceAgentSessions(state, [])

  assert.deepEqual(state.session_usages, {})
  assert.equal(failAgentSessionUsageLoad(state, session.id, 'NETWORK_ERROR'), state)
})

function usageFixture(overrides: Partial<AgentSessionUsage> = {}): AgentSessionUsage {
  return {
    session_id: 'ags-session',
    run_count: 2,
    input_tokens: 1_000,
    output_tokens: 240,
    reasoning_tokens: 40,
    total_tokens: 1_240,
    estimated: false,
    updated_at: agentFixtureTime,
    ...overrides,
  }
}
