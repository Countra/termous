import { App as AntdApp, ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { FileAccessProfile } from '#entities/file-access-profile'
import { SessionProfileQuickConnect, type SessionProfileQuickConnectProps } from './SessionProfileQuickConnect'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const profile: FileAccessProfile = {
  id: 'store-a', name: 'Artifact store', engine: 's3', engine_config_version: 1,
  config: { endpoint: 'https://storage.example', bucket: 'artifacts' }, is_default: false, sort_order: 0,
  created_at: '', updated_at: '',
}
function renderConnect(overrides: Partial<Extract<SessionProfileQuickConnectProps, { intent: 'files' }>> = {}) {
  const props: SessionProfileQuickConnectProps = {
    intent: 'files', profiles: [profile], hosts: [], sshAccessProfiles: [], triggerLabel: 'new-session',
    onConnect: vi.fn(async () => undefined), onOpenLauncher: vi.fn(), ...overrides,
  }
  return renderMenu(props)
}
function renderMenu(props: SessionProfileQuickConnectProps) {
  return { ...render(<ConfigProvider theme={{ token: { motion: false, zIndexPopupBase: 3000 } }}>
    <AntdApp><SessionProfileQuickConnect {...props} /></AntdApp>
  </ConfigProvider>), props }
}
const dialogName = 'workbench.quickConnect.profiles.files'

async function detailsTooltip(trigger: HTMLElement) {
  let tooltip: HTMLElement | null = null
  await waitFor(() => {
    tooltip = document.getElementById(trigger.getAttribute('aria-describedby') ?? '')
    expect(tooltip).toBeVisible()
  })
  return tooltip!
}

test('加号展开搜索菜单，选中独立文件配置后连接并关闭', async () => {
  const user = userEvent.setup()
  const { props } = renderConnect()
  const trigger = screen.getByRole('button', { name: 'new-session' })
  await user.click(trigger)
  const search = await screen.findByRole('textbox')
  await waitFor(() => expect(search).toHaveFocus())
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(props.onOpenLauncher).not.toHaveBeenCalled()
  await user.type(search, 'S3 storage')
  await user.click(screen.getByRole('button', { name: /Artifact store/ }))
  expect(props.onConnect).toHaveBeenCalledExactlyOnceWith('store-a')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(trigger).toHaveFocus()
})

test('连接完成后保留业务层已转移到工作区的焦点', async () => {
  const user = userEvent.setup()
  const workspace = render(<button type="button">连接工作区</button>)
  const target = workspace.getByRole('button', { name: '连接工作区' })
  renderConnect({ onConnect: async () => { target.focus() } })
  await user.click(screen.getByRole('button', { name: 'new-session' }))
  await user.type(await screen.findByRole('textbox'), 'Artifact{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(target).toHaveFocus()
})

test('搜索回车连接成功后恢复加号焦点', async () => {
  const user = userEvent.setup()
  const { props } = renderConnect()
  const trigger = screen.getByRole('button', { name: 'new-session' })
  await user.click(trigger)
  await user.type(await screen.findByRole('textbox'), 'Artifact{Enter}')
  expect(props.onConnect).toHaveBeenCalledExactlyOnceWith('store-a')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

test('输入法候选状态的 Escape 不关闭菜单，普通 Escape 正常关闭', async () => {
  const user = userEvent.setup()
  renderConnect()
  const trigger = screen.getByRole('button', { name: 'new-session' })
  await user.click(trigger)
  const input = await screen.findByRole('textbox')
  await waitFor(() => expect(input).toHaveFocus())
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
  expect(screen.getByRole('dialog', { name: dialogName })).toBeVisible()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(input, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

test('空列表和无匹配分开显示，连接器保留为显式入口', async () => {
  const user = userEvent.setup()
  const { props } = renderConnect({ profiles: [] })
  await user.click(screen.getByRole('button', { name: 'new-session' }))
  await waitFor(() => expect(screen.getByText('workbench.quickConnect.profiles.empty')).toBeVisible())
  await user.click(screen.getByRole('button', { name: 'workbench.quickConnect.moreConnections' }))
  expect(props.onOpenLauncher).toHaveBeenCalledTimes(1)
  expect(props.onConnect).not.toHaveBeenCalled()
})

test('无匹配时回车不连接，Escape 关闭并恢复加号焦点', async () => {
  const user = userEvent.setup()
  const { props } = renderConnect()
  await user.click(screen.getByRole('button', { name: 'new-session' }))
  await user.type(await screen.findByRole('textbox'), 'unknown{Enter}')
  expect(screen.getByText('workbench.quickConnect.profiles.noResults')).toBeVisible()
  expect(props.onConnect).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'new-session' })).toHaveFocus()
})

test('连接失败保留菜单和查询，并允许重试', async () => {
  const user = userEvent.setup()
  const onConnect = vi.fn().mockRejectedValueOnce(new Error('connection-refused')).mockResolvedValueOnce(undefined)
  renderConnect({ onConnect })
  await user.click(screen.getByRole('button', { name: 'new-session' }))
  await user.type(await screen.findByRole('textbox'), 'Artifact{Enter}')
  expect(await screen.findByText('connection-refused')).toBeVisible()
  expect(screen.getByRole('dialog', { name: dialogName })).toBeVisible()
  expect(screen.getByRole('textbox')).toHaveValue('Artifact')
  await user.click(screen.getByRole('button', { name: /Artifact store/ }))
  expect(onConnect).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('连接进行中阻止重复请求，迟到结果不关闭重新打开的菜单', async () => {
  const user = userEvent.setup()
  let resolve!: () => void
  const request = new Promise<void>((done) => { resolve = done })
  const onConnect = vi.fn(() => request)
  renderConnect({ onConnect })
  const trigger = screen.getByRole('button', { name: 'new-session' })
  await user.click(trigger)
  const input = await screen.findByRole('textbox')
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  expect(onConnect).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: /Artifact store/ })).toBeDisabled()
  await user.keyboard('{Escape}')
  await user.click(trigger)
  await waitFor(() => expect(screen.getByRole('dialog', { name: dialogName })).toBeVisible())
  const reopenedInput = screen.getByRole('textbox')
  await user.type(reopenedInput, 'Artifact')
  await act(async () => { resolve(); await request })
  expect(screen.getByRole('dialog', { name: dialogName })).toBeVisible()
  expect(reopenedInput).toHaveValue('Artifact')
  expect(reopenedInput).toHaveFocus()
  expect(screen.getByRole('button', { name: /Artifact store/ })).toBeEnabled()
})

test('配置路由缺失时展示禁用原因，回车不会绕过限制', async () => {
  const user = userEvent.setup()
  const { props } = renderConnect({
    profiles: [{ ...profile, id: 'missing-route', name: 'SFTP missing', host_id: 'host-a', engine: 'sftp', config: { ssh_profile_id: 'deleted' } }],
    hosts: [{ id: 'host-a', name: 'Server A' }],
  })
  await user.click(screen.getByRole('button', { name: 'new-session' }))
  expect(await screen.findByRole('button', { name: /SFTP missing/ })).toBeDisabled()
  await waitFor(() => expect(screen.getByText('workbench.hostLauncher.profiles.routeMissing')).toBeVisible())
  await user.keyboard('{Enter}')
  expect(props.onConnect).not.toHaveBeenCalled()
})

test('独立文件配置悬停展示完整端点，搜索与关闭会清理详情', async () => {
  const user = userEvent.setup()
  const { props } = renderConnect()
  const trigger = screen.getByRole('button', { name: 'new-session' })
  await user.click(trigger)
  const row = await screen.findByRole('button', { name: /Artifact store/ })
  expect(row).not.toHaveAttribute('title')
  await user.hover(row)
  let tooltip = await detailsTooltip(row)
  expect(within(tooltip).getByText('https://storage.example / artifacts')).toBeVisible()
  expect(within(tooltip).getByText('workbench.quickConnect.details.standalone')).toBeVisible()
  expect(row).toHaveAttribute('aria-describedby', tooltip.id)
  expect(props.onConnect).not.toHaveBeenCalled()

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Artifact' } })
  await waitFor(() => expect(tooltip).not.toBeInTheDocument())
  await user.unhover(row)
  await user.hover(row)
  tooltip = await detailsTooltip(row)
  await user.click(trigger)
  await waitFor(() => expect(tooltip).not.toBeInTheDocument())
})

test('不可用配置保留原生禁用行为，悬停和键盘聚焦均可查看原因', async () => {
  const user = userEvent.setup()
  const { props } = renderConnect({
    profiles: [{ ...profile, name: 'Broken SFTP', host_id: 'host-a', engine: 'sftp', config: { ssh_profile_id: 'deleted' } }],
    hosts: [{ id: 'host-a', name: 'Server A' }],
  })
  await user.click(screen.getByRole('button', { name: 'new-session' }))
  const row = await screen.findByRole('button', { name: /Broken SFTP/ })
  expect(row).toBeDisabled()
  const trigger = row.parentElement!
  await user.hover(trigger)
  let tooltip = await detailsTooltip(trigger)
  expect(within(tooltip).getByText('workbench.hostLauncher.profiles.routeMissing')).toBeVisible()
  expect(within(tooltip).getByText('Server A')).toBeVisible()
  expect(within(tooltip).queryByText('workbench.hostLauncher.profiles.details.direct')).not.toBeInTheDocument()
  await user.unhover(trigger)
  await waitFor(() => expect(tooltip).not.toBeInTheDocument())
  await act(async () => trigger.focus())
  tooltip = await detailsTooltip(trigger)
  expect(tooltip).toBeVisible()
  await user.keyboard('{Enter}')
  expect(props.onConnect).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(tooltip).not.toBeInTheDocument())
})

test('桌面详情区分 SSH 隧道与直连，悬停不触发会话创建', async () => {
  const user = userEvent.setup()
  const base = {
    host_id: 'host-a', description: '', protocol: 'vnc' as const, protocol_config_version: 1 as const,
    route_config_version: 1 as const, target_auth: null, is_default: true, sort_order: 0, created_at: '', updated_at: '',
    vnc: { target_host: '127.0.0.1', port: 5901, shared: true, default_view_only: false, default_display_mode: 'fit' as const },
  }
  const onConnect = vi.fn(async () => undefined)
  renderMenu({ intent: 'remote_desktop', triggerLabel: 'new-desktop', onConnect,
    profiles: [
      { ...base, id: 'routed', name: 'A Routed desktop', route: 'ssh_tunnel', ssh_profile_id: 'ssh-a' },
      { ...base, id: 'direct', name: 'B Direct desktop', route: 'direct' },
    ], hosts: [{ id: 'host-a', name: 'Production' }],
    sshAccessProfiles: [{
      id: 'ssh-a', host_id: 'host-a', name: 'Gateway SSH', address: '192.0.2.10', port: 2202,
      username: 'deploy', auth_method: 'password', credential_id: 'credential', fingerprint_policy: 'confirm_on_change',
      is_default: true, sort_order: 0, created_at: '', updated_at: '',
    }],
  })
  await user.click(screen.getByRole('button', { name: 'new-desktop' }))
  const routed = await screen.findByRole('button', { name: /A Routed desktop/ })
  await user.hover(routed)
  let tooltip = await detailsTooltip(routed)
  expect(within(tooltip).getByText('Gateway SSH')).toBeVisible()
  expect(within(tooltip).getByText('deploy@192.0.2.10:2202')).toBeVisible()
  expect(within(tooltip).getByText('127.0.0.1:5901')).toBeVisible()
  await act(async () => routed.focus())
  const previousTooltip = tooltip
  const direct = screen.getByRole('button', { name: /B Direct desktop/ })
  await user.hover(direct)
  tooltip = await detailsTooltip(direct)
  await waitFor(() => expect(previousTooltip).not.toBeInTheDocument())
  expect(within(tooltip).getByText('workbench.hostLauncher.profiles.details.direct')).toBeVisible()
  expect(within(tooltip).queryByText('Gateway SSH')).not.toBeInTheDocument()
  expect(onConnect).not.toHaveBeenCalled()
})
