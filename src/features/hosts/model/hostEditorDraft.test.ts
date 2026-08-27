import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostInput } from '#entities/host'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  mergeHostAssetDraft,
  mergeInitialSSHProfileDraft,
  projectHostAssetDraft,
  projectInitialSSHProfileDraft,
  selectInitialJumpProfiles,
} from './hostEditorDraft.ts'

const input: HostInput = {
  name: '生产主机',
  platform: 'linux',
  icon_id: 'icon-a',
  group_id: 'group-a',
  address: 'server.example.com',
  port: 22,
  username: 'root',
  auth_method: 'password',
  credential_id: 'credential-a',
  jump_host_id: 'host-jump',
  proxy_id: 'proxy-a',
  tags: ['prod'],
  favorite: false,
  fingerprint_policy: 'confirm_on_change',
  note: 'note',
}

const profileBase: SSHAccessProfile = {
  id: 'ssh-jump',
  host_id: 'host-jump',
  name: '默认 SSH',
  address: 'jump.example.com',
  port: 22,
  username: 'jump',
  auth_method: 'password',
  credential_id: 'credential-jump',
  fingerprint_policy: 'confirm_on_change',
  is_default: true,
  sort_order: 0,
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
}

test('主机资产草稿投影和回写不会覆盖连接配置', () => {
  const asset = projectHostAssetDraft(input)
  const merged = mergeHostAssetDraft(input, {
    ...asset,
    name: '新名称',
    tags: ['prod', 'linux'],
    favorite: true,
  })

  assert.equal(merged.name, '新名称')
  assert.deepEqual(merged.tags, ['prod', 'linux'])
  assert.equal(merged.favorite, true)
  assert.equal(merged.address, input.address)
  assert.equal(merged.credential_id, input.credential_id)
})

test('初始连接只允许选择每台主机唯一的默认 SSH Profile', () => {
  const profiles = [
    profileBase,
    { ...profileBase, id: 'ssh-secondary', is_default: false },
    { ...profileBase, id: 'ssh-ambiguous-a', host_id: 'host-ambiguous' },
    { ...profileBase, id: 'ssh-ambiguous-b', host_id: 'host-ambiguous' },
  ]

  assert.deepEqual(
    selectInitialJumpProfiles(profiles).map((profile) => profile.id),
    ['ssh-jump'],
  )
})

test('初始 SSH 草稿通过默认 Profile 在 Profile ID 与 Host ID 之间转换', () => {
  const draft = projectInitialSSHProfileDraft(input, [profileBase])
  assert.equal(draft.jump_ssh_profile_id, profileBase.id)

  const merged = mergeInitialSSHProfileDraft(input, {
    ...draft,
    address: 'new.example.com',
    port: 2202,
    jump_ssh_profile_id: profileBase.id,
  }, [profileBase])

  assert.equal(merged.address, 'new.example.com')
  assert.equal(merged.port, 2202)
  assert.equal(merged.jump_host_id, profileBase.host_id)
})
