import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AgentRuntimeProtocolError,
  decodeAgentSession,
  decodeAgentSessionGroup,
  decodeAgentSessionGroups,
  decodeAgentSessionPins,
  decodeAgentSessionMoveResult,
  decodeAgentWorkspaceEvent,
} from './agentRuntimeProtocol.ts'
import { agentFixtureTime, agentSessionFixture } from './agentRuntimeTestFixtures.ts'

function group(id = 'group-ops', name = '生产排查') {
  return { id, name, sort_order: 0, revision: 1, created_at: agentFixtureTime, updated_at: agentFixtureTime }
}

test('分组按 ID 唯一，同名分组仍可分别管理', () => {
  assert.throws(() => decodeAgentSessionGroups({ items: [group(), { ...group(), revision: 2 }] }), /重复 ID/)
  const decoded = decodeAgentSessionGroups({ items: [group('group-one'), group('group-two')] })
  assert.deepEqual(decoded.items.map(({ id }) => id), ['group-one', 'group-two'])
})

test('分组名称按 Unicode 字符限制，接受 64 个表情并拒绝超长或空白', () => {
  const maximum = '😀'.repeat(64)
  assert.equal(decodeAgentSessionGroup(group('group-ops', maximum)).name, maximum)
  for (const invalid of ['', '  \t ', '中'.repeat(65), '😀'.repeat(65)]) {
    assert.throws(() => decodeAgentSessionGroup(group('group-ops', invalid)), /分组名称无效/)
  }
})

test('置顶列表只接受未归档的明确置顶成员，并拒绝重复会话', () => {
  const pinned = { ...agentSessionFixture(), pinned: true, pin_order: 0 }
  assert.equal(decodeAgentSessionPins({ items: [pinned] }).items[0]?.id, pinned.id)
  for (const invalid of [
    { ...pinned, archived_at: agentFixtureTime },
    { ...pinned, pinned: false },
    agentSessionFixture(),
  ]) {
    assert.throws(() => decodeAgentSessionPins({ items: [invalid] }), /置顶列表成员无效/)
  }
  assert.throws(() => decodeAgentSessionPins({ items: [pinned, pinned] }), /重复 ID/)
})

test('旧会话响应可以缺少管理元数据，不伪造置顶状态或活动时间', () => {
  const legacy = decodeAgentSession(agentSessionFixture())
  for (const field of ['group_id', 'pinned', 'pin_order', 'sort_order', 'last_activity_at']) {
    assert.equal(Object.prototype.hasOwnProperty.call(legacy, field), false)
  }
  const grouped = decodeAgentSession({ ...agentSessionFixture(), group_id: 'group-ops' })
  assert.equal(grouped.group_id, 'group-ops')
  assert.equal(Object.prototype.hasOwnProperty.call(grouped, 'pinned'), false)
  assert.throws(() => decodeAgentSession({ ...agentSessionFixture(), pinned: 'false' }), AgentRuntimeProtocolError)
  assert.throws(() => decodeAgentSession({ ...agentSessionFixture(), last_activity_at: 'yesterday' }), AgentRuntimeProtocolError)
})

test('会话位置只接受安全非负整数，移动回执拒绝归档成员和重复 ID', () => {
  assert.equal(decodeAgentSession({ ...agentSessionFixture(), sort_order: 0 }).sort_order, 0)
  for (const sort_order of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '3']) {
    assert.throws(() => decodeAgentSession({ ...agentSessionFixture(), sort_order }), /会话顺序无效/)
  }
  const moved = { ...agentSessionFixture(), sort_order: 2 }
  assert.equal(decodeAgentSessionMoveResult({ items: [moved] }).items[0]?.sort_order, 2)
  assert.throws(() => decodeAgentSessionMoveResult({ items: [moved, moved] }), /重复 ID/)
  assert.throws(() => decodeAgentSessionMoveResult({ items: [{ ...moved, archived_at: agentFixtureTime }] }), /归档成员/)
})

test('Workspace 快照兼容旧版本缺省分组，并拒绝重复分组 ID', () => {
  const snapshot = { type: 'snapshot', revision: 0, sessions: [agentSessionFixture()], active_runs: [] }
  const legacy = decodeAgentWorkspaceEvent(snapshot)
  assert.equal(legacy.type, 'snapshot')
  if (legacy.type !== 'snapshot') throw new Error('未返回快照')
  assert.deepEqual(legacy.session_groups, [])
  const current = decodeAgentWorkspaceEvent({ ...snapshot, session_groups: [group()] })
  if (current.type !== 'snapshot') throw new Error('未返回快照')
  assert.equal(current.session_groups?.[0]?.id, 'group-ops')
  assert.throws(() => decodeAgentWorkspaceEvent({ ...snapshot, session_groups: [group(), group()] }), /重复 ID/)
})

test('分组 upsert 接受单实体，拒绝与会话并列或以数组代替', () => {
  const event = decodeAgentWorkspaceEvent({ type: 'upsert', revision: 1, session_group: group() })
  if (event.type !== 'upsert') throw new Error('未返回 upsert')
  assert.equal(event.session_group?.id, 'group-ops')
  assert.throws(() => decodeAgentWorkspaceEvent({
    type: 'upsert', revision: 1, session_group: group(), session: agentSessionFixture(),
  }), /必须只包含一个实体/)
  assert.throws(() => decodeAgentWorkspaceEvent({ type: 'upsert', revision: 1, session_groups: [group()] }), /必须只包含一个实体/)
  assert.throws(() => decodeAgentWorkspaceEvent({ type: 'upsert', revision: 1, session_group: [group()] }), AgentRuntimeProtocolError)
})
