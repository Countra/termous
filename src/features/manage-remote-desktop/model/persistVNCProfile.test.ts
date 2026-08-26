import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
} from '#entities/remote-desktop'
import {
  persistVNCProfile,
  VNCTargetAuthPersistenceError,
} from './persistVNCProfile.ts'

const input: RemoteDesktopAccessProfileInput = {
  host_id: 'hst_test',
  name: 'Desktop',
  description: '',
  route: 'ssh_tunnel',
  route_config_version: 1,
  ssh_profile_id: 'ssh_test',
  protocol: 'vnc',
  protocol_config_version: 1,
  vnc: {
    loopback_host: '127.0.0.1',
    port: 5901,
    shared: true,
    default_view_only: false,
    default_display_mode: 'fit',
  },
}

test('新建 Profile 后用返回版本写入目标凭据', async () => {
  const created = profile('2026-08-26T01:00:01Z')
  const withAuth = { ...created, target_auth: { credential_id: 'cred_vnc', updated_at: '2026-08-26T01:00:02Z' }, updated_at: '2026-08-26T01:00:02Z' }
  const calls: string[] = []
  const result = await persistVNCProfile({
    input,
    existingProfile: null,
    metadataDirty: true,
    targetAuthDraft: { mutation: 'replace', password: 'secret' },
    gateway: {
      createRemoteDesktopProfile: async () => { calls.push('create'); return created },
      updateRemoteDesktopProfile: async () => assert.fail('新建流程不应更新 Profile'),
      saveRemoteDesktopTargetAuth: async (id, version, password) => {
        calls.push(`auth:${id}:${version}:${password}`)
        return withAuth
      },
      deleteRemoteDesktopTargetAuth: async () => assert.fail('不应删除凭据'),
    },
    beforeTargetAuth: async () => { calls.push('reconcile') },
  })
  assert.deepEqual(calls, [
    'create',
    `reconcile`,
    `auth:${created.id}:${created.updated_at}:secret`,
  ])
  assert.deepEqual(result, { profile: withAuth, metadataSaved: true })
})

test('凭据失败保留已成功 Profile 和部分成功信息', async () => {
  const created = profile('2026-08-26T01:00:01Z')
  const failure = new Error('vault unavailable')
  await assert.rejects(
    persistVNCProfile({
      input,
      existingProfile: null,
      metadataDirty: true,
      targetAuthDraft: { mutation: 'replace', password: 'secret' },
      gateway: {
        createRemoteDesktopProfile: async () => created,
        updateRemoteDesktopProfile: async () => assert.fail('不应更新 Profile'),
        saveRemoteDesktopTargetAuth: async () => { throw failure },
        deleteRemoteDesktopTargetAuth: async () => assert.fail('不应删除凭据'),
      },
    }),
    (error) => error instanceof VNCTargetAuthPersistenceError
      && error.profile === created
      && error.metadataSaved
      && error.cause === failure,
  )
})

test('仅修改凭据时不重复 PATCH Profile', async () => {
  const existing = profile('2026-08-26T01:00:01Z')
  let deleted = false
  const result = await persistVNCProfile({
    input,
    existingProfile: existing,
    metadataDirty: false,
    targetAuthDraft: { mutation: 'remove', password: '' },
    gateway: {
      createRemoteDesktopProfile: async () => assert.fail('不应创建 Profile'),
      updateRemoteDesktopProfile: async () => assert.fail('不应更新 Profile'),
      saveRemoteDesktopTargetAuth: async () => assert.fail('不应保存凭据'),
      deleteRemoteDesktopTargetAuth: async (id, version) => {
        assert.deepEqual([id, version], [existing.id, existing.updated_at])
        deleted = true
        return { ...existing, target_auth: null, updated_at: '2026-08-26T01:00:02Z' }
      },
    },
  })
  assert.equal(deleted, true)
  assert.equal(result.metadataSaved, false)
  assert.equal(result.profile.target_auth, null)
})

function profile(updatedAt: string): RemoteDesktopAccessProfile {
  return {
    id: 'rdp_test',
    ...input,
    is_default: true,
    sort_order: 0,
    target_auth: null,
    created_at: '2026-08-26T01:00:00Z',
    updated_at: updatedAt,
  }
}
