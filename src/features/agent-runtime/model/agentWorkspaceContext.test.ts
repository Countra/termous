import assert from 'node:assert/strict'
import test from 'node:test'
import { agentSessionFixture } from './agentRuntimeTestFixtures.ts'
import {
  acceptAgentSessionContext,
  failAgentSessionContextLoad,
  setAgentContextCompressionPending,
} from './agentWorkspaceContext.ts'
import { createAgentWorkspaceState } from './agentWorkspaceState.ts'

test('新上下文不支持压缩时清除旧的手工整理标记', () => {
  const session = agentSessionFixture()
  let state = { ...createAgentWorkspaceState(), sessions: [session] }
  state = setAgentContextCompressionPending(state, session.id, true)

  state = acceptAgentSessionContext(state, {
    session_id: session.id,
    estimated_tokens: 1_000,
    context_window_tokens: 8_192,
    estimated: true,
    warning: false,
    compression_available: false,
  })

  assert.equal(state.session_contexts[session.id]?.compression_pending, false)
})

test('已删除会话的迟到上下文失败不会留下孤立状态', () => {
  const state = createAgentWorkspaceState()
  const result = failAgentSessionContextLoad(state, 'ags-removed', 'NETWORK_ERROR')

  assert.equal(result, state)
  assert.equal(result.session_contexts['ags-removed'], undefined)
})
