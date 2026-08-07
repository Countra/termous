import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session } from '#entities/session'
import {
  parseSessionTabPreferences,
  pruneSessionTabPreferences,
  sortSessionsForTabs,
} from './sessionTabPreferences.ts'

test('会话标签偏好会归一化持久化值并过滤无效项', () => {
  assert.deepEqual(parseSessionTabPreferences(null), {})
  assert.deepEqual(parseSessionTabPreferences([]), {})
  assert.deepEqual(parseSessionTabPreferences({
    '': { title: 'ignored' },
    invalid: 'value',
    empty: { title: '  ', color: 'red' },
    valid: {
      title: '  Production  ',
      color: ' #AABBCC ',
      pinned: true,
      pinnedAt: 42,
    },
  }), {
    valid: {
      title: 'Production',
      color: '#aabbcc',
      pinned: true,
      pinnedAt: 42,
    },
  })
})

test('固定会话按固定时间倒序排列，其他会话保持原顺序', () => {
  const sessions = [
    { id: 'first' },
    { id: 'older-pinned' },
    { id: 'second' },
    { id: 'newer-pinned' },
  ] as Session[]
  const snapshot = [...sessions]

  const sorted = sortSessionsForTabs(sessions, {
    'older-pinned': { pinned: true, pinnedAt: 10 },
    'newer-pinned': { pinned: true, pinnedAt: 20 },
  })

  assert.deepEqual(sorted.map((session) => session.id), [
    'newer-pinned',
    'older-pinned',
    'first',
    'second',
  ])
  assert.deepEqual(sessions, snapshot)
})

test('清理会话标签偏好时只保留仍存在的会话', () => {
  assert.deepEqual(pruneSessionTabPreferences({
    active: { title: 'Active' },
    retired: { color: '#aabbcc' },
  }, ['active']), {
    active: { title: 'Active' },
  })
})
