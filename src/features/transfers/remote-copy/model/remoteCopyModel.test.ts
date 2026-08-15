import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession, RemoteFileEntry } from '#entities/file'
import type { Host } from '#entities/host'
import {
  buildRemotePathBreadcrumbs,
  filterRemoteCopyTargetSessions,
  normalizeRemoteCopyBatchDirectory,
  normalizeRemoteCopyDirectory,
  normalizeRemoteCopyFolderName,
  rebindRemoteCopyBatchFailures,
  reconcileRemoteCopyBatchSelection,
  remoteCopyParentPath,
  toggleRemoteCopyBatchTarget,
  validateRemoteCopySource,
} from './remoteCopyModel.ts'
import {
  remoteCopyBatchTargetLimit,
  type RemoteCopyBatchFailure,
} from './types.ts'

function host(id: string, name: string): Host {
  return {
    id,
    name,
    platform: 'linux',
    group_id: '',
    address: `${id}.example.com`,
    port: 22,
    username: 'tester',
    auth_method: 'password',
    credential_id: 'credential',
    tags: [],
    favorite: false,
    fingerprint_policy: 'strict',
  }
}

function session(
  id: string,
  hostId: string,
  patch: Partial<FileSession> = {},
): FileSession {
  return {
    id,
    host_id: hostId,
    status: 'connected',
    current_path: '/home/tester',
    started_at: '2026-08-15T00:00:00Z',
    connection_generation: 1,
    ...patch,
  }
}

test('跨主机目标只保留其他主机上可冻结 generation 的连接会话', () => {
  const hosts = [host('source', '源主机'), host('target', '目标主机')]
  const sessions = [
    session('source-session', 'source'),
    session('target-a-12345678', 'target'),
    session('target-b-87654321', 'target'),
    session('disconnected', 'target', { status: 'disconnected' }),
    session('missing-generation', 'target', { connection_generation: undefined }),
  ]

  const result = filterRemoteCopyTargetSessions(hosts, sessions, 'source')

  assert.deepEqual(result.map((item) => item.session.id), [
    'target-a-12345678',
    'target-b-87654321',
  ])
  assert.equal(result[0]?.duplicateHostSession, true)
  assert.equal(result[0]?.shortSessionId, '12345678')
  assert.deepEqual(
    filterRemoteCopyTargetSessions(hosts, sessions, 'source', '8765').map((item) => item.session.id),
    ['target-b-87654321'],
  )
})

test('路径模型严格使用远端绝对 POSIX 路径', () => {
  assert.equal(normalizeRemoteCopyDirectory('/srv//releases/../incoming'), '/srv/incoming')
  assert.equal(normalizeRemoteCopyDirectory('relative', '/home/tester'), '/home/tester')
  assert.equal(remoteCopyParentPath('/srv/incoming'), '/srv')
  assert.equal(remoteCopyParentPath('/'), '/')
  assert.deepEqual(buildRemotePathBreadcrumbs('/srv/incoming'), [
    { label: '/', path: '/' },
    { label: 'srv', path: '/srv' },
    { label: 'incoming', path: '/srv/incoming' },
  ])
})

test('批量目标目录只接受显式的绝对 POSIX 路径', () => {
  assert.equal(normalizeRemoteCopyBatchDirectory('/srv//releases/../incoming'), '/srv/incoming')
  assert.equal(normalizeRemoteCopyBatchDirectory('relative/path'), null)
  assert.equal(normalizeRemoteCopyBatchDirectory('~/incoming'), null)
  assert.equal(normalizeRemoteCopyBatchDirectory(''), null)
})

test('批量目标选择按主机互斥、清理失效会话并限制为十六台', () => {
  const hosts = [host('source', '源主机')]
  const sessions = [session('source-session', 'source')]
  for (let index = 0; index < remoteCopyBatchTargetLimit + 1; index += 1) {
    const hostId = `target-${index}`
    hosts.push(host(hostId, `目标 ${index}`))
    sessions.push(session(`session-${index}`, hostId))
  }
  sessions.push(session('session-0-new', 'target-0', { connection_generation: 2 }))
  const targets = filterRemoteCopyTargetSessions(hosts, sessions, 'source')

  const replaced = toggleRemoteCopyBatchTarget(['session-0'], 'session-0-new', targets)
  assert.deepEqual(replaced, { sessionIds: ['session-0-new'], limitReached: false })

  const fullSelection = Array.from(
    { length: remoteCopyBatchTargetLimit },
    (_, index) => `session-${index}`,
  )
  const limited = toggleRemoteCopyBatchTarget(
    fullSelection,
    `session-${remoteCopyBatchTargetLimit}`,
    targets,
  )
  assert.deepEqual(limited, { sessionIds: fullSelection, limitReached: true })
  assert.deepEqual(
    reconcileRemoteCopyBatchSelection(
      ['missing', 'session-0', 'session-0-new', ...fullSelection.slice(1)],
      targets,
    ),
    fullSelection,
  )
})

test('批量失败状态按主机绑定到重连后的最新会话', () => {
  const hosts = [host('source', '源主机'), host('target', '目标主机')]
  const targets = filterRemoteCopyTargetSessions(hosts, [
    session('source-session', 'source'),
    session('target-session-new', 'target', { connection_generation: 2 }),
  ], 'source')
  const failure: RemoteCopyBatchFailure = {
    sessionId: 'target-session-old',
    hostId: 'target',
    hostName: '旧名称',
    message: 'files.remoteCopy.batchUncertain',
    retryable: false,
  }

  assert.deepEqual(rebindRemoteCopyBatchFailures([failure], targets), [{
    ...failure,
    sessionId: 'target-session-new',
    hostName: '目标主机',
  }])
  assert.deepEqual(rebindRemoteCopyBatchFailures([failure], []), [failure])
})

test('新建目录名称只能是安全的单一 POSIX 路径段', () => {
  assert.equal(normalizeRemoteCopyFolderName('  发布目录  '), '发布目录')
  assert.equal(normalizeRemoteCopyFolderName('release-2026'), 'release-2026')
  assert.equal(normalizeRemoteCopyFolderName(''), null)
  assert.equal(normalizeRemoteCopyFolderName('.'), null)
  assert.equal(normalizeRemoteCopyFolderName('..'), null)
  assert.equal(normalizeRemoteCopyFolderName('../escape'), null)
  assert.equal(normalizeRemoteCopyFolderName('nested/path'), null)
  assert.equal(normalizeRemoteCopyFolderName('line\nbreak'), null)
  assert.equal(normalizeRemoteCopyFolderName('\uD800'), null)
})

test('顶层符号链接和特殊条目不会进入跨主机传输', () => {
  const entry = (kind: RemoteFileEntry['kind']) => ({ kind })
  assert.deepEqual(validateRemoteCopySource([]), { valid: false, reason: 'empty' })
  assert.deepEqual(validateRemoteCopySource([entry('file'), entry('directory')]), { valid: true })
  assert.deepEqual(validateRemoteCopySource([entry('symlink')]), { valid: false, reason: 'unsupported' })
  assert.deepEqual(validateRemoteCopySource([entry('other')]), { valid: false, reason: 'unsupported' })
})
