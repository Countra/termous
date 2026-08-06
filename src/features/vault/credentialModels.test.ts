import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type CredentialInput,
  type CredentialView,
  type SSHKeyInfo,
  createBlankCredentialInput,
  credentialInputsEqual,
  credentialToInput,
  normalizeCredentialInput,
} from '#entities/credential'
import { filterCredentials, validateCredentialInput } from './model/credentialCatalog.ts'

const keyInfo: SSHKeyInfo = {
  public_key: 'ssh-ed25519 AAAA',
  fingerprint_sha256: 'SHA256:test',
  algorithm: 'ed25519',
}

test('凭据输入归一化保留私钥信息并确保新口令优先于已绑定口令', () => {
  const input: CredentialInput = {
    name: '  生产密钥  ',
    type: 'private_key',
    vault_id: '  ',
    secret: 'PRIVATE KEY',
    metadata: {
      passphrase_credential_id: ' existing-passphrase ',
      source: 'imported',
    },
    ssh_key_info: keyInfo,
    pending_passphrase: {
      name: '  生产密钥口令  ',
      secret: 'secret',
    },
  }

  const normalized = normalizeCredentialInput(input)

  assert.equal(normalized.name, '生产密钥')
  assert.equal(normalized.vault_id, 'local')
  assert.deepEqual(normalized.metadata, { source: 'imported' })
  assert.deepEqual(normalized.pending_passphrase, {
    name: '生产密钥口令',
    secret: 'secret',
  })
  assert.equal(normalized.ssh_key_info, keyInfo)
  assert.equal(input.metadata.passphrase_credential_id, ' existing-passphrase ')
})

test('非私钥凭据会移除私钥专用字段并按归一化结果比较', () => {
  const left: CredentialInput = {
    ...createBlankCredentialInput('password'),
    name: '  deploy  ',
    vault_id: '',
    secret: 'secret',
    metadata: { passphrase_credential_id: 'passphrase-1' },
    ssh_key_info: keyInfo,
    pending_passphrase: { name: 'unused', secret: 'unused' },
  }
  const right: CredentialInput = {
    ...createBlankCredentialInput('password'),
    name: 'deploy',
    secret: 'secret',
  }

  assert.equal(credentialInputsEqual(left, right), true)
  assert.deepEqual(normalizeCredentialInput(left), {
    ...right,
    ssh_key_info: undefined,
    pending_passphrase: undefined,
  })
})

test('服务端凭据快照转为编辑输入时不会回填秘密内容', () => {
  const credential: CredentialView = {
    id: 'credential-1',
    name: '生产密钥',
    type: 'private_key',
    vault_id: 'local',
    metadata: { passphrase_credential_id: 'passphrase-1' },
    ssh_key_info: keyInfo,
    bound_host_count: 2,
  }

  assert.deepEqual(credentialToInput(credential), {
    name: '生产密钥',
    type: 'private_key',
    vault_id: 'local',
    secret: '',
    metadata: { passphrase_credential_id: 'passphrase-1' },
    ssh_key_info: keyInfo,
    pending_passphrase: undefined,
  })
})

test('凭据校验和筛选保持类型过滤、多词匹配与原始顺序', () => {
  assert.deepEqual(validateCredentialInput(
    createBlankCredentialInput(),
    true,
    { name: 'NAME_REQUIRED', secret: 'SECRET_REQUIRED' },
  ), {
    name: 'NAME_REQUIRED',
    secret: 'SECRET_REQUIRED',
  })

  const credentials: CredentialView[] = [
    {
      id: 'password-1',
      name: 'Production Password',
      type: 'password',
      vault_id: 'local',
      metadata: {},
      bound_host_count: 1,
    },
    {
      id: 'key-1',
      name: 'Production Deploy',
      type: 'private_key',
      vault_id: 'local',
      metadata: {},
      ssh_key_info: keyInfo,
      bound_host_count: 0,
    },
  ]
  const labels = {
    password: '密码',
    private_key: '私钥',
    private_key_passphrase: '私钥口令',
  }

  assert.deepEqual(
    filterCredentials(credentials, ' production ed25519 ', 'all', labels).map(({ id }) => id),
    ['key-1'],
  )
  assert.deepEqual(
    filterCredentials(credentials, '', 'password', labels).map(({ id }) => id),
    ['password-1'],
  )
})
