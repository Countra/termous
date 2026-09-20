import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeFileSessionSnapshotEvent, normalizeFileSessionResponse } from './fileSessionSnapshot.ts'

const session = {
  id: 'files-dav', host_id: 'host-dav', file_access_profile_id: 'profile-dav',
  engine: 'webdav', namespace: 'profile:profile-dav', origin: 'app',
  current_path: '/', started_at: '2026-09-20T00:00:00Z', status: 'connected', connection_generation: 1,
  capabilities: ['browse', 'content_read', 'content_write', 'entry_mutate', 'batch_rename'],
}

test('WebDAV HTTP 与 WebSocket 会话使用同一解码且不依赖 SSH', () => {
  const decoded = normalizeFileSessionResponse(session)
  assert.equal(decoded.engine, 'webdav')
  assert.equal(decoded.ssh_profile_id, undefined)
  const event = decodeFileSessionSnapshotEvent({ type: 'file_session_snapshot', instance_id: 'core', revision: 1, sessions: [session] })
  assert.deepEqual(event.sessions, [decoded])
})

test('会话引擎采用合法标识和通用能力，同时保留 SFTP 身份校验', () => {
  assert.equal(normalizeFileSessionResponse({ ...session, engine: 'test_engine' }).engine, 'test_engine')
  for (const engine of ['', 'DAV', '../webdav', 'a'.repeat(33)]) {
    assert.throws(() => normalizeFileSessionResponse({ ...session, engine }))
  }
  assert.throws(() => normalizeFileSessionResponse({ ...session, engine: 'sftp' }))
  assert.throws(() => normalizeFileSessionResponse({ ...session, capabilities: ['unknown'] }))
})
