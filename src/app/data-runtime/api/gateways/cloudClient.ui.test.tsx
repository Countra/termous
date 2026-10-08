import { afterEach, expect, test, vi } from 'vitest'
import type { CloudStatus } from '#common/contracts'
import { CloudClient } from './cloudClient'

afterEach(() => vi.unstubAllGlobals())

test('本机改名接口携带账号代次和名称版本，不允许指定其他设备', async () => {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json({ id: 'current', user_id: 'owner', name: '我的电脑', name_revision: '1', signing_key: 'key', recipient: 'recipient', status: 'pending', created_at: '2026-10-08T00:00:00Z' }))
  vi.stubGlobal('fetch', fetch)
  const api = new CloudClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const result = await api.updateDeviceName('account', '我的电脑', '0')
  expect(result.name_revision).toBe('1')
  expect(String(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8122/api/v1/cloud/devices/current/name')
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ generation: 'account', name: '我的电脑', expected_revision: '0' }) })
})

function securityResponse(contract: string) {
  return { account: { contract, managed_recovery: false, mfa_enabled: true, mfa_revision: '1' },
    recovery: { policy: { workspace_id: 'workspace_fixture', status: 'disabled', revision: '0', updated_at: '2026-10-02T00:00:00Z' }, available: false },
    membership_initialized: true, keys_verified: true }
}

test.each(['cloud-authorization-v1', 'cloud-recovery-safeguards-v1', 'cloud-direct-approval-v1'])('安全概要经过真实 Gateway 解码支持合同 %s', async contract => {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json(securityResponse(contract)))
  vi.stubGlobal('fetch', fetch)
  const api = new CloudClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const result = await api.security('current')
  expect(result.account.contract).toBe(contract)
  expect(result.account.mfa_enabled).toBe(true)
  expect(result.keys_verified).toBe(true)
  expect(String(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8122/api/v1/cloud/security?generation=current')
})

test('安全概要拒绝未知合同，不将新策略推断为已关闭', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(securityResponse('unknown-security-contract'))))
  const api = new CloudClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  await expect(api.security('current')).rejects.toThrow('CLOUD_RESPONSE_INVALID')
})

test('云状态请求在账号切换后才返回时，调用方同样获得当前账号状态', async () => {
  let respond!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
  const api = new CloudClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const before: CloudStatus = { generation: 'before', revision: 1, binding_id: 'old-account', configured: true, authenticated: true, phase: 'ready', confirmed: true, auto_sync: true, pending: 0, conflicts: 0 }
  api.acceptStatus(before)
  const pending = api.status()
  const current = { ...before, generation: 'after', binding_id: 'new-account', revision: 2 }
  api.acceptStatus(current)
  respond(Response.json(before))
  expect(await pending).toEqual(current)
  expect(api.getStatus()).toEqual(current)
})

test('密码阶段只交付二步验证挑战，不切换账号状态或泄露远端令牌', async () => {
  const challenge = { id: 'local-fixture', expires_at: new Date(Date.now() + 300_000).toISOString(), methods: ['totp', 'backup_code'] }
  const fetch = vi.fn(async () => Response.json({ state: 'mfa_required', challenge }))
  vi.stubGlobal('fetch', fetch)
  const api = new CloudClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const current: CloudStatus = { generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'ready', confirmed: true, auto_sync: true, pending: 0, conflicts: 0 }
  api.acceptStatus(current)
  expect(await api.login('fixture', 'fixture@example.test', 'synthetic-password')).toEqual({ state: 'mfa_required', challenge })
  expect(api.getStatus()).toEqual(current)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('迟到登录挑战不能用于切换后的账号，验证码失败不自动重放', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>((done) => { respond = done }))
  vi.stubGlobal('fetch', fetch)
  const api = new CloudClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const status: CloudStatus = { generation: 'before', revision: 1, configured: true, authenticated: false, phase: 'signed_out', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
  api.acceptStatus(status)
  const pending = api.login('before', 'fixture@example.test', 'synthetic-password')
  api.acceptStatus({ ...status, generation: 'after', revision: 2 })
  respond(Response.json({ state: 'mfa_required', challenge: { id: 'fixture', expires_at: new Date().toISOString(), methods: ['totp'] } }))
  await expect(pending).rejects.toThrow('CLOUD_STALE')
  const verification = api.verifyLogin('after', 'fixture', 'totp', '123456')
  respond(Response.json({ error: { code: 'CLOUD_OPERATION_FAILED', message: 'mfa_invalid_code' } }, { status: 400 }))
  await expect(verification).rejects.toThrow('mfa_invalid_code')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({ generation: 'after', challenge_id: 'fixture', method: 'totp', code: '123456' })
})
