import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginSnippetReload,
  canApplySnippetReload,
  initialSnippetRuntimeCursor,
  recoverFailedSnippetReload,
  resetSnippetEventRevision,
  snippetStateChangedSince,
} from './snippetRuntimeState.ts'

test('代码片段事件忽略重复和倒序 revision', () => {
  const first = beginSnippetReload(initialSnippetRuntimeCursor, 7)
  assert.ok(first.checkpoint)

  const duplicate = beginSnippetReload(first.cursor, 7)
  assert.equal(duplicate.checkpoint, null)
  assert.equal(duplicate.cursor, first.cursor)

  const older = beginSnippetReload(first.cursor, 6)
  assert.equal(older.checkpoint, null)
  assert.equal(older.cursor, first.cursor)
})

test('只有最新代码片段刷新结果可以写入状态', () => {
  const first = beginSnippetReload(initialSnippetRuntimeCursor, 7)
  const second = beginSnippetReload(first.cursor, 8)

  assert.ok(first.checkpoint)
  assert.ok(second.checkpoint)
  assert.equal(canApplySnippetReload(second.cursor, first.checkpoint), false)
  assert.equal(canApplySnippetReload(second.cursor, second.checkpoint), true)
  assert.equal(snippetStateChangedSince(second.cursor, first.cursor.generation), true)
})

test('WebSocket 重连刷新会重置事件 revision 并隔离旧请求', () => {
  const beforeReconnect = beginSnippetReload(initialSnippetRuntimeCursor, 12)
  const reconnect = resetSnippetEventRevision(beforeReconnect.cursor)
  const afterRestart = beginSnippetReload(reconnect, 1)

  assert.ok(afterRestart.checkpoint)
  assert.equal(afterRestart.cursor.eventRevision, 1)
  assert.equal(canApplySnippetReload(reconnect, beforeReconnect.checkpoint!), false)
})

test('最新刷新失败后允许相同 revision 重试', () => {
  const failed = beginSnippetReload(initialSnippetRuntimeCursor, 9)
  assert.ok(failed.checkpoint)

  const recovered = recoverFailedSnippetReload(failed.cursor, failed.checkpoint)
  const retry = beginSnippetReload(recovered, 9)

  assert.ok(retry.checkpoint)
  assert.equal(retry.cursor.eventRevision, 9)
})

test('旧请求失败不会回退更高 revision', () => {
  const first = beginSnippetReload(initialSnippetRuntimeCursor, 9)
  const latest = beginSnippetReload(first.cursor, 10)
  assert.ok(first.checkpoint)

  const recovered = recoverFailedSnippetReload(latest.cursor, first.checkpoint)

  assert.equal(recovered, latest.cursor)
  assert.equal(recovered.eventRevision, 10)
})
