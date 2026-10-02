import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudAuthorization, CloudAuthorizationTarget, CloudSecurityOverview, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { AccountApprovalCoordinator } from './AccountApprovalCoordinator'
import { AccountDevices } from './AccountDevices'

beforeAll(async () => { await changeLanguage('zh-CN') })
const status: CloudStatus = {
  revision: 1, generation: 'approval-fixture', configured: true, authenticated: true, phase: 'ready',
  device_id: 'trusted-device', device_status: 'active', confirmed: false, auto_sync: false, pending: 0, conflicts: 0,
}
function request(id: string, overrides: Partial<CloudAuthorization> = {}): CloudAuthorization {
  return {
    id, workspace_id: 'workspace', device_id: `device-${id}`, kind: 'approval', name: `申请设备 ${id}`,
    status: 'pending', revision: '1', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(),
    platform: 'Windows', source_summary: '127.0.0.0/24', target_confirmed: false, keys_verified: false, allowed_actions: ['approve', 'reject'],
    ...overrides,
  }
}
function overview(): CloudSecurityOverview {
  return {
    account: { contract: 'cloud-authorization-v1', managed_recovery: false, mfa_enabled: true, mfa_revision: '1' },
    recovery: { available: false, policy: { workspace_id: 'workspace', revision: '0', status: 'disabled', updated_at: new Date().toISOString() } },
    membership_initialized: true, keys_verified: true,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function gateway(initialRequests: CloudAuthorization[] = [], initialStatus = status) {
  const state = new CloudState()
  state.accept(initialStatus)
  const requests = new Map(initialRequests.map(value => [value.id, value]))
  const api = {
    getStatus: state.snapshot, subscribeStatus: state.subscribe, subscribeChanges: state.subscribeChanges,
    status: vi.fn(async () => state.snapshot()!), security: vi.fn<CloudGateway['security']>(async () => overview()),
    deviceRequests: vi.fn<CloudGateway['deviceRequests']>(async () => [...requests.values()]),
    recoveryOperations: vi.fn<CloudGateway['recoveryOperations']>(async () => []),
    devices: vi.fn<CloudGateway['devices']>(async () => []),
    authorization: vi.fn<CloudGateway['authorization']>(async (_generation, _kind, id) => requests.get(id)!),
    authorizationAction: vi.fn<CloudGateway['authorizationAction']>(async (_generation, _kind, id) => requests.get(id)!),
  }
  const publish = (ids: string[]) => state.acceptEvent({ type: 'account', status: state.snapshot()!, changes: ['authorizations'], operations: ids })
  return { api, state, requests, publish }
}
function props(api: ReturnType<typeof gateway>['api'], overrides: Partial<React.ComponentProps<typeof AccountApprovalCoordinator>> = {}) {
  return { api: api as unknown as CloudGateway, status: api.getStatus()!, blocked: false, onClose: vi.fn(), ...overrides }
}

test('实时提示立即打开新申请，安全上下文慢时仍不等待，且保留当前页面草稿', async () => {
  const fixture = gateway()
  const security = deferred<CloudSecurityOverview>()
  fixture.api.security.mockImplementation(() => security.promise)
  render(<><input aria-label="当前页面草稿" defaultValue="未保存的主机编辑" /><AccountApprovalCoordinator {...props(fixture.api)} /></>)
  await waitFor(() => expect(fixture.api.deviceRequests).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const draft = screen.getByLabelText('当前页面草稿')
  act(() => { fixture.requests.set('first', request('first')); fixture.publish(['first']) })
  expect(await screen.findByRole('dialog', { name: '设备授权申请' })).toBeInTheDocument()
  expect(screen.getByText('申请设备 first')).toBeInTheDocument()
  expect(screen.getByLabelText('当前页面草稿')).toBe(draft)
  expect(draft).toHaveValue('未保存的主机编辑')
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
  await act(async () => { security.resolve(overview()) })
})

test('设备页列表与常驻审批同步更新，手动详情共用唯一弹窗', async () => {
  const fixture = gateway()
  function View() {
    const [target, setTarget] = useState<CloudAuthorizationTarget>()
    const api = fixture.api as unknown as CloudGateway
    return <>
      <AccountDevices api={api} status={status} busy={false} run={async action => action()} onOpenAuthorization={setTarget} />
      <AccountApprovalCoordinator {...props(fixture.api)} target={target} onClose={() => setTarget(undefined)} />
    </>
  }
  render(<View />)
  await screen.findByText('暂无待处理申请')
  act(() => { fixture.requests.set('first', request('first')); fixture.publish(['first']) })
  const list = within(screen.getByRole('region', { name: '设备授权申请' }))
  await list.findByText('申请设备 first')
  expect(await screen.findByRole('dialog', { name: '设备授权申请' })).toBeInTheDocument()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(list.getByRole('button', { name: '查看详情' }))
  expect(await screen.findByRole('dialog', { name: '设备授权申请' })).toBeInTheDocument()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})

test('关闭申请后重复提示和重连不再弹出，后续新申请仍自动出现', async () => {
  const fixture = gateway([request('first')])
  const input = props(fixture.api)
  render(<AccountApprovalCoordinator {...input} />)
  await screen.findByText('申请设备 first')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(input.onClose).toHaveBeenCalledTimes(1)
  await act(async () => {
    fixture.publish(['first'])
    fixture.state.acceptEvent({ type: 'resync', status: fixture.state.snapshot()! })
  })
  await waitFor(() => expect(fixture.api.deviceRequests.mock.calls.length).toBeGreaterThan(1))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  act(() => { fixture.requests.set('second', request('second')); fixture.publish(['second']) })
  await screen.findByText('申请设备 second')
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})

test('审批中的新申请排队展示，不覆盖身份验证草稿', async () => {
  const fixture = gateway([request('first')])
  render(<AccountApprovalCoordinator {...props(fixture.api)} />)
  await screen.findByText('申请设备 first')
  const code = await screen.findByLabelText('验证器验证码')
  fireEvent.change(code, { target: { value: '123456' } })
  await act(async () => { fixture.requests.set('second', request('second')); fixture.publish(['second']) })
  expect(screen.getByText('申请设备 first')).toBeInTheDocument()
  expect(screen.queryByText('申请设备 second')).not.toBeInTheDocument()
  expect(screen.getByLabelText('验证器验证码')).toBe(code)
  expect(code).toHaveValue('123456')
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await screen.findByText('申请设备 second')
  await waitFor(() => expect(screen.getByLabelText('验证器验证码')).toHaveValue(''))
})

test('本机申请、过期、终态、其他流程及没有审批权限的申请不自动弹出', async () => {
  const fixture = gateway([
    request('self', { device_id: status.device_id! }),
    request('expired', { expires_at: new Date(Date.now() - 1000).toISOString() }),
    request('rejected', { status: 'rejected' }), request('approved', { status: 'approved' }),
    request('recovery', { kind: 'recovery' }), request('unavailable', { allowed_actions: ['cancel'] }),
  ])
  render(<AccountApprovalCoordinator {...props(fixture.api)} />)
  await act(async () => { await Promise.resolve() })
  expect(fixture.api.deviceRequests).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  act(() => { fixture.requests.set('valid', request('valid')); fixture.publish(['valid']) })
  await screen.findByText('申请设备 valid')
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})

test.each([
  { authenticated: false, device_status: 'active' as const },
  { authenticated: true, device_status: 'pending' as const },
])('非可信登录状态 %o 不自动打开审批', async change => {
  const fixture = gateway([request('first')], { ...status, ...change })
  render(<AccountApprovalCoordinator {...props(fixture.api)} />)
  await act(async () => { await Promise.resolve() })
  expect(fixture.api.deviceRequests).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})

test('主机密钥审批优先时暂缓自动弹窗，释放后立即显示待办', async () => {
  const fixture = gateway([request('first')])
  const input = props(fixture.api, { blocked: true })
  const view = render(<AccountApprovalCoordinator {...input} />)
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerender(<AccountApprovalCoordinator {...input} blocked={false} />)
  await screen.findByText('申请设备 first')
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})

test('已打开的审批暂时让位主机密钥对话框，恢复时保留身份草稿', async () => {
  const value = request('first', {
    fingerprint: '1234 5678 9ABC DEF0 1234 5678 9ABC DEF0', allowed_actions: ['approve'],
  })
  const fixture = gateway([value])
  const input = props(fixture.api, { target: { kind: 'approval', id: value.id } })
  // JSDOM 不执行 CSS 动画，此处使用主题提供的禁用动效能力验证隐藏生命周期。
  const view = render(<AccountApprovalCoordinator {...input} />, { wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider> })
  const code = await screen.findByLabelText('验证器验证码')
  fireEvent.change(code, { target: { value: '123456' } })
  view.rerender(<AccountApprovalCoordinator {...input} blocked />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
  expect(input.onClose).not.toHaveBeenCalled()
  view.rerender(<AccountApprovalCoordinator {...input} blocked={false} />)
  await screen.findByRole('dialog', { name: '设备授权申请' })
  expect(screen.getByLabelText('验证器验证码')).toBe(code)
  expect(code).toHaveValue('123456')
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})

test('未知 MFA 状态阻止验证，重新读取成功后才允许提交本次证明', async () => {
  const value = request('first', {
    fingerprint: '1234 5678 9ABC DEF0 1234 5678 9ABC DEF0', allowed_actions: ['approve'],
  })
  const fixture = gateway([value])
  fixture.api.security.mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountApprovalCoordinator {...props(fixture.api, { target: { kind: 'approval', id: value.id } })} />)
  expect(await screen.findByText('授权状态暂时不可用，请重新读取')).toBeInTheDocument()
  const verify = screen.getByRole('button', { name: '批准设备' })
  expect(verify).toBeDisabled()
  fireEvent.click(verify)
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
  await waitFor(() => expect(verify).toBeEnabled())
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '批准设备' }))
  await waitFor(() => expect(fixture.api.authorizationAction).toHaveBeenCalledWith(status.generation, 'approval', value.id, 'approve', expect.objectContaining({ method: 'totp', code: '123456' })))
  expect(fixture.api.authorizationAction).toHaveBeenCalledTimes(1)
})

