import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeFileAccessEngineDescriptors,
  decodeFileAccessProfile,
  decodeFileAccessProfileReferences,
  isSFTPFileAccessProfile,
} from './fileAccessProfileCodec.ts'

const base = {
  id: 'fap_1',
  host_id: 'hst_1',
  name: 'Files',
  engine: 'sftp',
  engine_config_version: 1,
  is_default: true,
  sort_order: 0,
  created_at: '2026-09-15T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
}

test('解码 canonical SFTP Profile 并保留兼容投影', () => {
  const profile = decodeFileAccessProfile({
    ...base,
    config: { ssh_profile_id: 'ssh_1' },
    sftp: { ssh_profile_id: 'ssh_1' },
    lifecycle_owner: { kind: 'ssh_profile', id: 'ssh_1' },
  })

  assert.equal(isSFTPFileAccessProfile(profile), true)
  assert.deepEqual(profile.config, { ssh_profile_id: 'ssh_1' })
  assert.deepEqual(profile.sftp, { ssh_profile_id: 'ssh_1' })
  assert.deepEqual(profile.lifecycle_owner, { kind: 'ssh_profile', id: 'ssh_1' })
})

test('仅有旧 SFTP 字段时生成 canonical 配置', () => {
  const profile = decodeFileAccessProfile({ ...base, sftp: { ssh_profile_id: 'ssh_legacy' } })
  assert.deepEqual(profile.config, { ssh_profile_id: 'ssh_legacy' })
  assert.deepEqual(profile.sftp, { ssh_profile_id: 'ssh_legacy' })
})

test('拒绝不一致或包含未知字段的 SFTP 兼容配置', () => {
  assert.throws(() => decodeFileAccessProfile({
    ...base,
    config: { ssh_profile_id: 'ssh_1' },
    sftp: { ssh_profile_id: 'ssh_2' },
  }), /兼容配置不一致/)
  assert.throws(() => decodeFileAccessProfile({
    ...base,
    config: { ssh_profile_id: 'ssh_1', password: 'secret' },
  }), /配置字段无效/)
})

test('解码 hostless 未知 Engine 时保持配置中立', () => {
  const sourceConfig = { bucket_id: 'bucket_1', options: { region: 'east' } }
  const profile = decodeFileAccessProfile({
    ...base,
    host_id: undefined,
    engine: 'object-store',
    engine_config_version: 3,
    config: sourceConfig,
    is_default: false,
  })

  assert.equal(profile.host_id, undefined)
  assert.equal(profile.engine, 'object-store')
  assert.deepEqual(profile.config, { bucket_id: 'bucket_1', options: { region: 'east' } })
  assert.equal(isSFTPFileAccessProfile(profile), false)
  sourceConfig.options.region = 'west'
  assert.deepEqual(profile.config, { bucket_id: 'bucket_1', options: { region: 'east' } })
})

test('严格解码 Engine Descriptor 与引用摘要', () => {
  assert.deepEqual(decodeFileAccessEngineDescriptors([{
    id: 'sftp',
    config_versions: [1],
    current_config_version: 1,
    host_scope: 'required',
    capabilities: ['list', 'read'],
  }]), [{
    id: 'sftp',
    config_versions: [1],
    current_config_version: 1,
    host_scope: 'required',
    capabilities: ['list', 'read'],
  }])
  assert.deepEqual(decodeFileAccessProfileReferences({
    agent_sessions: 2,
    active_file_sessions: 1,
    is_default: true,
    peer_profiles: 3,
    lifecycle_owner: { kind: 'ssh_profile', id: 'ssh_1' },
    blocking_total: 4,
  }), {
    agent_sessions: 2,
    active_file_sessions: 1,
    is_default: true,
    peer_profiles: 3,
    lifecycle_owner: { kind: 'ssh_profile', id: 'ssh_1' },
    blocking_total: 4,
  })
})

test('秘密引用和槽位随响应保留且不共享可变对象', () => {
  const refs = { token: 'credential_1' }
  const slots = [{ name: 'token', required: true, type: 'secret', purpose: 'file_access_auth' }]
  const profile = decodeFileAccessProfile({
    ...base, engine: 'fixture', config: {}, secret_refs: refs,
  })
  const [descriptor] = decodeFileAccessEngineDescriptors([{
    id: 'fixture', config_versions: [1], current_config_version: 1,
    host_scope: 'forbidden', capabilities: ['browse'], secret_slots: slots,
  }])

  refs.token = 'credential_2'
  slots[0].name = 'changed'
  assert.deepEqual(profile.secret_refs, { token: 'credential_1' })
  assert.deepEqual(descriptor?.secret_slots, [{
    name: 'token', required: true, type: 'secret', purpose: 'file_access_auth',
  }])
  assert.deepEqual(decodeFileAccessProfile({
    ...base, config: { ssh_profile_id: 'ssh_1' }, secret_refs: {},
  }).secret_refs, {})
})

test('拒绝畸形秘密引用和引擎秘密槽位', () => {
  for (const refs of [[], { token: '' }, { token: ' credential_1' }, { token: 1 }, { 'bad-slot': 'credential_1' }]) {
    assert.throws(() => decodeFileAccessProfile({
      ...base, engine: 'fixture', config: {}, secret_refs: refs,
    }), /秘密引用无效/)
  }
  const slot = { name: 'token', required: true, type: 'secret', purpose: 'file_access_auth' }
  for (const slots of [{}, [slot, slot], [{ ...slot, name: 'bad-slot' }],
    [{ ...slot, required: 'true' }], [{ ...slot, type: 'password' }], [{ ...slot, purpose: 'ssh_auth' }]]) {
    assert.throws(() => decodeFileAccessEngineDescriptors([{
      id: 'fixture', config_versions: [1], current_config_version: 1,
      host_scope: 'forbidden', capabilities: ['browse'], secret_slots: slots,
    }]), /秘密槽位无效/)
  }
})

test('拒绝非法 Engine 版本合同和非 JSON 配置', () => {
  const descriptor = {
    id: 'sftp', config_versions: [1], current_config_version: 1,
    host_scope: 'required', capabilities: ['list'],
  }
  assert.throws(() => decodeFileAccessEngineDescriptors([{ ...descriptor, config_versions: [2, 1] }]), /支持版本无效/)
  assert.throws(() => decodeFileAccessEngineDescriptors([{ ...descriptor, config_versions: [1, 1] }]), /支持版本无效/)
  assert.throws(() => decodeFileAccessEngineDescriptors([{ ...descriptor, current_config_version: 2 }]), /当前版本无效/)
  assert.throws(() => decodeFileAccessProfile({
    ...base,
    engine_config_version: 0,
    config: { ssh_profile_id: 'ssh_1' },
  }), /配置版本无效/)
  assert.throws(() => decodeFileAccessProfile({
    ...base,
    engine: 'object-store',
    config: { invalid: Number.NaN },
  }), /不是有效 JSON/)
})
