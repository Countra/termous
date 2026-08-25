import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fileAccessProfileMetadataInputsEqual,
  normalizeFileAccessProfileMetadataInput,
  selectDefaultFileAccessProfile,
  sortFileAccessProfiles,
  validateFileAccessProfileMetadataInput,
} from './fileAccessProfile.ts'
import type { FileAccessProfile } from './types.ts'

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

function profile(id: string, sortOrder: number, isDefault: boolean): FileAccessProfile {
  return {
    id,
    host_id: 'hst_1',
    name: id,
    engine: 'sftp',
    engine_config_version: 1,
    sftp: { ssh_profile_id: id === 'file_b' ? 'ssh_b' : 'ssh_a' },
    is_default: isDefault,
    sort_order: sortOrder,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}