test('手动打开申请读取失败可重试，审批繁忙结束后不重复初始化同一详情', async () => {
  const value = request('first')
  const fixture = gateway([value])
  fixture.api.authorization.mockRejectedValueOnce(new Error('network_unavailable'))
  const response = deferred<CloudAuthorization>()
  fixture.api.authorizationAction.mockImplementationOnce(() => response.promise)
  render(<AccountApprovalCoordinator {...props(fixture.api, { target: { kind: 'approval', id: value.id } })} />)
  expect(await screen.findByText('授权状态暂时不可用，请重新读取')).toBeInTheDocument()
  expect(fixture.api.authorization).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
  await screen.findByText('申请设备 first')
  await waitFor(() => expect(fixture.api.authorization).toHaveBeenCalledTimes(3))
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '批准设备' }))
  await waitFor(() => expect(fixture.api.authorizationAction).toHaveBeenCalledTimes(1))
  expect(fixture.api.authorization).toHaveBeenCalledTimes(3)
  const approved = { ...value, status: 'approved' as const, revision: '2', allowed_actions: [], fingerprint: '1234 5678 9ABC DEF0 1234 5678 9ABC DEF0' }
  await act(async () => { fixture.requests.set(value.id, approved); response.resolve(approved) })
  await screen.findByText('已批准，等待领取')
  // 操作完成后的权威补读由详情执行；全局 target 不重新初始化，避免清理用户草稿。
  expect(fixture.api.authorization).toHaveBeenCalledTimes(4)
  expect(fixture.api.authorization.mock.calls[3][3]?.aborted).toBe(false)
})

