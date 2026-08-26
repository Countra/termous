import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
} from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { RemoteDesktopLauncher } from './RemoteDesktopLauncher'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

test('没有 Profile 时展示引导并进入创建态', async () => {
  const user = userEvent.setup()
  renderLauncher({ profiles: [] })

  expect(screen.getByRole('dialog', { name: /^remoteDesktop\.launcherTitle/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'remoteDesktop.emptyProfilesTitle' })).toBeInTheDocument()
  expect(screen.getByText('remoteDesktop.emptyProfilesDescription')).toBeInTheDocument()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'remoteDesktop.newProfile' }))

  expect(document.querySelector('[data-profile-view="create"]')).not.toBeNull()
  expect(screen.getByRole('heading', { name: 'remoteDesktop.newProfile' })).toBeInTheDocument()
  await waitFor(() => expect(document.querySelector('#remote-desktop-profile-name')).toHaveFocus())
})

test('没有可用 Host 时保留引导但禁止进入创建态', () => {
  renderLauncher({ profiles: [], hosts: [] })

  expect(screen.getByText('remoteDesktop.emptyProfilesNoHostsDescription')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'remoteDesktop.newProfile' })).toBeDisabled()
  expect(document.querySelector('[data-profile-view="create"]')).toBeNull()
})

test('已有 Profile 但关联 Host 不可用时禁止新建和双击连接', async () => {
  const user = userEvent.setup()
  const onConnect = vi.fn(async () => undefined)
  renderLauncher({ hosts: [], onConnect })

  expect(screen.getByRole('button', { name: 'remoteDesktop.newProfile' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()

  await user.dblClick(screen.getByRole('option', { name: /Profile A/ }))

  expect(onConnect).not.toHaveBeenCalled()
})

test('创建态默认选择首个 Host 并提交规范化输入', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn(async (input: RemoteDesktopAccessProfileInput) => profileFromInput('rdp_created', input))
  renderLauncher({
    profiles: [],
    hosts: [host('hst_first', 'First host'), host('hst_second', 'Second host')],
    onCreate,
  })

  await user.click(screen.getByRole('button', { name: 'remoteDesktop.newProfile' }))
  const nameInput = document.querySelector<HTMLInputElement>('#remote-desktop-profile-name')
  expect(nameInput).not.toBeNull()
  await user.type(nameInput!, '  Production desktop  ')
  await user.click(screen.getByRole('button', { name: 'app.save' }))

  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
  expect(onCreate).toHaveBeenCalledWith({
    host_id: 'hst_first',
    name: 'Production desktop',
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh_hst_first',
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
  })
})

test('已有 Profile 在概览和编辑态之间切换', async () => {
  const user = userEvent.setup()
  renderLauncher()

  expect(document.querySelector('[data-profile-view="overview"]')).not.toBeNull()
  expect(screen.getByRole('heading', { name: 'Profile A' })).toBeInTheDocument()
  expect(document.querySelector('#remote-desktop-profile-name')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'app.edit' }))

  expect(document.querySelector('[data-profile-view="edit"]')).not.toBeNull()
  expect(document.querySelector('#remote-desktop-profile-name')).toHaveValue('Profile A')

  await user.click(screen.getByRole('button', { name: 'app.cancel' }))

  expect(document.querySelector('[data-profile-view="overview"]')).not.toBeNull()
  expect(document.querySelector('#remote-desktop-profile-name')).toBeNull()
})

