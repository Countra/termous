import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAgentMessageRead } from './agentMessageRead.ts'
import { createAgentWorkspaceState, mergeAgentMessages } from './agentWorkspaceState.ts'
import { agentMessageFixture, agentTextPartFixture } from './agentRuntimeTestFixtures.ts'

test('消息回查只保留查询期间变化的实体，不保留权威列表移除的旧历史', () => {
  const old = agentMessageFixture({ id: 'removed', sequence: 1 })
  const changed = agentMessageFixture({ id: 'changed', sequence: 2 })
  const baseline = [old, changed]
  let state = mergeAgentMessages(createAgentWorkspaceState(), 'ags-session', baseline)
  state = mergeAgentMessages(state, 'ags-session', [
    { ...changed, revision: 3, parts: [agentTextPartFixture({ message_id: changed.id, text: '较新正文' })] },
    agentMessageFixture({ id: 'new', sequence: 3 }),
  ])
  const result = applyAgentMessageRead(state, 'ags-session', [changed], baseline)
  assert.deepEqual(result.messages['ags-session']?.map(({ id }) => id), ['changed', 'new'])
  assert.equal(result.messages['ags-session']?.[0]?.revision, 3)
  assert.deepEqual(result.messages['ags-session']?.[0]?.parts, state.messages['ags-session']?.[1]?.parts)
})

test('等版本回查仍补齐落盘正文，较新权威版本可以覆盖在途事件', () => {
  const baseline = [agentMessageFixture()]
  const current = agentMessageFixture({ status: 'streaming' })
  const state = mergeAgentMessages(createAgentWorkspaceState(), 'ags-session', [current])
  for (const revision of [1, 2]) {
    const incoming = agentMessageFixture({ revision, parts: [agentTextPartFixture()] })
    const result = applyAgentMessageRead(state, 'ags-session', [incoming], baseline)
    assert.deepEqual(result.messages['ags-session']?.[0]?.parts, incoming.parts)
    assert.equal(result.messages['ags-session']?.[0]?.revision, revision)
  }
})
