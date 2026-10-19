import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import type { CloudGateway } from '#entities/cloud'
import type { CloudLoginResult, CloudQRLogin, CloudStatus } from '#common/contracts'
import { AccountAuth } from './AccountAuth'

beforeAll(async () => { await changeLanguage('zh-CN') })
const run = async <T,>(action: () => Promise<T>) => action()

test('认证流程分组可达，切换模式保留邮箱并清理密码与验证串', async () => {
  const api = { auth: vi.fn(), login: vi.fn() } as unknown as CloudGateway
  render(<AccountAuth api={api} generation="fixture" busy={false} run={run} />)
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '注册账号' }))
  expect(screen.getByRole('heading', { name: '注册账号' })).toBeInTheDocument()
  expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
  expect(screen.getByLabelText('密码')).toHaveValue('')
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '验证邮箱' }))
  fireEvent.change(screen.getByLabelText('邮件验证串'), { target: { value: 'synthetic-token' } })
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '重发验证邮件' }))
  expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
  fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
  fireEvent.click(screen.getByRole('button', { name: '忘记密码' }))
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '重置密码' }))
  expect(screen.getByLabelText('邮件验证串')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('邮件验证串'), { target: { value: 'reset-token' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: ' synthetic-password ' } })
  fireEvent.click(screen.getByRole('button', { name: '重置密码' }))
  await waitFor(() => expect(api.auth).toHaveBeenCalledWith('password-reset/confirm', expect.objectContaining({ generation: 'fixture', token: 'reset-token', password: ' synthetic-password ' })))
  expect(api.login).not.toHaveBeenCalled()
})

test('重新登录仅验证当前账号，不展示注册与密码重置入口', () => {
  const api = {} as CloudGateway
  render(<AccountAuth api={api} generation="fixture" email="fixture@example.test" reauthenticate busy={false} run={run} />)
  expect(screen.getByLabelText('邮箱')).toHaveAttribute('readonly')
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '返回登录' })).not.toBeInTheDocument()
})

test('未进入二步验证不访问未挂载表单，取消挑战后下次验证不保留验证码', async () => {
  const warnings = vi.spyOn(console, 'error')
  const challenge = { server_time: new Date().toISOString(), id: 'synthetic-challenge', expires_at: new Date(Date.now() + 180_000).toISOString(), methods: ['totp' as const] }
  const login = vi.fn(async (): Promise<CloudLoginResult> => ({ state: 'mfa_required', challenge }))
  const cancelLogin = vi.fn(async () => undefined)
  const api = { login, cancelLogin } as unknown as CloudGateway
  try {
    render(<AccountAuth api={api} generation="fixture" busy={false} run={run} />)
    // 表单连接诊断在下一轮事件循环执行，等待它后检查真实的初始化路径。
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)) })
    expect(warnings.mock.calls.filter(args => String(args[0]).includes('useForm') && String(args[0]).includes('not connected'))).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^登\s*录$/ }))
    fireEvent.change(await screen.findByLabelText('验证器验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
    expect(cancelLogin).toHaveBeenCalledWith('fixture', challenge.id)
    expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
    expect(screen.getByLabelText('密码')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^登\s*录$/ }))
    expect(await screen.findByLabelText('验证器验证码')).toHaveValue('')
    expect(login).toHaveBeenCalledTimes(2)
  } finally { warnings.mockRestore() }
})

test('扫码页保留账号操作入口，转入注册会取消扫码并保留邮箱、清理密码', async () => {
  const item: CloudQRLogin = { id: 'qr-fixture', state: 'pending', revision: '1', pairing_code: '123456', qr_code: 'termous://qr-login?v=1', expires_at: new Date(Date.now() + 180_000).toISOString(), remaining_seconds: 180 }
  const status = { generation: 'fixture', qr_login: item } as CloudStatus
  const qrLogin = vi.fn(async () => item)
  const login = vi.fn()
  const api = { getStatus: () => status, subscribeStatus: () => () => {}, qrLogin, login } as unknown as CloudGateway
  render(<AccountAuth api={api} generation="fixture" busy={false} run={run} />)
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByText('扫码登录'))
  await waitFor(() => expect(qrLogin).toHaveBeenCalledWith(expect.objectContaining({ action: 'create' })))
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '注册账号' }))
  await act(async () => { await Promise.resolve() })
  expect(qrLogin).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'cancel', id: 'qr-fixture', watching: false }))
  expect(screen.getByRole('heading', { name: '注册账号' })).toBeInTheDocument()
  expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(login).not.toHaveBeenCalled()
})
