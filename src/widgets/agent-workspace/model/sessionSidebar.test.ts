import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentSessionGroup } from '#entities/agent'
import type { AgentWorkspaceSession } from './types.ts'
import { parseSessionSidebarCollapsed, partitionSidebarSessions, sessionSidebarNameValid, validSessionSidebarDrop } from './sessionSidebar.ts'

const groups: AgentSessionGroup[] = [
  { id: 'g1', name: 'Ops', sort_order: 2, revision: 1, created_at: '', updated_at: '' },
  { id: 'g2', name: 'Ops', sort_order: 1, revision: 1, created_at: '', updated_at: '' },
]
function session(id: string, extra: Partial<AgentWorkspaceSession> = {}): AgentWorkspaceSession {
  return { id, title: id, model_id: 'model', model_name: 'Model', updated_at: '2026-01-02T00:00:00Z', archived: false, run_status: 'idle', ...extra }
}

test('全局置顶去重、普通会话按聊天活动排序、失效分组回退未分组', () => {
  const pinned = session('pin', { pinned: true, group_id: 'g1', pin_order: 0 })
  const result = partitionSidebarSessions([
    pinned, pinned,
    session('old', { group_id: 'g1', last_activity_at: '2026-01-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z' }),
    session('recent', { group_id: 'g1', last_activity_at: '2026-02-01T00:00:00Z' }),
    session('orphan', { group_id: 'deleted' }), session('archived', { archived: true, pinned: true }),
  ], groups)
  assert.deepEqual(result.pinned.map(({ id }) => id), ['pin'])
  assert.deepEqual(result.grouped.get('g1')?.map(({ id }) => id), ['recent', 'old'])
  assert.deepEqual(result.ungrouped.map(({ id }) => id), ['orphan'])
  assert.deepEqual(result.groups.map(({ id }) => id), ['g2', 'g1'])
})

test('标题按 UTF-8 字节、分组按 Unicode 字符验证并安全读取折叠偏好', () => {
  assert.equal(sessionSidebarNameValid('中'.repeat(66)), true)
  assert.equal(sessionSidebarNameValid('中'.repeat(67)), false)
  assert.equal(sessionSidebarNameValid('😀'.repeat(64), 200, 64), true)
  assert.equal(sessionSidebarNameValid('😀'.repeat(65), 200, 64), false)
  assert.equal(sessionSidebarNameValid('   '), false)
  assert.deepEqual(parseSessionSidebarCollapsed(['g1', null, 'g1', '', 2]), ['g1'])
  assert.deepEqual(parseSessionSidebarCollapsed({ g1: true }), [])
})

test('普通会话活动时间相同按 ID 降序，与 Core 和工作区顺序保持一致', () => {
  const result = partitionSidebarSessions([
    session('a-grouped', { group_id: 'g1' }), session('z-grouped', { group_id: 'g1' }),
    session('a-ungrouped'), session('z-ungrouped'),
    session('z-pin', { pinned: true, pin_order: 0 }), session('a-pin', { pinned: true, pin_order: 0 }),
  ], groups.map((group) => ({ ...group, sort_order: 0 })))
  assert.deepEqual(result.grouped.get('g1')?.map(({ id }) => id), ['z-grouped', 'a-grouped'])
  assert.deepEqual(result.ungrouped.map(({ id }) => id), ['z-ungrouped', 'a-ungrouped'])
  assert.deepEqual(result.pinned.map(({ id }) => id), ['a-pin', 'z-pin'])
  assert.deepEqual(result.groups.map(({ id }) => id), ['g1', 'g2'])
})

test('拖动要求当前有效内部源，支持普通和置顶行互相排序并阻止忙碌目标', () => {
  const sessions = [session('a', { group_id: 'g1' }), session('p1', { pinned: true }), session('p2', { pinned: true })]
  const empty = new Set<string>()
  assert.equal(validSessionSidebarDrop(undefined, { kind: 'group', id: 'g2' }, sessions, groups, empty), false)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'removed' }, { kind: 'group', id: 'g2' }, sessions, groups, empty), false)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'a' }, { kind: 'group', id: 'g1' }, sessions, groups, empty), false)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'a' }, { kind: 'group', id: 'g2' }, sessions, groups, empty), true)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'a' }, { kind: 'group', id: 'g2' }, sessions, groups, new Set(['g2'])), false)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'a' }, { kind: 'pin-area' }, sessions, groups, empty), true)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'a' }, { kind: 'session-order', id: 'p1', placement: 'before' }, sessions, groups, empty), true)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'p1' }, { kind: 'session-order', id: 'a', placement: 'after' }, sessions, groups, empty), true)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'p1' }, { kind: 'session-order', id: 'p2', placement: 'after' }, sessions, groups, empty), true)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'a' }, { kind: 'session-order', id: 'p1', placement: 'before' }, sessions, groups, new Set(['pin-order'])), false)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'p1' }, { kind: 'session-order', id: 'a', placement: 'after' }, sessions, groups, new Set(['g1'])), false)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'p1' }, { kind: 'session-order', id: 'a', placement: 'after' }, sessions, groups, new Set(['session-order'])), false)
  assert.equal(validSessionSidebarDrop({ kind: 'session', id: 'a' }, { kind: 'session-order', id: 'a', placement: 'before' }, sessions, groups, empty), false)
  assert.equal(validSessionSidebarDrop({ kind: 'group', id: 'g1' }, { kind: 'group-order', id: 'g2', placement: 'before' }, sessions, groups, empty), true)
  assert.equal(validSessionSidebarDrop({ kind: 'group', id: 'g1' }, { kind: 'group-order', id: 'g2', placement: 'before' }, sessions, groups, new Set(['group-order'])), false)
})

test('普通会话使用持久顺序且不受活动时间更新影响，旧数据才按活动回退', () => {
  const result = partitionSidebarSessions([
    session('old-high', { sort_order: 20, group_id: 'g1', last_activity_at: '2025-01-01T00:00:00Z' }),
    session('new-low', { sort_order: 10, group_id: 'g1', last_activity_at: '2026-09-01T00:00:00Z' }),
    session('a-equal', { sort_order: 20, group_id: 'g1', last_activity_at: '2026-08-01T00:00:00Z' }),
    session('a-legacy', { last_activity_at: '2026-01-01T00:00:00Z' }),
    session('z-legacy', { last_activity_at: '2026-02-01T00:00:00Z' }),
  ], groups)
  assert.deepEqual(result.grouped.get('g1')?.map(({ id }) => id), ['old-high', 'a-equal', 'new-low'])
  assert.deepEqual(result.ungrouped.map(({ id }) => id), ['z-legacy', 'a-legacy'])
})
