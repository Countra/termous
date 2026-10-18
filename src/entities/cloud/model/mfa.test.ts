import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeCloudLogin, decodeCloudMFACodes, decodeCloudMFASetup, decodeCloudMFAStatus, decodeCloudReauthentication, isCloudMFAUncertainError } from './mfa.ts'

const status = { enabled: true, revision: '2', backup_codes_remaining: 10, verified_until: '2026-09-30T08:00:00Z' }
const setup = { setup_id: 'fixture', expires_at: '2026-09-30T08:00:00Z', secret: 'ABCDEFGHIJKLMNOPQRSTUVWX234567AB', otpauth_uri: 'otpauth://totp/Termous:fixture?secret=ABCDEFGHIJKLMNOPQRSTUVWX234567AB&issuer=Termous', revision: '1' }

test('二步验证解码拒绝非法版本、计数、日期和未知认证方式', () => {
  assert.deepEqual(decodeCloudMFAStatus(status), { ...status, enabled_at: undefined })
  for (const patch of [{ revision: '01' }, { revision: '-1' }, { revision: '9223372036854775808' }, { backup_codes_remaining: 11 }, { enabled: 'true' }, { verified_until: 'bad-date' }]) assert.throws(() => decodeCloudMFAStatus({ ...status, ...patch }))
  assert.throws(() => decodeCloudLogin({ state: 'mfa_required', challenge: { id: 'fixture', expires_at: setup.expires_at, methods: ['email'] } }))
  assert.throws(() => decodeCloudLogin({ state: 'mfa_required', challenge: { id: 'fixture', expires_at: setup.expires_at, methods: ['totp', 'totp'] } }))
  assert.throws(() => decodeCloudReauthentication({ verified_until: 'invalid' }))
  assert.throws(() => decodeCloudMFAStatus({ ...status, enabled: false }))
})

test('绑定二维码仅接受匹配种子的验证器协议，备用码必须完整且唯一', () => {
  assert.deepEqual(decodeCloudMFASetup(setup), setup)
  assert.throws(() => decodeCloudMFASetup({ ...setup, otpauth_uri: 'https://example.test/qr' }))
  assert.throws(() => decodeCloudMFASetup({ ...setup, otpauth_uri: 'otpauth://totp/fixture?secret=OTHER' }))
  assert.throws(() => decodeCloudMFASetup({ ...setup, otpauth_uri: `${setup.otpauth_uri}&period=60` }))
  assert.throws(() => decodeCloudMFASetup({ ...setup, otpauth_uri: setup.otpauth_uri.replace('://totp/', '://user@totp/') }))
  assert.throws(() => decodeCloudMFASetup({ ...setup, otpauth_uri: `${setup.otpauth_uri}#fragment` }))
  assert.throws(() => decodeCloudMFACodes({ status, backup_codes: ['one'] }))
  assert.throws(() => decodeCloudMFACodes({ status, backup_codes: Array(10).fill('same') }))
  const codes = Array.from({ length: 10 }, (_, index) => String.fromCharCode(65 + index).repeat(26))
  assert.deepEqual(decodeCloudMFACodes({ status, backup_codes: codes }), { status: { ...status, enabled_at: undefined }, backup_codes: codes })
  assert.throws(() => decodeCloudMFACodes({ status: { ...status, backup_codes_remaining: 9 }, backup_codes: codes }))
})

test('提交后的网络或合同失败属于结果不明，明确拒绝的验证码错误允许重新输入', () => {
  for (const code of ['network_unavailable', 'response_incomplete', 'CLOUD_RESPONSE_INVALID', 'protocol_invalid', 'response_too_large']) assert.equal(isCloudMFAUncertainError(new Error(code)), true, code)
  for (const code of ['mfa_invalid_code', 'mfa_code_reused', 'mfa_revision_conflict']) assert.equal(isCloudMFAUncertainError(new Error(code)), false, code)
})
