import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session } from '#entities/session'
import type { Host } from '#entities/host'
import {
  buildCommandDispatchSessionOptions,
  commandDispatchUTF8ByteLength,
  containsCommandLineBreak,
  maximumCommandDispatchBytes,
  pruneCommandDispatchSelection,
  resolveCommandDispatchTargetIds,
} from './commandDispatchSelection.ts'

const sessions: Session[] = [
  createSession('ssh-active', 'ssh', 'connected'),
  createSession('ssh-selected', 'ssh', 'connected'),
  createSession('ssh-offline', 'ssh', 'disconnected'),
  createSession('local-active', 'local', 'connected'),
]

test('命令范围只解析已连接 SSH 会话并保持会话顺序', () => {
  assert.deepEqual(resolveCommandDispatchTargetIds({
    scope: 'all',
    sessions,
    activeSessionId: 'ssh-active',
    selectedSessionIds: new Set(),
  }), ['ssh-active', 'ssh-selected'])
  assert.deepEqual(resolveCommandDispatchTargetIds({
    scope: 'selected',
    sessions,
    selectedSessionIds: new Set(['ssh-selected', 'ssh-offline', 'local-active']),
  }), ['ssh-selected'])
})

test('当前范围拒绝本地和断开会话', () => {
  for (const activeSessionId of ['local-active', 'ssh-offline', 'missing']) {
    assert.deepEqual(resolveCommandDispatchTargetIds({
      scope: 'current',
      sessions,
      activeSessionId,
      selectedSessionIds: new Set(),
    }), [])
  }
})

test('指定选择会移除不再符合条件的会话', () => {
  assert.deepEqual(
    [...pruneCommandDispatchSelection(
      new Set(['ssh-active', 'ssh-offline', 'local-active']),
      sessions,
    )],
    ['ssh-active'],
  )
})

test('单行命令拒绝所有换行形式但保留完整 Shell 语法', () => {
  assert.equal(containsCommandLineBreak('printf x && echo y | sed s/x/y/'), false)
  assert.equal(containsCommandLineBreak('echo one\necho two'), true)
  assert.equal(containsCommandLineBreak('echo one\recho two'), true)
})

test('命令大小按 UTF-8 字节而非 JavaScript 字符数计算', () => {
  assert.equal(commandDispatchUTF8ByteLength('a'.repeat(maximumCommandDispatchBytes)), 8192)
  assert.equal(commandDispatchUTF8ByteLength('中'.repeat(3)), 9)
})

test('指定会话选项包含会话名、主机名与端点搜索文本', () => {
  const host: Host = {
    id: 'host-1',
    name: '阿里云-上海',
    platform: 'linux',
    group_id: 'group-1',
    address: '203.0.113.7',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential-1',
    tags: [],
    favorite: false,
    fingerprint_policy: 'strict',
  }
  const options = buildCommandDispatchSessionOptions(
    [{ ...sessions[0]!, host_id: host.id }],
    [host],
    () => '生产终端',
  )
  assert.deepEqual(options[0], {
    sessionId: 'ssh-active',
    sessionName: '生产终端',
    hostName: '阿里云-上海',
    endpoint: 'root@203.0.113.7:22',
    searchValue: '生产终端\n阿里云-上海\nroot@203.0.113.7:22',
  })
})

function createSession(
  id: string,
  kind: Session['kind'],
  status: Session['status'],
): Session {
  return {
    id,
    kind,
    status,
    started_at: '2026-08-12T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
  }
}