test('切换账号使旧列表和指定申请读取失效，迟到结果不能弹出旧审批', async () => {
  const fixture = gateway()
  const oldList = deferred<CloudAuthorization[]>(), oldTarget = deferred<CloudAuthorization>()
  fixture.api.deviceRequests.mockImplementationOnce(() => oldList.promise)
  fixture.api.authorization.mockImplementationOnce(() => oldTarget.promise)
  const input = props(fixture.api, { target: { kind: 'approval', id: 'old-request' } })
  const view = render(<AccountApprovalCoordinator {...input} />)
  await waitFor(() => expect(fixture.api.authorization).toHaveBeenCalledTimes(1))
  const nextStatus: CloudStatus = { ...status, generation: 'next-account', device_id: 'next-trusted-device' }
  act(() => { fixture.state.accept(nextStatus) })
  view.rerender(<AccountApprovalCoordinator {...input} status={nextStatus} target={undefined} />)
  await waitFor(() => expect(fixture.api.deviceRequests).toHaveBeenCalledTimes(2))
  await act(async () => { oldList.resolve([request('old-request')]); oldTarget.resolve(request('old-request')) })
  expect(fixture.api.deviceRequests.mock.calls[0][1]?.aborted).toBe(true)
  expect(fixture.api.authorization.mock.calls[0][3]?.aborted).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})

test('同一登录代次完成可信身份登记后立即补读待办，不等待轮询或下一条事件', async () => {
  const fixture = gateway([], { ...status, device_status: 'pending' })
  fixture.api.deviceRequests.mockImplementation(async () => fixture.state.snapshot()?.device_status === 'active' ? [...fixture.requests.values()] : [])
  const input = props(fixture.api)
  const view = render(<AccountApprovalCoordinator {...input} />)
  await waitFor(() => expect(fixture.api.deviceRequests).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const nextStatus: CloudStatus = { ...status, revision: 2, workspace_id: 'workspace' }
  await act(async () => { fixture.requests.set('just-logged-in', request('just-logged-in')); fixture.state.accept(nextStatus) })
  view.rerender(<AccountApprovalCoordinator {...input} status={nextStatus} />)
  expect(await screen.findByText('申请设备 just-logged-in')).toBeInTheDocument()
  expect(fixture.api.deviceRequests).toHaveBeenCalledTimes(2)
  expect(fixture.api.authorizationAction).not.toHaveBeenCalled()
})
