import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fileAccessProfileMetadataInputsEqual,
  normalizeFileAccessProfileMetadataInput,
  selectCompanionSFTPFileAccessProfile,
  selectDefaultFileAccessProfile,
  sortFileAccessProfiles,
  validateFileAccessProfileMetadataInput,
} from './fileAccessProfile.ts'
import type { FileAccessProfile } from './types.ts'
import { projectFileAccessProfile } from './accessProfileProjection.ts'

test('文件 Profile 只开放独立元数据并校验名称', () => {
  assert.deepEqual(normalizeFileAccessProfileMetadataInput({ name: '  Files  ' }), { name: 'Files' })
  assert.equal(fileAccessProfileMetadataInputsEqual({ name: ' Files ' }, { name: 'Files' }), true)
  assert.deepEqual(validateFileAccessProfileMetadataInput({ name: '' }), { name: 'required' })
  assert.deepEqual(validateFileAccessProfileMetadataInput({ name: '文'.repeat(81) }), { name: 'too_long' })
})

test('文件 Profile 默认项与顺序使用强类型 SFTP 投影', () => {
  const first = profile('file_b', 1, true)
  const second = profile('file_a', 0, false)
  assert.deepEqual(sortFileAccessProfiles([first, second]).map((item) => item.id), ['file_a', 'file_b'])
  assert.equal(selectDefaultFileAccessProfile([first, second], 'hst_1')?.sftp.ssh_profile_id, 'ssh_b')
})

test('伴生 SFTP 仅在主机和 SSH Profile 唯一匹配时返回', () => {
  const primary = profile('file-primary', 0, true, 'ssh-primary')
  const secondary = profile('file-secondary', 1, false, 'ssh-secondary')
  assert.equal(
    selectCompanionSFTPFileAccessProfile(
      [primary, secondary],
      'hst_1',
      'ssh-primary',
    ),
    primary,
  )
  assert.equal(
    selectCompanionSFTPFileAccessProfile(
      [primary, { ...primary, id: 'file-duplicate' }],
      'hst_1',
      'ssh-primary',
    ),
    undefined,
  )
})

test('文件访问公共投影隐藏 SFTP 私有配置', () => {
  const source = profile('file-primary', 0, true, 'ssh-primary')
  const projection = projectFileAccessProfile(source)
  assert.deepEqual(projection, {
    profileId: 'file-primary',
    hostId: 'hst_1',
    name: 'file-primary',
    technology: { id: 'sftp', label: 'SFTP' },
    routeDependency: { kind: 'ssh_profile', profileId: 'ssh-primary' },
    isDefault: true,
    sortOrder: 0,
  })
  assert.equal('sftp' in projection, false)
})

function profile(
  id: string,
  sortOrder: number,
  isDefault: boolean,
  sshProfileId = id === 'file_b' ? 'ssh_b' : 'ssh_a',
): FileAccessProfile {
  return {
    id,
    host_id: 'hst_1',
    name: id,
    engine: 'sftp',
    engine_config_version: 1,
    sftp: { ssh_profile_id: sshProfileId },
    is_default: isDefault,
    sort_order: sortOrder,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}
