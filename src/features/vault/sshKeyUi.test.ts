import assert from 'node:assert/strict'
import test from 'node:test'
import type { TFunction } from 'i18next'
import { buildPrivateKeyDraft, type SSHKeyInfo } from '#entities/credential'
import { TermousApiError } from '#shared/api'
import {
  privateKeyNameFromFile,
  sshKeyAlgorithmSummary,
  sshKeyErrorMessage,
} from './model/sshKeyUi.ts'

const translate = ((key: string) => key) as TFunction

test('生成私钥草稿时规范名称并按需创建待保存口令', () => {
  const info: SSHKeyInfo = {
    public_key: 'ssh-rsa AAAA',
    fingerprint_sha256: 'SHA256:test',
    algorithm: 'rsa',
    bits: 4096,
  }

  assert.deepEqual(buildPrivateKeyDraft(
    '  生产密钥  ',
    'PRIVATE KEY',
    info,
    'passphrase',
  ), {
    name: '生产密钥',
    type: 'private_key',
    vault_id: 'local',
    secret: 'PRIVATE KEY',
    metadata: {},
    ssh_key_info: info,
    pending_passphrase: {
      name: '生产密钥',
      secret: 'passphrase',
    },
  })
  assert.equal(buildPrivateKeyDraft('key', 'PRIVATE KEY', info).pending_passphrase, undefined)
})

test('私钥文件名和算法摘要保持现有回退规则', () => {
  assert.equal(privateKeyNameFromFile(' production.pem ', 'fallback'), 'production')
  assert.equal(privateKeyNameFromFile('.key', 'fallback'), 'fallback')
  assert.equal(sshKeyAlgorithmSummary({
    public_key: 'ssh-rsa AAAA',
    fingerprint_sha256: 'SHA256:test',
    algorithm: 'rsa',
    bits: 3072,
  }, translate), 'RSA 3072')
  assert.equal(sshKeyAlgorithmSummary({
    public_key: 'ecdsa-sha2-nistp256 AAAA',
    fingerprint_sha256: 'SHA256:test',
    algorithm: 'ecdsa',
    curve: 'p256',
  }, translate), 'ECDSA P256')
})

test('SSH Key 错误只映射已知稳定错误码', () => {
  assert.equal(
    sshKeyErrorMessage(new TermousApiError('invalid key', 'INVALID_KEY', 400), translate),
    'vault.sshKey.errors.invalid_key',
  )
  assert.equal(
    sshKeyErrorMessage(new Error('unexpected failure'), translate),
    'vault.sshKey.errors.unknown',
  )
})
