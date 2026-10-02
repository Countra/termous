import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, useSyncExternalStore } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CloudStatus, CloudTab } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { SettingsModuleStore, type SettingsGateway } from '#entities/settings'
import { changeLanguage } from '#shared/i18n'
import { useCloudProfile } from '#features/cloud-account'
import { AccountPage as AccountPageView } from './AccountPage'

function AccountPage({ api, settingsGateway, initialTab, onUseOffline = vi.fn() }: { api: CloudGateway; settingsGateway?: SettingsGateway; initialTab?: CloudTab; onUseOffline?: () => void }) {
  const status = useSyncExternalStore(api.subscribeStatus, api.getStatus)
  const profile = useCloudProfile(api, status?.generation ?? '', status?.authenticated ? status.user_id : undefined)
  const [tab, setTab] = useState<CloudTab>(initialTab ?? 'sync')
  const [fallbackSettings] = useState(() => setup().gateway)
  return <AccountPageView api={api} settingsGateway={settingsGateway ?? fallbackSettings} profile={profile} activeTab={tab} onTabChange={setTab} onUseOffline={onUseOffline} />
}

beforeAll(async () => { await changeLanguage('zh-CN') })
const initial: CloudStatus = { revision: 1, generation: 'initial', configured: true, authenticated: false, phase: 'signed_out', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }

