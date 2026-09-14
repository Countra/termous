import assert from 'node:assert/strict'
import test from 'node:test'
import type { TFunction } from 'i18next'
import { buildPrivateKeyDraft, type SSHKeyInfo } from '#entities/credential'
import { TermousApiError } from '#shared/api'
import {
  privateKeyNameFromFile,
  readDroppedPrivateKeyFile,
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

test('拖放私钥读取不限制文件扩展名或媒体类型', async () => {
  const content = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----\n'
  const bytes = new TextEncoder().encode(content)
  const file = {
    name: 'production-key.custom-binary',
    type: 'application/octet-stream',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  }
  const result = await readDroppedPrivateKeyFile(file)

  assert.deepEqual(result, {
    fileName: 'production-key.custom-binary',
    privateKey: content,
  })
})

test('拖放私钥读取沿用空文件、大小和读取失败边界', async () => {
  await assert.rejects(
    readDroppedPrivateKeyFile({ name: 'empty', size: 0, arrayBuffer: async () => new ArrayBuffer(0) }),
    /ssh_private_key_empty/,
  )
  await assert.rejects(
    readDroppedPrivateKeyFile({ name: 'large', size: (1 << 20) + 1, arrayBuffer: async () => new ArrayBuffer(0) }),
    /ssh_private_key_too_large/,
  )
  await assert.rejects(
    readDroppedPrivateKeyFile({ name: 'changed', size: 1, arrayBuffer: async () => new ArrayBuffer((1 << 20) + 1) }),
    /ssh_private_key_too_large/,
  )
  await assert.rejects(
    readDroppedPrivateKeyFile({
      name: 'unreadable',
      size: 1,
      arrayBuffer: async () => { throw new Error('disk failure') },
    }),
    /ssh_private_key_read_failed/,
  )
})
