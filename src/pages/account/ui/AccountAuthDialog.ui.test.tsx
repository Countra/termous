import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { CloudState, type CloudGateway } from '#entities/cloud'
import type { CloudLoginResult, CloudStatus } from '#common/contracts'
import { changeLanguage } from '#shared/i18n'
import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { AccountAuthDialog } from './AccountAuthDialog'

beforeAll(async () => { await changeLanguage('zh-CN') })
const initial: CloudStatus = { revision: 1, generation: 'fixture', configured: true, authenticated: false, phase: 'signed_out', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
function fixture() {
  const state = new CloudState()
  state.accept(initial)
  const login = vi.fn<CloudGateway['login']>()
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, status: vi.fn(async () => state.snapshot()!), login } as unknown as CloudGateway
  return { api, state, login }
}

test('认证放在 Portal 弹层中，关闭不影响工作区草稿，也不主动登录', async () => {
  const { api, login } = fixture()
  const close = vi.fn()
  const view = render(<><input aria-label="工作区草稿" defaultValue="unsaved" /><AccountAuthDialog api={api} onClose={close} /></>)
  expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByRole('heading', { name: '登录账号' })).toBeInTheDocument()
  fireEvent.change(dialog.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(dialog.getByRole('button', { name: '关闭' }))
  expect(close).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('工作区草稿')).toHaveValue('unsaved')
  expect(login).not.toHaveBeenCalled()
})

test('切页从正文顶部展示，输入与普通重绘不打断当前滚动位置', () => {
  const { api } = fixture()
  render(<AccountAuthDialog api={api} onClose={vi.fn()} />)
  const content = document.querySelector<HTMLElement>('[data-tour="account-workspace"]')!
  content.scrollTop = 120
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
  expect(content.scrollTop).toBe(120)
  fireEvent.click(screen.getByRole('button', { name: '注册账号' }))
  expect(content.scrollTop).toBe(0)
  expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
  content.scrollTop = 120
  fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
  expect(content.scrollTop).toBe(0)
})

test('失败只在表单内提示一次，切换流程清除旧错误并保留邮箱', async () => {
  const { api, login } = fixture()
  login.mockRejectedValue(new Error('invalid_credentials'))
  render(<AccountAuthDialog api={api} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: /^登\s*录$/ }))
  expect(await screen.findAllByRole('alert')).toHaveLength(1)
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeInTheDocument()
  expect(document.querySelector('.ant-notification')).toBeNull()
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'another-synthetic-password' } })
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /^登\s*录$/ }))
  await screen.findByRole('alert')
  await waitFor(() => expect(screen.getByRole('button', { name: '注册账号' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '注册账号' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
  expect(screen.getByLabelText('密码')).toHaveValue('')
})

test.each([
  { configured: false, code: 'configuration_invalid', message: '云服务地址配置无效，请检查本机配置文件。' },
  { configured: true, code: 'local_keys_unavailable', message: '无法读取本机密钥，请恢复密钥库访问后重试。' },
  { configured: true, code: 'local_store_unavailable', message: '本机云状态暂不可用，离线功能不受影响。' },
])('状态读取成功仍显示 $code 的本机初始化故障，保留本地入口', async ({ configured, code, message }) => {
  const { api, state } = fixture()
  state.accept({ ...initial, revision: 2, configured, phase: 'unavailable', error_code: code })
  const close = vi.fn()
  render(<AccountAuthDialog api={api} onClose={close} />)
  await waitFor(() => expect(api.status).toHaveBeenCalled())
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.getByRole('alert')).toHaveTextContent(message)
  if (configured) {
    const qrLogin = vi.fn(async () => ({ id: 'synthetic', revision: '1', state: 'pending', remaining_seconds: 60 }))
    Object.assign(api, { qrLogin })
    fireEvent.click(screen.getByText('扫码登录'))
    await waitFor(() => expect(qrLogin).toHaveBeenCalled())
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  }
  fireEvent.click(screen.getByRole('button', { name: '继续使用本地功能' }))
  expect(close).toHaveBeenCalledOnce()
})

test('登录在途禁止关闭与重复提交，二步验证挑战不会关闭弹层', async () => {
  const { api, login } = fixture()
  let finish!: (value: CloudLoginResult) => void
  login.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const close = vi.fn()
  render(<AccountAuthDialog api={api} onClose={close} />)
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: /^登\s*录$/ }))
  await waitFor(() => expect(login).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '继续使用本地功能' })).toBeDisabled()
  fireEvent.submit(document.querySelector('form')!)
  await act(async () => { finish({ state: 'mfa_required', challenge: { id: 'fixture-challenge', server_time: new Date().toISOString(), expires_at: new Date(Date.now() + 180_000).toISOString(), methods: ['totp'] } }) })
  expect(await screen.findByLabelText('验证器验证码')).toBeInTheDocument()
  expect(login).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
})

test('扫码等通道确认登录后才关闭弹层，不触发配置同步', async () => {
  const { api, state, login } = fixture()
  const close = vi.fn()
  render(<AccountAuthDialog api={api} onClose={close} />)
  act(() => { state.accept({ ...initial, generation: 'authenticated', revision: 2, authenticated: true, phase: 'ready' }) })
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(login).not.toHaveBeenCalled()
})

test('账号已登录但工作区仍需处理时也结束认证，不把同步阻塞当成登录失败', async () => {
  const { api, state } = fixture()
  const close = vi.fn()
  const authenticated = vi.fn()
  render(<AccountAuthDialog api={api} onClose={close} onAuthenticated={authenticated} />)
  act(() => { state.accept({ ...initial, generation: 'authenticated', revision: 2, authenticated: true, phase: 'blocked', error_code: 'workspace_replaced' }) })
  await waitFor(() => expect(authenticated).toHaveBeenCalledOnce())
  expect(close).not.toHaveBeenCalled()
})
