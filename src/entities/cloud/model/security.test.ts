import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeCloudAuthorization } from './security.ts'

const authorization = { server_time: new Date().toISOString(),
  id: 'request-fixture', workspace_id: 'workspace-fixture', device_id: 'device-fixture', kind: 'approval', remaining_ms: 600_000,
  name: '测试设备', status: 'pending', revision: '1', expires_at: '2026-10-02T08:10:00Z',
  created_at: '2026-10-02T08:00:00Z', source_summary: '127.0.0.0/24', platform: 'Windows',
  target_confirmed: false, keys_verified: false, allowed_actions: ['cancel'],
}
const pairingCode = '1234 ABCD 5678 EF90 1111 2222 3333 4444'
const fingerprint = 'AAAA BBBB CCCC DDDD EEEE FFFF 0000 1111'

test('待处理授权可以展示配对码，批准后保留配对码和独立的历史指纹', () => {
  const pending = decodeCloudAuthorization({ ...authorization, pairing_code: pairingCode })
  assert.equal(pending.status, 'pending')
  assert.equal(pending.pairing_code, pairingCode)
  assert.equal(pending.fingerprint, undefined)

  const approved = decodeCloudAuthorization({ ...authorization, status: 'approved', revision: '2', pairing_code: pairingCode, fingerprint })
  assert.equal(approved.pairing_code, pending.pairing_code)
  assert.equal(approved.fingerprint, fingerprint)
})

test('旧 Core 未返回配对码时保持兼容，不将指纹替换为配对码', () => {
  const result = decodeCloudAuthorization({ ...authorization, fingerprint })
  assert.equal(result.pairing_code, undefined)
  assert.equal(result.fingerprint, fingerprint)
  assert.equal(decodeCloudAuthorization({ ...authorization, fingerprint: '' }).fingerprint, '')
})

test('配对码拒绝非字符串、错误分组和不规范字符，不自动修剪或变换内容', () => {
  for (const value of [null, 1234, [], {}, '', pairingCode.toLowerCase(), pairingCode.replace(' ', '  '),
    pairingCode.replace(' ', '-'), ` ${pairingCode}`, `${pairingCode} `, pairingCode.slice(0, -1),
    `${pairingCode} 5555`, pairingCode.replace('ABCD', 'GBCD'), pairingCode.replace(' ', '\n')]) {
    assert.throws(() => decodeCloudAuthorization({ ...authorization, pairing_code: value }), /CLOUD_RESPONSE_INVALID/)
  }
  assert.throws(() => decodeCloudAuthorization({ ...authorization, pairing_code: pairingCode, fingerprint: 'invalid' }), /CLOUD_RESPONSE_INVALID/)
})

test('授权解码只保留展示合同，不透出申请材料或私钥', () => {
  const result = decodeCloudAuthorization({ ...authorization, pairing_code: pairingCode, request: { nonce: 'synthetic-nonce' }, private_key: 'synthetic-private-key' })
  assert.equal(result.pairing_code, pairingCode)
  assert.equal('request' in result, false)
  assert.equal('private_key' in result, false)
})
