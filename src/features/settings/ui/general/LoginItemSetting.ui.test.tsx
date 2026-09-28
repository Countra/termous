import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { LoginItemBridge, LoginItemResponse, LoginItemState } from '#common/contracts'
import { LoginItemSetting } from './LoginItemSetting'
import { GeneralSettings } from './GeneralSettings'

const state = vi.hoisted(() => ({ gateway: null as LoginItemBridge | null }))
vi.mock('../../api/loginItemGateway', () => ({ getLoginItemGateway: () => state.gateway }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const initial: LoginItemState = { available: true, enabled: false, unavailable_reason: null, requires_approval: false }

beforeEach(() => {
  state.gateway = {
    get: vi.fn().mockResolvedValue({ ok: true, value: initial }),
    setEnabled: vi.fn(async (enabled: boolean): Promise<LoginItemResponse> => ({ ok: true, value: { ...initial, enabled } })),
  }
})

test('通用设置默认关闭，挂载只读取，用户切换才提交', async () => {
  const user = userEvent.setup()
  render(<GeneralSettings language="zh-CN" appearanceSettings={{ theme: 'dark' }} windowSettings={{ close_behavior: 'exit' }}
    disabled={false} onLanguageChange={vi.fn()} onAppearanceSettingsChange={vi.fn()} onWindowSettingsChange={vi.fn()} />)
  const toggle = screen.getByRole('switch', { name: 'settings.loginItem.title' })
  expect(toggle).not.toBeChecked()
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(screen.getByText('settings.loginItem.hint')).toBeInTheDocument()
  expect(screen.queryByText('settings.loginItem.developmentLabel')).not.toBeInTheDocument()
  expect(screen.queryByText('settings.loginItem.development')).not.toBeInTheDocument()
  expect(state.gateway!.setEnabled).not.toHaveBeenCalled()
  await user.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  expect(state.gateway!.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
  await user.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  expect(state.gateway!.setEnabled).toHaveBeenLastCalledWith(false)
})

test.each(['development', 'unsupported_platform'] as const)('%s 环境显示原因并禁用开关', async (reason) => {
  const user = userEvent.setup()
  state.gateway!.get = vi.fn().mockResolvedValue({ ok: true, value: { ...initial, available: false, unavailable_reason: reason } })
  render(<LoginItemSetting disabled={false} />)
  if (reason === 'development') {
    const label = await screen.findByText('settings.loginItem.developmentLabel')
    expect(screen.getByText('settings.loginItem.hint')).toBeInTheDocument()
    await user.hover(label)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('settings.loginItem.development')
  } else {
    await screen.findByText(`settings.loginItem.${reason}`)
    expect(screen.queryByText('settings.loginItem.developmentLabel')).not.toBeInTheDocument()
  }
  const toggle = screen.getByRole('switch')
  expect(toggle).toBeDisabled()
  expect(toggle).not.toBeChecked()
  await user.click(toggle)
  expect(state.gateway!.setEnabled).not.toHaveBeenCalled()
})

test('缺少桌面桥接或全局操作禁用时不能提交', async () => {
  const user = userEvent.setup()
  const view = render(<LoginItemSetting disabled />)
  await waitFor(() => expect(state.gateway!.get).toHaveBeenCalled())
  await user.click(screen.getByRole('switch'))
  expect(state.gateway!.setEnabled).not.toHaveBeenCalled()
  state.gateway = null
  view.rerender(<LoginItemSetting disabled={false} />)
  expect(screen.getByRole('switch')).toBeDisabled()
  expect(screen.getByText('settings.loginItem.desktop_only')).toBeInTheDocument()
})

test('读取失败禁用开关，重试只读取，不写入启动项', async () => {
  const user = userEvent.setup()
  state.gateway!.get = vi.fn().mockRejectedValueOnce(new Error('模拟 IPC 断开')).mockResolvedValue({ ok: true, value: initial })
  render(<LoginItemSetting disabled={false} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.loginItem.errors.read_failed')
  expect(screen.getByRole('switch')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'app.retry' }))
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(state.gateway!.setEnabled).not.toHaveBeenCalled()
})

test('修改期间禁止重复提交，失败后读取实际状态而不重放修改', async () => {
  let finish!: (result: LoginItemResponse) => void
  state.gateway!.setEnabled = vi.fn(() => new Promise<LoginItemResponse>((resolve) => { finish = resolve }))
  render(<LoginItemSetting disabled={false} />)
  const toggle = screen.getByRole('switch')
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  fireEvent.click(toggle)
  expect(toggle).toBeDisabled()
  expect(toggle).not.toBeChecked()
  expect(state.gateway!.setEnabled).toHaveBeenCalledTimes(1)
  await act(async () => finish({ ok: false, error: 'read_failed' }))
  expect(screen.getByRole('alert')).toHaveTextContent('settings.loginItem.errors.read_failed')
  state.gateway!.get = vi.fn().mockResolvedValue({ ok: true, value: { ...initial, enabled: true } })
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  await waitFor(() => expect(toggle).toBeChecked())
  expect(state.gateway!.setEnabled).toHaveBeenCalledTimes(1)
})

test('严格模式丢弃旧读取结果，离开页面后移除焦点刷新监听', async () => {
  let finish!: (result: LoginItemResponse) => void
  const get = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValue({ ok: true, value: { ...initial, enabled: true } })
  state.gateway!.get = get
  const view = render(<StrictMode><LoginItemSetting disabled={false} /></StrictMode>)
  const toggle = screen.getByRole('switch')
  await waitFor(() => expect(toggle).toBeChecked())
  await act(async () => finish({ ok: true, value: initial }))
  expect(toggle).toBeChecked()
  view.unmount()
  const count = get.mock.calls.length
  fireEvent.focus(window)
  expect(get).toHaveBeenCalledTimes(count)
})

test('系统状态变化后聚焦刷新仅查询，未完成的查询不重复提交', async () => {
  let finish!: (result: LoginItemResponse) => void
  const get = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: { ...initial, enabled: true } })
    .mockImplementationOnce(() => new Promise<LoginItemResponse>((resolve) => { finish = resolve }))
  state.gateway!.get = get
  render(<LoginItemSetting disabled={false} />)
  const toggle = screen.getByRole('switch')
  await waitFor(() => expect(toggle).toBeChecked())
  fireEvent.focus(window)
  fireEvent.focus(window)
  expect(get).toHaveBeenCalledTimes(2)
  expect(toggle).toBeDisabled()
  await act(async () => finish({ ok: true, value: initial }))
  expect(toggle).not.toBeChecked()
  expect(toggle).toBeEnabled()
  expect(state.gateway!.setEnabled).not.toHaveBeenCalled()
})

test('macOS 待批准显示系统确认提示', async () => {
  state.gateway!.get = vi.fn().mockResolvedValue({ ok: true, value: { ...initial, enabled: true, requires_approval: true } })
  render(<LoginItemSetting disabled={false} />)
  expect(await screen.findByRole('status')).toHaveTextContent('settings.loginItem.requiresApproval')
  expect(screen.getByRole('switch')).toBeChecked()
})