test('仅保存 VNC 密码时不重复更新 Profile 元数据', async () => {
  const user = userEvent.setup()
  const onUpdate = vi.fn(async (id: string, input: RemoteDesktopAccessProfileInput) => profileFromInput(id, input))
  const onSaveTargetAuth = vi.fn(async (id: string) => ({
    ...profile(id, 'Profile A'),
    target_auth: { credential_id: 'cred_vnc', updated_at: '2026-08-23T12:00:01Z' },
    updated_at: '2026-08-23T12:00:01Z',
  }))
  renderLauncher({ onUpdate, onSaveTargetAuth })

  await user.click(screen.getByRole('button', { name: 'app.edit' }))
  await user.click(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.add' }))
  await user.type(screen.getByPlaceholderText('remoteDesktop.targetAuth.passwordPlaceholder'), 'secret')
  await user.click(screen.getByRole('button', { name: 'app.save' }))

  await waitFor(() => expect(onSaveTargetAuth).toHaveBeenCalledWith(
    'rdp_a',
    '2026-08-23T12:00:00Z',
    'secret',
  ))
  expect(onUpdate).not.toHaveBeenCalled()
})

test('元数据成功但密码写入失败时保留新基线和密码草稿', async () => {
  const user = userEvent.setup()
  const updated = {
    ...profile('rdp_a', 'Updated desktop'),
    updated_at: '2026-08-23T12:00:01Z',
  }
  const onUpdate = vi.fn(async () => updated)
  const onSaveTargetAuth = vi.fn(async () => { throw new Error('vault unavailable') })
  renderLauncher({ onUpdate, onSaveTargetAuth })

  await user.click(screen.getByRole('button', { name: 'app.edit' }))
  const name = screen.getByDisplayValue('Profile A')
  await user.clear(name)
  await user.type(name, 'Updated desktop')
  await user.click(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.add' }))
  const password = screen.getByPlaceholderText('remoteDesktop.targetAuth.passwordPlaceholder')
  await user.type(password, 'secret')
  await user.click(screen.getByRole('button', { name: 'app.save' }))

  await waitFor(() => expect(onSaveTargetAuth).toHaveBeenCalledWith(
    updated.id,
    updated.updated_at,
    'secret',
  ))
  expect(document.querySelector('[data-profile-view="edit"]')).not.toBeNull()
  expect(screen.getByDisplayValue('Updated desktop')).toBeInTheDocument()
  expect(screen.getByDisplayValue('secret')).toBeInTheDocument()
  expect(await screen.findByText('remoteDesktop.targetAuth.profileSavedCredentialFailed')).toBeInTheDocument()
})

test('新建 Profile 成功但密码写入失败时在父级列表同步前保留编辑态', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn(async (input: RemoteDesktopAccessProfileInput) => (
    profileFromInput('rdp_created', input)
  ))
  const onSaveTargetAuth = vi.fn(async () => { throw new Error('vault unavailable') })
  renderLauncher({ profiles: [], onCreate, onSaveTargetAuth })

  await user.click(screen.getByRole('button', { name: 'remoteDesktop.newProfile' }))
  const nameInput = document.querySelector<HTMLInputElement>('#remote-desktop-profile-name')
  expect(nameInput).not.toBeNull()
  await user.type(nameInput!, 'Created desktop')
  await user.click(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.add' }))
  await user.type(
    screen.getByPlaceholderText('remoteDesktop.targetAuth.passwordPlaceholder'),
    'secret',
  )
  await user.click(screen.getByRole('button', { name: 'app.save' }))

  await waitFor(() => expect(onSaveTargetAuth).toHaveBeenCalledWith(
    'rdp_created',
    '2026-08-23T12:00:00Z',
    'secret',
  ))
  expect(document.querySelector('[data-profile-view="edit"]')).not.toBeNull()
  expect(screen.getByDisplayValue('Created desktop')).toBeInTheDocument()
  expect(screen.getByDisplayValue('secret')).toBeInTheDocument()
})

test('本地新建 Profile 同步后若被外部删除则退出编辑态', async () => {
  const user = userEvent.setup()
  const created = profile('rdp_created', 'Created desktop')
  const onCreate = vi.fn(async () => created)
  const onSaveTargetAuth = vi.fn(async () => { throw new Error('vault unavailable') })
  const options = { profiles: [] as RemoteDesktopAccessProfile[], onCreate, onSaveTargetAuth }
  const view = renderLauncher(options)

  await user.click(screen.getByRole('button', { name: 'remoteDesktop.newProfile' }))
  const nameInput = document.querySelector<HTMLInputElement>('#remote-desktop-profile-name')
  expect(nameInput).not.toBeNull()
  await user.type(nameInput!, created.name)
  await user.click(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.add' }))
  await user.type(
    screen.getByPlaceholderText('remoteDesktop.targetAuth.passwordPlaceholder'),
    'secret',
  )
  await user.click(screen.getByRole('button', { name: 'app.save' }))
  await waitFor(() => expect(onSaveTargetAuth).toHaveBeenCalledTimes(1))

  view.rerender(launcher({ ...options, profiles: [created] }))
  await waitFor(() => expect(document.querySelector('[data-profile-view="edit"]')).not.toBeNull())
  view.rerender(launcher(options))

  await waitFor(() => expect(document.querySelector('[data-profile-view="edit"]')).toBeNull())
})

test('从编辑态切换到新建态后重新聚焦名称输入框', async () => {
  const user = userEvent.setup()
  renderLauncher()

  await user.click(screen.getByRole('button', { name: 'app.edit' }))
  await user.click(screen.getByRole('button', { name: 'remoteDesktop.newProfile' }))

  await waitFor(() => expect(document.querySelector('#remote-desktop-profile-name')).toHaveFocus())
})

test('保存并连接等待期间在概览中持续展示连接加载状态', async () => {
  const user = userEvent.setup()
  let resolveConnect!: () => void
  const onConnect = vi.fn(() => new Promise<void>((resolve) => {
    resolveConnect = resolve
  }))
  const onClose = vi.fn()
  renderLauncher({ onConnect, onClose })

  await user.click(screen.getByRole('button', { name: 'app.edit' }))
  await user.click(screen.getByRole('button', { name: 'remoteDesktop.saveAndConnect' }))

  await waitFor(() => expect(onConnect).toHaveBeenCalledWith('rdp_a'))
  expect(document.querySelector('[data-profile-view="overview"]')).not.toBeNull()
  expect(document.querySelector('[data-profile-view="overview"] .ant-btn-loading')).not.toBeNull()

  resolveConnect()
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

test('无效编辑草稿显示内联错误且不会提交', async () => {
  const user = userEvent.setup()
  const onUpdate = vi.fn(async (id: string, input: RemoteDesktopAccessProfileInput) => profileFromInput(id, input))
  renderLauncher({ hosts: [], onUpdate })

  await user.click(screen.getByRole('button', { name: 'app.edit' }))
  const nameInput = document.querySelector<HTMLInputElement>('#remote-desktop-profile-name')
  const portInput = document.querySelector<HTMLInputElement>('#remote-desktop-vnc-port')
  expect(nameInput).not.toBeNull()
  expect(portInput).not.toBeNull()
  await user.clear(nameInput!)
  await user.clear(portInput!)
  await user.click(screen.getByRole('button', { name: 'app.save' }))

  expect(await screen.findByText('remoteDesktop.validationName')).toHaveAttribute('role', 'alert')
  expect(screen.getAllByText('remoteDesktop.validationHost')).toHaveLength(2)
  for (const error of screen.getAllByText('remoteDesktop.validationHost')) {
    expect(error).toHaveAttribute('role', 'alert')
  }
  expect(screen.getByText('remoteDesktop.validationPort')).toHaveAttribute('role', 'alert')
  expect(onUpdate).not.toHaveBeenCalled()
})

test('过滤列表后编辑的是当前可见 Profile', async () => {
  const user = userEvent.setup()
  const onUpdate = vi.fn(async (id: string, input: RemoteDesktopAccessProfileInput) => profileFromInput(id, input))
  renderLauncher({
    profiles: [profile('rdp_a', 'Profile A'), profile('rdp_b', 'Profile B')],
    onUpdate,
  })

  await user.type(screen.getByRole('textbox', { name: 'remoteDesktop.searchProfiles' }), 'Profile B')
  expect(screen.getByRole('heading', { name: 'Profile B' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'app.edit' }))
  const nameInput = document.querySelector<HTMLInputElement>('#remote-desktop-profile-name')
  expect(nameInput).toHaveValue('Profile B')
  await user.type(nameInput!, ' updated')
  await user.click(screen.getByRole('button', { name: 'app.save' }))

  await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
  expect(onUpdate.mock.calls[0]?.[0]).toBe('rdp_b')
})

test('搜索无匹配配置时可清除条件并恢复列表', async () => {
  const user = userEvent.setup()
  renderLauncher({
    profiles: [profile('rdp_a', 'Profile A'), profile('rdp_b', 'Profile B')],
  })

  const searchInput = screen.getByRole('textbox', { name: 'remoteDesktop.searchProfiles' })
  await user.type(searchInput, 'Missing profile')

  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  expect(screen.getAllByText('remoteDesktop.noProfiles')).toHaveLength(2)

  await user.click(screen.getByRole('button', { name: 'remoteDesktop.clearSearch' }))

  expect(searchInput).toHaveValue('')
  expect(screen.getAllByRole('option')).toHaveLength(2)
  expect(screen.getByRole('heading', { name: 'Profile A' })).toBeInTheDocument()
})

test('编辑中的 Profile 被外部删除后退出编辑态并切换到剩余项', async () => {
  const user = userEvent.setup()
  const firstProfiles = [profile('rdp_a', 'Profile A'), profile('rdp_b', 'Profile B')]
  const view = renderLauncher({ profiles: firstProfiles })

  await user.click(screen.getByRole('button', { name: 'app.edit' }))
  expect(document.querySelector('[data-profile-view="edit"]')).not.toBeNull()

  view.rerender(launcher({ profiles: [firstProfiles[1]!] }))

  await waitFor(() => {
    expect(document.querySelector('[data-profile-view="edit"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Profile B' })).toBeInTheDocument()
  })
})

test('脏草稿下连接其他配置会先切换目标并锁定配置筛选', async () => {
  const user = userEvent.setup()
  let resolveConnect!: () => void
  const onConnect = vi.fn(() => new Promise<void>((resolve) => {
    resolveConnect = resolve
  }))
  const onClose = vi.fn()
  renderLauncher({
    profiles: [profile('rdp_a', 'Profile A'), profile('rdp_b', 'Profile B')],
    onConnect,
    onClose,
  })

  await user.click(await screen.findByRole('button', { name: 'app.edit' }))
  const nameInput = screen.getByDisplayValue('Profile A')
  await user.clear(nameInput)
  await user.type(nameInput, 'Unsaved Profile')

  await user.dblClick(screen.getByRole('option', { name: /Profile B/ }))
  const discardDraft = await screen.findByRole('button', { name: 'remoteDesktop.discardDraft' })
  await user.click(discardDraft)

  await waitFor(() => expect(onConnect).toHaveBeenCalledWith('rdp_b'))
  expect(discardDraft).not.toHaveClass('ant-btn-loading')
  expect(document.querySelector('[data-profile-view="edit"]')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Profile B' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'remoteDesktop.searchProfiles' })).toBeDisabled()
  expect(document.querySelector('[data-profile-view="overview"] .ant-btn-loading')).not.toBeNull()
  expect(onClose).not.toHaveBeenCalled()

  resolveConnect()
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

test('全局操作进行中时禁止关闭 Launcher 和触发配置操作', async () => {
  const onClose = vi.fn()
  renderLauncher({ actionBusy: true, onClose })

  expect(await screen.findByRole('dialog', { name: /^remoteDesktop\.launcherTitle/ })).toBeInTheDocument()
  expect(document.querySelector('.ant-modal-close')).toBeNull()
  expect(screen.getByRole('button', { name: 'app.edit' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()

  fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 })
  const mask = document.querySelector<HTMLElement>('.ant-modal-mask')
  expect(mask).not.toBeNull()
  fireEvent.mouseDown(mask!)
  fireEvent.mouseUp(mask!)
  fireEvent.click(mask!)

  await waitFor(() => expect(onClose).not.toHaveBeenCalled())
})

interface LauncherOptions {
  profiles?: RemoteDesktopAccessProfile[]
  hosts?: Host[]
  sshProfiles?: SSHAccessProfile[]
  actionBusy?: boolean
  onClose?: () => void
  onCreate?: (input: RemoteDesktopAccessProfileInput) => Promise<RemoteDesktopAccessProfile>
  onUpdate?: (
    id: string,
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  onDelete?: (id: string) => Promise<void>
  onSaveTargetAuth?: (
    id: string,
    expectedUpdatedAt: string,
    password: string,
  ) => Promise<RemoteDesktopAccessProfile>
  onDeleteTargetAuth?: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<RemoteDesktopAccessProfile>
  onConnect?: (profileId: string) => Promise<void>
}

function renderLauncher(options: LauncherOptions = {}) {
  return render(launcher(options))
}

function launcher(options: LauncherOptions = {}) {
  const hosts = options.hosts ?? [host()]
  const sshProfiles = options.sshProfiles ?? hosts.map((item) => sshProfile(item.id))
  return (
    <AntdApp>
      <RemoteDesktopLauncher
        open
        profiles={options.profiles ?? [profile('rdp_a', 'Profile A')]}
        hosts={hosts}
        sshProfiles={sshProfiles}
        actionBusy={options.actionBusy ?? false}
        onClose={options.onClose ?? vi.fn()}
        onCreate={options.onCreate ?? vi.fn(async (input) => profileFromInput('rdp_created', input))}
        onUpdate={options.onUpdate ?? vi.fn(async (id, input) => profileFromInput(id, input))}
        onDelete={options.onDelete ?? vi.fn(async () => undefined)}
        onSaveTargetAuth={options.onSaveTargetAuth ?? vi.fn(async (id) => profile(id, 'Profile A'))}
        onDeleteTargetAuth={options.onDeleteTargetAuth ?? vi.fn(async (id) => profile(id, 'Profile A'))}
        onConnect={options.onConnect ?? vi.fn(async () => undefined)}
      />
    </AntdApp>
  )
}

function profile(
  id: string,
  name: string,
  hostId = 'hst_test',
): RemoteDesktopAccessProfile {
  return {
    id,
    host_id: hostId,
    name,
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: `ssh_${hostId}`,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: id === 'rdp_a',
    sort_order: id === 'rdp_a' ? 0 : 1,
    target_auth: null,
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}

function profileFromInput(
  id: string,
  input: RemoteDesktopAccessProfileInput,
): RemoteDesktopAccessProfile {
  return {
    id,
    ...input,
    is_default: true,
    sort_order: 0,
    target_auth: null,
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}

function sshProfile(hostId = 'hst_test'): SSHAccessProfile {
  return {
    id: `ssh_${hostId}`,
    host_id: hostId,
    name: 'SSH',
    address: '127.0.0.1',
    port: 22,
    username: 'tester',
    auth_method: 'password',
    credential_id: 'cred_test',
    fingerprint_policy: 'ask',
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}

function host(id = 'hst_test', name = 'Test host'): Host {
  return {
    id,
    name,
    platform: 'linux',
    group_id: 'grp_test',
    address: '127.0.0.1',
    port: 22,
    username: 'tester',
    auth_method: 'password',
    credential_id: 'cred_test',
    tags: [],
    favorite: false,
    fingerprint_policy: 'ask',
  }
}
