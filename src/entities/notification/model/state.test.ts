import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeNotificationEvent, emptyNotificationState, mergeNotificationEvent } from './state.ts'

test('权威快照恢复已读和移除状态，乱序增量不能复活消息', () => {
  const raw = { id: 'a', kind: 'file', outcome: 'success', source_id: 'task', sequence: 1, occurred_at: new Date().toISOString(), operation: 'remote_copy', read: false, native_eligible: true, completed_files: 1, total_files: 1, skipped_items: 0 }
  let state = mergeNotificationEvent(emptyNotificationState, decodeNotificationEvent({ type: 'snapshot', page: { items: [raw], watermark: 1, unread_count: 1, next_before: 0 } }))
  state = mergeNotificationEvent(state, decodeNotificationEvent({ type: 'snapshot', page: { items: [], watermark: 1, unread_count: 0, next_before: 0 } }))
  state = mergeNotificationEvent(state, decodeNotificationEvent({ type: 'upsert', message: raw }))
  assert.equal(state.items.length, 0)
  assert.equal(state.unread, 0)
  assert.throws(() => decodeNotificationEvent({ type: 'upsert', message: { ...raw, sequence: NaN } }))
})