function setup(value = initial) {
  const state = new CloudState()
  state.accept(value)
  const api = {
    getStatus: state.snapshot, subscribeStatus: state.subscribe, acceptStatus: state.accept.bind(state),
    status: vi.fn(async () => state.snapshot()!),
    login: vi.fn(async () => { const next = { ...value, generation: 'logged-in', revision: 2, phase: 'ready' as const, error_code: undefined, authenticated: true, device_status: 'active' as const, email: 'fixture@example.test' }; state.accept(next); return { state: 'authenticated' as const, status: next } }),
    logout: vi.fn(async () => initial), devices: vi.fn(async () => []), sessions: vi.fn(async () => []),
    auth: vi.fn(async () => undefined),
    security: vi.fn(async () => ({ account: { contract: 'cloud-authorization-v1', managed_recovery: false, mfa_enabled: false, mfa_revision: '0' }, recovery: { policy: { workspace_id: 'fixture', revision: '0', status: 'disabled', updated_at: '2026-10-01T00:00:00Z' }, available: false }, membership_initialized: false, keys_verified: false })), deviceRequests: vi.fn(async () => []), recoveryOperations: vi.fn(async () => []), createDeviceRequest: vi.fn(), createRecovery: vi.fn(),
    mfaStatus: vi.fn(async () => ({ enabled: false, revision: '0', backup_codes_remaining: 0 })),
    reauthenticate: vi.fn(async () => ({ verified_until: new Date(Date.now() + 300_000).toISOString() })),
    rekeyStatus: vi.fn(async () => ({ status: '', completed: 0, total: 0 })),
    preview: vi.fn(async (generation: string) => ({ id: 'preview', generation, blocked: false, items: [] })),
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
  it('自动同步设置在途时，退出登录不能与设置写入并发执行', async () => {
    const { cloud, gateway, api } = setup({ ...initial, authenticated: true, phase: 'ready', device_status: 'active', confirmed: true })
    const update = gateway.updateModule.bind(gateway)
    let finish!: () => void
    vi.spyOn(gateway, 'updateModule').mockImplementation((...args) => new Promise((resolve, reject) => {
      finish = () => { void update(...args).then(resolve, reject) }
    }))
    render(<AccountPage api={cloud} settingsGateway={gateway} />)
    const toggle = await screen.findByRole('switch', { name: '自动同步' })
    const logout = screen.getByRole('button', { name: '退出登录' })
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)
    await waitFor(() => expect(gateway.updateModule).toHaveBeenCalledTimes(1))
    fireEvent.click(logout)
    expect(api.logout).not.toHaveBeenCalled()
    await act(async () => { finish() })
    await waitFor(() => expect(toggle).toBeChecked())
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(logout)
    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1))
  })

  it('正式页面显式接入设置网关，已确认设备可直接开启自动同步', async () => {
    const { cloud, gateway, api } = setup({ ...initial, authenticated: true, phase: 'ready', device_status: 'active', confirmed: true })
    render(<AccountPage api={cloud} settingsGateway={gateway} />)
    const toggle = await screen.findByRole('switch', { name: '自动同步' })
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(gateway.getModule('cloud')?.value.auto_sync).toBe(true)
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.confirm).not.toHaveBeenCalled()
  })

  it('断网操作失败后恢复连接仍提示未完成，仅在用户重新提交后清除', async () => {
    const logged: CloudStatus = { ...initial, authenticated: true, phase: 'ready', device_status: 'active' }
    const { api, cloud, state } = setup(logged)
    api.reauthenticate.mockImplementationOnce(async () => {
      state.accept({ ...logged, revision: 2, phase: 'blocked', error_code: 'network_unavailable' })
      throw new Error('network_unavailable')
    })
    render(<AccountPage api={cloud} initialTab="security" />)
    fireEvent.change(await screen.findByLabelText('密码'), { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: '验证身份' }))
    expect(await screen.findByText('暂时无法连接云服务')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('密码')).toBeEnabled())
    act(() => { state.accept({ ...logged, revision: 3 }) })
    expect(await screen.findByText('操作未完成，请重试。')).toBeInTheDocument()
    expect(screen.queryByText('正在重连，可继续使用本地功能。')).not.toBeInTheDocument()
    expect(api.reauthenticate).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: /验证身份/ }))
    await waitFor(() => expect(api.reauthenticate).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('操作未完成，请重试。')).not.toBeInTheDocument())
  })

  it('断网保留账号与资料草稿，恢复后清除连接提示且不触发登录或同步', async () => {
    const logged: CloudStatus = { ...initial, authenticated: true, phase: 'ready', device_status: 'active', email: 'fixture@example.test' }
    const { cloud, api, state } = setup(logged)
    const profile = { profile: { user_id: 'fixture', name: 'Original', bio: '', organization: '', avatar: '', revision: '1', updated_at: null }, loading: false, error: undefined, reload: vi.fn(), save: vi.fn() }
    render(<AccountPageView api={cloud} settingsGateway={setup().gateway} profile={profile} activeTab="profile" onTabChange={vi.fn()} onUseOffline={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: 'Unsaved draft' } })
    act(() => { state.accept({ ...logged, revision: 2, phase: 'blocked', error_code: 'network_unavailable' }) })
    expect(await screen.findByText('暂时无法连接云服务')).toBeInTheDocument()
    expect(screen.getByText('正在重连，可继续使用本地功能。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveValue('Unsaved draft')
    act(() => { state.accept({ ...logged, revision: 3 }) })
    await waitFor(() => expect(screen.queryByText('暂时无法连接云服务')).not.toBeInTheDocument())
    expect(screen.getByLabelText('名称')).toHaveValue('Unsaved draft')
    expect(api.login).not.toHaveBeenCalled()
    expect(api.logout).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
  })

  it('续期结果不明时保留账号，由用户主动打开重新验证且无需先退出', async () => {
    const { api, cloud } = setup({ ...initial, authenticated: true, phase: 'blocked', device_status: 'active', email: 'fixture@example.test', error_code: 'refresh_unconfirmed' })
    const profile = { profile: undefined, loading: false, error: undefined, reload: vi.fn(), save: vi.fn() }
    render(<AccountPageView api={cloud} settingsGateway={setup().gateway} profile={profile} activeTab="profile" onTabChange={vi.fn()} onUseOffline={vi.fn()} />)
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新登录' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
    expect(screen.getByLabelText('邮箱')).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^登\s*录$/ }))
    await waitFor(() => expect(api.login).toHaveBeenCalledWith('initial', 'fixture@example.test', 'synthetic-password'))
    expect(api.logout).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('重新验证失败时在弹窗内显示错误，保留账号并允许再次提交', async () => {
    const { api, cloud } = setup({ ...initial, authenticated: true, phase: 'blocked', device_status: 'active', email: 'fixture@example.test', error_code: 'refresh_unconfirmed' })
    api.login.mockRejectedValueOnce(new Error('network_unavailable'))
    const profile = { profile: undefined, loading: false, error: undefined, reload: vi.fn(), save: vi.fn() }
    render(<AccountPageView api={cloud} settingsGateway={setup().gateway} profile={profile} activeTab="profile" onTabChange={vi.fn()} onUseOffline={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '重新登录' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
    fireEvent.click(dialog.getByRole('button', { name: /^登\s*录$/ }))
    expect(await dialog.findByText('暂时无法连接云服务，请稍后重试。')).toBeInTheDocument()
    expect(dialog.getByLabelText('密码')).toHaveValue('synthetic-password')
    expect(dialog.getByRole('button', { name: /^登\s*录$/ })).toBeEnabled()
    expect(api.logout).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: /^登\s*录$/ }))
    await waitFor(() => expect(api.login).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('安全页打开重新登录弹窗时，两个密码字段各有唯一的标签关联', async () => {
    const { cloud } = setup({ ...initial, authenticated: true, phase: 'blocked', device_status: 'active', email: 'fixture@example.test', error_code: 'refresh_unconfirmed' })
    render(<AccountPage api={cloud} initialTab="security" />)
    await screen.findByLabelText('密码')
    fireEvent.click(screen.getByRole('button', { name: '重新登录' }))
    const dialog = within(await screen.findByRole('dialog'))
    const fieldIds = Array.from(document.querySelectorAll('input[type="password"]'), (input) => input.id)
    expect(fieldIds).toHaveLength(2)
    expect(new Set(fieldIds).size).toBe(2)
    expect(dialog.getByLabelText('密码')).toHaveAccessibleName('密码')
  })

  it('侧栏重复定位页签仍生效，页签切换保留未保存的资料草稿', async () => {
    const { cloud } = setup({ ...initial, authenticated: true, phase: 'ready', user_id: 'fixture' })
    const profile = { profile: { user_id: 'fixture', name: 'Original', bio: '', organization: '', avatar: '', revision: '1', updated_at: null }, loading: false, error: undefined, reload: vi.fn(), save: vi.fn() }
    function Harness() {
      const [tab, setTab] = useState<CloudTab>('profile')
      return <>
        <button onClick={() => setTab('profile')}>sidebar-profile</button>
        <button onClick={() => setTab('devices')}>notification-devices</button>
        <AccountPageView api={cloud} settingsGateway={setup().gateway} profile={profile} activeTab={tab} onTabChange={setTab} onUseOffline={vi.fn()} />
      </>
    }
    render(<Harness />)
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: 'Unsaved draft' } })
    fireEvent.click(screen.getByRole('tab', { name: '安全' }))
    expect(screen.getByRole('tab', { name: '安全' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'sidebar-profile' }))
    expect(screen.getByRole('tab', { name: '个人资料' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('名称')).toHaveValue('Unsaved draft')
    fireEvent.click(screen.getByRole('button', { name: 'notification-devices' }))
    expect(screen.getByRole('tab', { name: '设备' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'sidebar-profile' }))
    expect(screen.getByLabelText('名称')).toHaveValue('Unsaved draft')
  })

  it('未配置云服务时仍可直接进入离线版', async () => {
    const { cloud } = setup({ ...initial, configured: false, phase: 'unconfigured' })
    const onUseOffline = vi.fn()
    render(<AccountPage api={cloud} onUseOffline={onUseOffline} />)
    fireEvent.click(screen.getByRole('button', { name: '暂不登录，使用离线版' }))
    expect(onUseOffline).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  })

  it('登录成功仅显示预览入口，不自动上传或开启同步', async () => {
    const { api, cloud, gateway } = setup()
    render(<AccountPage api={cloud} settingsGateway={gateway} />)
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: ' synthetic-password ' } })
    fireEvent.click(screen.getByRole('button', { name: /^登\s*录$/ }))
    await screen.findByText('fixture@example.test')
    expect(api.login).toHaveBeenCalledWith('initial', 'fixture@example.test', ' synthetic-password ')
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.confirm).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled())
    expect(screen.getByRole('switch')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('dialog', { name: '同步预览' })).toBeInTheDocument()
    expect(api.confirm).not.toHaveBeenCalled()
  })

  it('未配置时保留账号空态，通知目标直接选择安全页签', async () => {
    const offline = setup({ ...initial, configured: false, phase: 'unconfigured' })
    const view = render(<AccountPage api={offline.cloud} />)
    await waitFor(() => expect(offline.api.status).toHaveBeenCalled())
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
    view.unmount()
    const logged = setup({ ...initial, authenticated: true, phase: 'ready', device_status: 'active' })
    render(<AccountPage api={logged.cloud} settingsGateway={logged.gateway} initialTab="security" />)
    await waitFor(() => expect(logged.api.sessions).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: '安全' })).toHaveAttribute('aria-selected', 'true')
    expect(logged.api.preview).not.toHaveBeenCalled()
    await act(async () => { logged.state.accept({ ...initial, generation: 'next', revision: 3 }) })
    expect(screen.queryByRole('tab', { name: '安全' })).not.toBeInTheDocument()
  })

  it('待授权设备提供受控申请入口，不再输入或复制长配对材料', async () => {
    const { cloud } = setup({ ...initial, authenticated: true, phase: 'ready', device_status: 'pending' })
    render(<AccountPage api={cloud} initialTab="devices" />)
    expect(await screen.findByRole('button', { name: '使用可信设备批准' })).toBeInTheDocument()
    expect(screen.queryByLabelText('生成配对请求')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(cloud.createDeviceRequest).not.toHaveBeenCalled()
    expect(cloud.createRecovery).not.toHaveBeenCalled()
  })
})
