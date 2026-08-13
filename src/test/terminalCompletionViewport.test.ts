import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shouldActivateTerminalCompletionViewport,
  transitionTerminalCompletionActivity,
} from '../features/terminal/model/terminalCompletionViewport.ts'

test('只有当前工作区内已连接的活动 SSH 分屏允许补全交互', () => {
  const base = {
    sessionId: 'ssh-a',
    sessionKind: 'ssh' as const,
    sessionStatus: 'connected' as const,
    paneActive: true,
    workspaceActive: true,
    searchOpen: false,
    contextMenuOpen: false,
  }

  assert.equal(shouldActivateTerminalCompletionViewport(base), true)
  assert.equal(shouldActivateTerminalCompletionViewport({ ...base, paneActive: false }), false)
  assert.equal(shouldActivateTerminalCompletionViewport({ ...base, workspaceActive: false }), false)
  assert.equal(shouldActivateTerminalCompletionViewport({ ...base, searchOpen: true }), false)
  assert.equal(shouldActivateTerminalCompletionViewport({ ...base, contextMenuOpen: true }), false)
  assert.equal(shouldActivateTerminalCompletionViewport({ ...base, sessionKind: 'local' }), false)
  assert.equal(shouldActivateTerminalCompletionViewport({ ...base, sessionStatus: 'disconnected' }), false)
  assert.equal(shouldActivateTerminalCompletionViewport({ ...base, sessionId: null }), false)
})

test('活动分屏从 A 切换到 B 时关闭 A 的候选并激活 B', () => {
  assert.deepEqual(
    transitionTerminalCompletionActivity('ssh-a', true, 'ssh-a', false),
    { changed: true, active: false, closeSessionId: 'ssh-a' },
  )
  assert.deepEqual(
    transitionTerminalCompletionActivity('ssh-b', false, 'ssh-b', true),
    { changed: true, active: true, closeSessionId: null },
  )
})

test('重复状态与迟到的旧会话更新不会关闭或改变当前分屏', () => {
  assert.deepEqual(
    transitionTerminalCompletionActivity('ssh-b', true, 'ssh-b', true),
    { changed: false, active: true, closeSessionId: null },
  )
  assert.deepEqual(
    transitionTerminalCompletionActivity('ssh-b', true, 'ssh-a', false),
    { changed: false, active: true, closeSessionId: null },
  )
})
