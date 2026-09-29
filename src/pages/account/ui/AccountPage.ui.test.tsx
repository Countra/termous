import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway } from '#entities/settings'
import { changeLanguage } from '#shared/i18n'
import { AccountPage } from './AccountPage'

beforeAll(async () => { await changeLanguage('zh-CN') })
const initial: CloudStatus = { revision: 1, generation: 'initial', configured: true, authenticated: false, phase: 'signed_out', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }

function setup(value = initial) {
  const state = new CloudState()
  state.accept(value)
  const api = {
    getStatus: state.snapshot, subscribeStatus: state.subscribe, acceptStatus: state.accept.bind(state),
    status: vi.fn(async () => state.snapshot()!),
    login: vi.fn(async () => { const next = { ...value, generation: 'logged-in', revision: 2, phase: 'ready' as const, authenticated: true, device_status: 'active' as const, email: 'fixture@example.test' }; state.accept(next); return next }),
    logout: vi.fn(async () => initial), devices: vi.fn(async () => []), sessions: vi.fn(async () => []),
    rekeyStatus: vi.fn(async () => ({ status: '', completed: 0, total: 0 })),
    preview: vi.fn(async () => ({ id: 'preview', generation: value.generation, blocked: false, items: [] })),
    conflicts: vi.fn(async () => []), confirm: vi.fn(async () => ({ ...value, confirmed: true })), run: vi.fn(async () => value),
  }
  const settings = new SettingsModuleStore({
    read: async () => ({ id: 'cloud', revision: 1, schema_version: 1, value: { auto_sync: false }, state: { status: 'applied' } }),
    update: vi.fn(async () => ({ id: 'cloud' as const, revision: 2, schema_version: 1, value: { auto_sync: true }, state: { status: 'applied' as const } })),
  })
  const gateway: SettingsGateway = { getModule: settings.snapshot.bind(settings), readModule: settings.read.bind(settings), updateModule: settings.update.bind(settings), subscribeSettings: settings.subscribe }
  return { api, gateway, cloud: api as unknown as CloudGateway, state }
}

describe('云账号页', () => {
  it('登录成功仅显示预览入口，不自动上传或开启同步', async () => {
    const { api, cloud, gateway } = setup()
    render(<SettingsGatewayContext value={gateway}><AccountPage api={cloud} /></SettingsGatewayContext>)
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: ' synthetic-password ' } })
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }))
    await screen.findByText('fixture@example.test')
    expect(api.login).toHaveBeenCalledWith('initial', 'fixture@example.test', ' synthetic-password ')
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.confirm).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('switch')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: '同步范围与差异' })).toBeInTheDocument()
    expect(api.confirm).not.toHaveBeenCalled()
  })

  it('未配置时保留账号空态，通知目标直接选择安全页签', async () => {
    const offline = setup({ ...initial, configured: false, phase: 'unconfigured' })
    const view = render(<AccountPage api={offline.cloud} />)
    await waitFor(() => expect(offline.api.status).toHaveBeenCalled())
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
    view.unmount()
    const logged = setup({ ...initial, authenticated: true, phase: 'ready', device_status: 'active' })
    render(<SettingsGatewayContext value={logged.gateway}><AccountPage api={logged.cloud} initialTab="security" /></SettingsGatewayContext>)
    await waitFor(() => expect(logged.api.sessions).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: '安全' })).toHaveAttribute('aria-selected', 'true')
    expect(logged.api.preview).not.toHaveBeenCalled()
    await act(async () => { logged.state.accept({ ...initial, generation: 'next', revision: 3 }) })
    expect(screen.queryByRole('tab', { name: '安全' })).not.toBeInTheDocument()
  })

  it.each(['{', JSON.stringify({ signing_key: 'synthetic-key', recipient: 'synthetic-recipient' })])('拒绝不完整的设备配对材料并显示明确错误：%s', async (request) => {
    const { cloud, gateway } = setup({ ...initial, authenticated: true, phase: 'ready', device_status: 'active' })
    render(<SettingsGatewayContext value={gateway}><AccountPage api={cloud} initialTab="devices" /></SettingsGatewayContext>)
    fireEvent.change(await screen.findByLabelText('生成配对请求'), { target: { value: request } })
    fireEvent.click(screen.getByRole('button', { name: '核对设备' }))
    expect(await screen.findByText('配对请求格式不正确，请重新复制。')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '核对设备' })).toBeEnabled()
  })
})
