import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSSHAccessProfileDraft,
  normalizeSSHAccessProfileDraft,
  selectDefaultSSHAccessProfile,
  sortSSHAccessProfiles,
  validateSSHAccessProfileDraft,
} from './sshAccessProfile.ts'
import type { SSHAccessProfile } from './types.ts'

test('SSH Profile 草稿按后端边界规范并校验必填字段', () => {
  const draft = {
    ...createSSHAccessProfileDraft(),
    name: '  primary  ',
    address: ' example.internal ',
    username: ' root ',
    credential_id: ' cred_1 ',
    fingerprint_policy: '',
  }
  const normalized = normalizeSSHAccessProfileDraft({
    ...draft,
    internal_state: 'must-not-leak',
  } as typeof draft & { internal_state: string })
  assert.deepEqual(normalized, {
    name: 'primary',
    address: 'example.internal',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'cred_1',
    proxy_id: '',
    jump_ssh_profile_id: '',
    fingerprint: '',
    fingerprint_policy: 'confirm_on_change',
  })
  assert.deepEqual(validateSSHAccessProfileDraft(draft), {})
  assert.deepEqual(validateSSHAccessProfileDraft({
    ...draft,
    name: '测'.repeat(81),
    port: null,
    credential_id: '',
    jump_ssh_profile_id: 'ssh_self',
  }, 'ssh_self'), {
    name: 'too_long',
    port: 'range',
    credential_id: 'required',
    jump_ssh_profile_id: 'self_reference',
  })
})

test('SSH Profile 默认项不在异常数据中猜测并按顺序稳定排列', () => {
  const first = profile('ssh_b', 1, true)
  const second = profile('ssh_a', 0, false)
  assert.deepEqual(sortSSHAccessProfiles([first, second]).map((item) => item.id), ['ssh_a', 'ssh_b'])
  assert.equal(selectDefaultSSHAccessProfile([first, second], 'hst_1')?.id, 'ssh_b')
  assert.equal(selectDefaultSSHAccessProfile([{ ...second, is_default: true }, first], 'hst_1'), undefined)
})

function profile(id: string, sortOrder: number, isDefault: boolean): SSHAccessProfile {
  return {
    id,
    host_id: 'hst_1',
    name: id,
    address: 'example.internal',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'cred_1',
    fingerprint_policy: 'confirm_on_change',
    is_default: isDefault,
    sort_order: sortOrder,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}
