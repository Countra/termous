import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App, ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import type { MountWorkspaceProps } from '../model/types'
import { MountEditor } from './MountEditor'
import { MountWorkspace } from './MountWorkspace'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, data?: { count?: number }) => `${key}${data?.count === undefined ? '' : ` ${data.count}`}`, i18n: { language: 'en-US' } }) }))

function setup(overrides: Partial<MountWorkspaceProps> = {}) {
  const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
  const environment = { platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: ['T:'] }
  const profiles = [{ ...config, id: 'saved', auto_start: true, created_at: '', updated_at: '' }]
  const props: MountWorkspaceProps = {
    profiles, instances: [],
    environment,
    connected: true, error: '', hosts: [], fileProfiles: [], reload: vi.fn().mockResolvedValue({ profiles, environment }), save: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined), action: vi.fn().mockResolvedValue(undefined), ...overrides,
  }
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><MountWorkspace {...props} /></App></ConfigProvider>)
  return { props, config }
}

describe('文件挂载交互', () => {
  it.each(['restarting', 'unmounting'])('资源已释放但仍在 %s 时保留运行项并禁止重新启动或删除配置', (phase) => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({ instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'manual', state: 'failed', phase,
      mounted: false, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }] })
    const saved = within(screen.getByRole('region', { name: 'mounts.saved' }))
    expect(saved.queryByRole('button', { name: 'mounts.start' })).not.toBeInTheDocument()
    expect(saved.getByRole('button', { name: 'app.delete' })).toBeDisabled()
    expect(saved.getByText(`mounts.states.${phase}`).closest('.status-badge')).toHaveClass('status-connecting')
    const runtime = within(screen.getByRole('region', { name: 'mounts.runtime' }))
    expect(runtime.getByText(`mounts.states.${phase}`).closest('.status-badge')).toHaveClass('status-connecting')
    expect(runtime.getByRole('button', { name: 'mounts.restart' })).toBeDisabled()
    expect(runtime.getByRole('button', { name: 'mounts.close' })).toBeDisabled()
    expect(runtime.queryByRole('button', { name: 'mounts.sync' })).not.toBeInTheDocument()
    expect(runtime.queryByRole('button', { name: 'mounts.force' })).not.toBeInTheDocument()
  })
  it.each(['restart', 'stop'] as const)('临时失败项将 %s 交给实例接口，等待受理期间禁止重复点击', async (action) => {
    let complete: () => void = () => {}
    const perform = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { complete = resolve }))
    setup({ action: perform, instances: [{ id: 'failed-temp', name: 'Temporary', description: '', file_profile_id: 'source',
      target_os: 'windows', mount_point: 'T:', volume_name: '', read_only: false, case_sensitive: false,
      attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0, start_origin: 'manual',
      state: 'failed', phase: 'failed', mounted: false, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }] })
    const runtime = within(screen.getByRole('region', { name: 'mounts.runtime' }))
    fireEvent.click(runtime.getByRole('button', { name: action === 'restart' ? 'mounts.restart' : 'mounts.close' }))
    expect(perform).toHaveBeenCalledExactlyOnceWith('failed-temp', action)
    expect(runtime.getByRole('button', { name: 'mounts.restart' })).toBeDisabled()
    expect(runtime.getByRole('button', { name: 'mounts.close' })).toBeDisabled()
    complete()
    await waitFor(() => expect(runtime.getByRole('button', { name: 'mounts.close' })).toBeEnabled())
  })
  it('打开编辑器前刷新可用盘符，刷新失败时不打开', async () => {
    let complete: (value: Awaited<ReturnType<MountWorkspaceProps['reload']>>) => void = () => {}
    const reload = vi.fn().mockImplementation(() => new Promise<Awaited<ReturnType<MountWorkspaceProps['reload']>>>((resolve) => { complete = resolve }))
    setup({ reload })
    fireEvent.click(screen.getByRole('button', { name: 'mounts.create' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    complete(undefined)
    await waitFor(() => expect(screen.getByRole('button', { name: 'mounts.create' })).toBeEnabled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('环境刷新成功后打开编辑器', async () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.create' }))
    await screen.findByRole('dialog')
    expect(props.reload).toHaveBeenCalledOnce()
  })
  it('编辑时使用刷新后的配置和空闲盘符', async () => {
    const config = { name: 'Updated Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'G:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    const latest = { ...config, id: 'saved', auto_start: false, created_at: '', updated_at: '2026-09-24T12:00:00Z' }
    const environment = { platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: ['H:'] }
    const { props } = setup({ reload: vi.fn().mockResolvedValue({ profiles: [latest], environment }) })
    fireEvent.click(screen.getByRole('button', { name: 'mounts.edit' }))
    expect(await screen.findByRole('textbox', { name: 'mounts.name' })).toHaveValue('Updated Archive')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'mounts.drive' }))
    await screen.findByRole('option', { name: 'H:' })
    expect(screen.queryByRole('option', { name: 'T:' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(props.save).toHaveBeenCalledWith('saved', expect.objectContaining({ expected_updated_at: latest.updated_at, mount_point: 'G:' })))
  })
  it('配置刷新后已不存在时不打开编辑器', async () => {
    const { props } = setup({ reload: vi.fn().mockResolvedValue({ profiles: [], environment: { platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: ['H:'] } }) })
    fireEvent.click(screen.getByRole('button', { name: 'mounts.edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'mounts.create' })).toBeEnabled())
    expect(props.reload).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('环境不满足时禁用挂载并保留配置入口', () => {
    setup({ environment: { platform: 'windows', architecture: 'amd64', available: false, build_supported: false, dependency: 'WinFsp', message: 'missing SDK', free_drives: [], help_url: 'https://winfsp.dev/rel/' } })
    expect(screen.getByRole('button', { name: 'mounts.start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'mounts.create' })).toBeEnabled()
    expect(screen.getByText('mounts.environmentStates.unavailable')).toBeInTheDocument()
    expect(screen.getByText('missing SDK', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('mounts.environmentReasons.build_unsupported')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it.each([
    ['dependency_missing', '未检测到 WinFsp 安装记录', 'mounts.download'],
    ['dependency_incompatible', '已安装 WinFsp 2.0.23000.0，要求 2.1 或更高版本', 'mounts.upgradeDependency'],
    ['dependency_error', '无法读取 WinFsp 安装信息：拒绝访问', 'mounts.dependencyHelp'],
  ] as const)('显示 %s 的具体原因及对应帮助', (reason, message, label) => {
    setup({ environment: { platform: 'windows', architecture: 'amd64', available: false, build_supported: true, dependency: 'WinFsp 2.1+', message, reason, free_drives: [], help_url: 'https://winfsp.dev/rel/' } })
    expect(screen.getByText(`mounts.environmentReasons.${reason}`)).toBeInTheDocument()
    expect(screen.getByText(message, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', 'https://winfsp.dev/rel/')
    expect(screen.getByRole('button', { name: 'mounts.start' })).toBeDisabled()
  })
  it('驱动已安装但 Core 未启用挂载时不提示下载驱动', () => {
    setup({ environment: { platform: 'windows', architecture: 'amd64', available: false, build_supported: false, reason: 'build_unsupported', dependency: 'WinFsp 2.1+', dependency_version: '2.1.25156.0', message: '当前 Core 未启用原生挂载支持。已检测到 WinFsp 2.1.25156.0，版本符合要求', free_drives: [], help_url: 'https://winfsp.dev/rel/' } })
    expect(screen.getByText(/WinFsp 2.1.25156.0/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'mounts.runtime' })).getByText('mounts.noRuntime')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('启动受理不会自行显示为已挂载', async () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.start' }))
    await waitFor(() => expect(props.start).toHaveBeenCalledWith({ profile_id: 'saved' }))
    expect(within(screen.getByRole('region', { name: 'mounts.runtime' })).getByText('mounts.noRuntime')).toBeInTheDocument()
    expect(screen.queryByText('mounts.states.ready')).not.toBeInTheDocument()
  })
  it.each(['mounts.start', 'mounts.edit', 'app.delete'])('配置操作 %s 悬停时显示提示', async (label) => {
    setup()
    const user = userEvent.setup()
    await user.hover(screen.getByRole('button', { name: label }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(label)
  })
  it('删除提示不影响原有二次确认', async () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'app.delete' }))
    const confirmation = (await screen.findByText('mounts.deleteTitle')).closest('.ant-popconfirm') as HTMLElement
    expect(props.remove).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'app.delete' }))
    await waitFor(() => expect(props.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'saved' })))
  })
  it.each(['mounts.sync', 'mounts.reconnect', 'mounts.stop'])('运行操作 %s 悬停时显示提示', async (label) => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({ instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'manual', state: 'running', phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }] })
    const user = userEvent.setup()
    await user.hover(screen.getByRole('button', { name: label }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(label)
  })
  it('空页面保留左右工作区和创建入口', () => {
    setup({ profiles: [], instances: [] })
    expect(screen.getByRole('button', { name: 'mounts.create' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'mounts.searchPlaceholder' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'mounts.environmentStatus: mounts.environmentStates.ready' })).toBeInTheDocument()
    expect(screen.getByText('mounts.environmentStates.ready')).toBeInTheDocument()
    expect(screen.queryByText('mounts.environmentStatus')).not.toBeInTheDocument()
    const runtime = within(screen.getByRole('region', { name: 'mounts.runtime' }))
    expect(runtime.getByText('mounts.noRuntime')).toBeInTheDocument()
    expect(runtime.queryByRole('button', { name: 'mounts.temporary' })).not.toBeInTheDocument()
  })
  it('配置内容不可选中，右侧始终显示全部运行实例', () => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    const saved = { ...config, id: 'run', profile_id: 'saved', start_origin: 'manual' as const, state: 'running' as const, phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }
    const temporary = { ...config, name: 'Temporary', id: 'temporary', profile_id: undefined, start_origin: 'manual' as const, state: 'running' as const, phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }
    setup({ instances: [saved, temporary] })
    const runtime = within(screen.getByRole('region', { name: 'mounts.runtime' }))
    const profileName = within(screen.getByRole('region', { name: 'mounts.saved' })).getByText('Archive')
    expect(runtime.getByText('Temporary')).toBeInTheDocument()
    expect(profileName.closest('button')).toBeNull()
    fireEvent.click(profileName)
    expect(runtime.getByText('Temporary')).toBeInTheDocument()
    expect(runtime.getByText('mounts.running 2')).toBeInTheDocument()
  })
  it('历史失败记录不会覆盖同一配置仍在运行的实例', () => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    const running = { ...config, id: 'running', profile_id: 'saved', start_origin: 'manual' as const, state: 'running' as const, phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }
    const failed = { ...config, id: 'failed', profile_id: 'saved', start_origin: 'startup' as const, state: 'failed' as const, phase: 'failed', mounted: false, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '', failure: { operation: 'start', message: 'Old failure', at: '2026-09-23T04:05:06Z' } }
    setup({ instances: [running, failed] })
    const saved = within(screen.getByRole('region', { name: 'mounts.saved' }))
    expect(saved.getByText('mounts.states.ready')).toBeInTheDocument()
    expect(saved.queryByRole('button', { name: 'mounts.start' })).not.toBeInTheDocument()
  })
  it('配置筛选只影响保存列表，不隐藏运行实例及其操作', async () => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    const instance = { ...config, id: 'run', profile_id: 'saved', start_origin: 'manual' as const, state: 'running' as const, phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }
    const { props } = setup({ instances: [instance] })
    fireEvent.click(screen.getByRole('tab', { name: 'mounts.filterIssues' }))
    expect(within(screen.getByRole('region', { name: 'mounts.saved' })).getByText('mounts.noIssues')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'mounts.runtime' })).getByText('Archive')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.sync' }))
    await waitFor(() => expect(props.action).toHaveBeenCalledWith('run', 'sync'))
  })
  it('配置被搜索隐藏后，保留缓存的自启失败实例仍能查看错误', async () => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({ instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'startup', state: 'failed', phase: 'detached', mounted: false, retained: true, dirty_nodes: 2, open_handles: 0, started_at: '', failure: { operation: 'start', message: 'Driver failed', at: '2026-09-23T04:05:06Z' } }] })
    fireEvent.change(screen.getByRole('textbox', { name: 'mounts.searchPlaceholder' }), { target: { value: 'missing' } })
    expect(within(screen.getByRole('region', { name: 'mounts.saved' })).getByText('mounts.noResults')).toBeInTheDocument()
    const runtime = within(screen.getByRole('region', { name: 'mounts.runtime' }))
    fireEvent.click(runtime.getByRole('button', { name: 'mounts.failure' }))
    expect(await screen.findByText('Driver failed')).toBeInTheDocument()
  })
  it.each([
    [0, 'mounts.detachedCleanHint', 'mounts.forceCleanTitle', 'mounts.forceCleanHint 0'],
    [2, 'mounts.detachedHint', 'mounts.forceTitle', 'mounts.forceHint 2'],
  ])('保留缓存且未同步 %s 项时显示准确的状态和卸载确认', async (dirtyNodes, hint, title, description) => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({ instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'manual', state: 'failed', phase: 'detached', mounted: false, retained: true, dirty_nodes: dirtyNodes, open_handles: 0, started_at: '' }] })
    const saved = within(screen.getByRole('region', { name: 'mounts.saved' }))
    const runtime = within(screen.getByRole('region', { name: 'mounts.runtime' }))
    expect(saved.getByText('mounts.states.detached').closest('.status-badge')).toHaveClass('status-failed')
    expect(runtime.getByText('mounts.states.detached').closest('.status-badge')).toHaveClass('status-failed')
    expect(runtime.getByText(hint)).toBeInTheDocument()
    fireEvent.click(runtime.getByRole('button', { name: 'mounts.force' }))
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByText(description)).toBeInTheDocument()
  })
  it.each([
    ['checking', false],
    ['cancelling', true],
  ])('启动阶段 %s 的取消按钮禁用状态为 %s', (phase, disabled) => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({ instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'manual', state: 'starting', phase, mounted: false, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }] })
    const cancel = within(screen.getByRole('region', { name: 'mounts.runtime' })).getByRole('button', { name: 'mounts.cancelStart' })
    if (disabled) expect(cancel).toBeDisabled()
    else expect(cancel).toBeEnabled()
  })
  it('搜索可匹配正在运行实例的实际挂载位置，且不改变运行操作', async () => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    const instance = { ...config, id: 'run', profile_id: 'saved', start_origin: 'manual' as const, state: 'running' as const, phase: 'ready', mounted: true, retained: false, dirty_nodes: 2, open_handles: 1, started_at: '' }
    const { props } = setup({ profiles: [{ ...config, mount_point: 'U:', id: 'saved', auto_start: false, created_at: '', updated_at: '' }], instances: [instance] })
    fireEvent.change(screen.getByRole('textbox', { name: 'mounts.searchPlaceholder' }), { target: { value: 'T:' } })
    expect(within(screen.getByRole('region', { name: 'mounts.saved' })).getByText('T:')).toBeInTheDocument()
    expect(screen.getByText('mounts.dirty 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.sync' }))
    await waitFor(() => expect(props.action).toHaveBeenCalledWith('run', 'sync'))
    fireEvent.change(screen.getByRole('textbox', { name: 'mounts.searchPlaceholder' }), { target: { value: 'missing' } })
    expect(screen.getByText('mounts.noResults')).toBeInTheDocument()
  })
  it('临时挂载不计入保存配置的运行数量', () => {
    const config = { name: 'Temporary', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'R:', volume_name: 'Temporary', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({ instances: [{ ...config, id: 'temporary', start_origin: 'manual', state: 'running', phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }] })
    expect(within(screen.getByRole('region', { name: 'mounts.saved' })).queryByText('Temporary')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'mounts.runtime' })).getByText('Temporary')).toBeInTheDocument()
    expect(screen.getByText('mounts.running 1')).toBeInTheDocument()
  })
  it('自启失败附着在标识上，点击显示原因与时间', async () => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({ instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'startup', state: 'failed', phase: 'failed', mounted: false, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '', failure: { operation: 'start', message: 'Port occupied', at: '2026-09-23T04:05:06Z' } }] })
    expect(screen.queryByText('Port occupied')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.autoStartFailed' }))
    await screen.findByText('Port occupied')
    expect(screen.getByText('mounts.failureMessage')).toBeInTheDocument()
    expect(screen.getByText('mounts.failureAt')).toBeInTheDocument()
    expect(document.querySelector('time')?.dateTime).toBe('2026-09-23T04:05:06Z')
  })
  it.each([false, true])('关闭自启开关仍可查看已有失败，保留资源为 %s', async (retained) => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
    setup({
      profiles: [{ ...config, id: 'saved', auto_start: false, created_at: '', updated_at: '' }],
      instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'startup', state: 'failed', phase: 'failed', mounted: false, retained, dirty_nodes: 0, open_handles: 0, started_at: '', failure: { operation: 'start', message: 'Driver failed', at: '2026-09-23T04:05:06Z' } }],
    })
    expect(screen.queryByRole('button', { name: 'mounts.autoStartBadge' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.failure' }))
    await screen.findByText('Driver failed')
    expect(screen.getByText('mounts.failureDetails')).toBeInTheDocument()
  })
})

 it('编辑未展开的高级选项时保留原值', async () => {
   const submit = vi.fn()
   const profile = { id: 'saved', name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Custom volume', read_only: false, case_sensitive: true, attribute_ttl_seconds: 123, directory_ttl_seconds: 20, metadata_concurrency: 12, auto_start: false, created_at: '', updated_at: '2026-09-23T04:05:06Z' }
   render(<ConfigProvider theme={{ token: { motion: false } }}><MountEditor profile={profile} temporary={false} busy={false} environment={{ platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: ['T:'] }} hosts={[]} fileProfiles={[]} onClose={vi.fn()} onSubmit={submit} onError={vi.fn()} /></ConfigProvider>)
   fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
   await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ volume_name: 'Custom volume', case_sensitive: true, attribute_ttl_seconds: 123, directory_ttl_seconds: 20, metadata_concurrency: 12, expected_updated_at: profile.updated_at })))
 })

 it('编辑配置后继续展示当前实例实际使用的位置及访问模式', () => {
   const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0 }
   setup({ profiles: [{ ...config, mount_point: 'U:', read_only: true, id: 'saved', auto_start: false, created_at: '', updated_at: '' }], instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'manual', state: 'running', phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }] })
   const saved = within(screen.getByRole('region', { name: 'mounts.saved' }))
   expect(saved.getByText('T:')).toBeInTheDocument()
   expect(saved.queryByText('U:')).not.toBeInTheDocument()
   expect(saved.getByText('mounts.readWrite')).toBeInTheDocument()
 })
