import assert from 'node:assert/strict'
import test from 'node:test'
import { agentSessionFixture } from './agentRuntimeTestFixtures.ts'
import {
  acceptAgentSessionContext,
  failAgentSessionContextLoad,
  setAgentContextCompressionPending,
  markAgentSessionContextPending,
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

test('未知整理能力保留预约，加载失败也不清空，明确不可用后才取消', () => {
  const session = agentSessionFixture()
  let state = { ...createAgentWorkspaceState(), sessions: [session] }
  state = setAgentContextCompressionPending(state, session.id, true)
  const context = {
    session_id: session.id, model_id: session.model_id, assessment: 'pending' as const,
    estimated_tokens: 0, context_window_tokens: 32_768, estimated: true,
    warning: false, compression_available: false, compression_status: 'unknown' as const,
  }
  state = acceptAgentSessionContext(state, context)
  assert.equal(state.session_contexts[session.id]?.compression_pending, true)
  state = failAgentSessionContextLoad(state, session.id, 'NETWORK_ERROR')
  assert.equal(state.session_contexts[session.id]?.compression_pending, true)
  assert.equal(state.session_contexts[session.id]?.value, context)
  state = acceptAgentSessionContext(state, { ...context, assessment: 'ready', compression_status: 'unavailable' })
  assert.equal(state.session_contexts[session.id]?.compression_pending, false)
})

test('模型切换保存上次模型自己的窗口和占用，拒绝其他模型迟到的 HTTP 结果', () => {
  const session = agentSessionFixture()
  let state = { ...createAgentWorkspaceState(), sessions: [session] }
  state = acceptAgentSessionContext(state, {
    session_id: session.id, model_id: session.model_id, assessment: 'ready',
    estimated_tokens: 67_749, context_window_tokens: 101_072, estimated: true,
    warning: true, compression_available: false, compression_status: 'unknown', basis: 'provider_usage',
    last_snapshot: { model_id: session.model_id, model_name: 'GPT', estimated_tokens: 67_000, context_window_tokens: 101_072 },
  })
  state = { ...state, sessions: [{ ...session, model_id: 'apm-next' }] }
  state = markAgentSessionContextPending(state, session.id, 'apm-next', session.model_id)
  const value = state.session_contexts[session.id]?.value
  assert.equal(value?.assessment, 'pending')
  assert.equal(value?.estimated_tokens, 0)
  assert.equal(value?.warning, false)
  assert.deepEqual(value?.last_snapshot, {
    model_id: session.model_id, model_name: 'GPT', estimated_tokens: 67_749,
    context_window_tokens: 101_072, basis: 'provider_usage',
  })
  assert.equal(acceptAgentSessionContext(state, { ...value!, model_id: session.model_id, assessment: 'ready' }), state)
})
