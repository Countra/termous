import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import type { MountWorkspaceProps } from '../model/types'
import { MountEditor } from './MountEditor'
import { MountWorkspace } from './MountWorkspace'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, data?: { count?: number }) => `${key}${data?.count === undefined ? '' : ` ${data.count}`}`, i18n: { language: 'en-US' } }) }))

function setup(overrides: Partial<MountWorkspaceProps> = {}) {
  const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5 }
  const props: MountWorkspaceProps = {
    profiles: [{ ...config, id: 'saved', auto_start: true, created_at: '', updated_at: '' }], instances: [],
    environment: { platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: ['T:'] },
    connected: true, error: '', hosts: [], fileProfiles: [], reload: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined), action: vi.fn().mockResolvedValue(undefined), ...overrides,
  }
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><MountWorkspace {...props} /></App></ConfigProvider>)
  return { props, config }
}

describe('文件挂载交互', () => {
  it('环境不满足时禁用挂载并保留配置入口', () => {
    setup({ environment: { platform: 'windows', architecture: 'amd64', available: false, build_supported: false, dependency: 'WinFsp', message: 'missing SDK', free_drives: [], help_url: 'https://winfsp.dev/rel/' } })
    expect(screen.getByRole('button', { name: 'mounts.start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'mounts.create' })).toBeEnabled()
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
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('启动受理不会自行显示为已挂载', async () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.start' }))
    await waitFor(() => expect(props.start).toHaveBeenCalledWith({ profile_id: 'saved' }))
    expect(screen.getByText('mounts.running 0')).toBeInTheDocument()
    expect(screen.queryByText('mounts.states.ready')).not.toBeInTheDocument()
  })
  it('自启失败附着在标识上，点击显示原因与时间', async () => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5 }
    setup({ instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'startup', state: 'failed', phase: 'failed', mounted: false, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '', failure: { operation: 'start', message: 'Port occupied', at: '2026-09-23T04:05:06Z' } }] })
    expect(screen.queryByText('Port occupied')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.autoStartBadge' }))
    await screen.findByText('Port occupied')
    expect(document.querySelector('time')?.dateTime).toBe('2026-09-23T04:05:06Z')
  })
  it.each([false, true])('关闭自启开关仍可查看已有失败，保留资源为 %s', async (retained) => {
    const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5 }
    setup({
      profiles: [{ ...config, id: 'saved', auto_start: false, created_at: '', updated_at: '' }],
      instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'startup', state: 'failed', phase: 'failed', mounted: false, retained, dirty_nodes: 0, open_handles: 0, started_at: '', failure: { operation: 'start', message: 'Driver failed', at: '2026-09-23T04:05:06Z' } }],
    })
    expect(screen.queryByRole('button', { name: 'mounts.autoStartBadge' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.failure' }))
    await screen.findByText('Driver failed')
  })
})

 it('编辑未展开的高级选项时保留原值', async () => {
   const submit = vi.fn()
   const profile = { id: 'saved', name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Custom volume', read_only: false, case_sensitive: true, attribute_ttl_seconds: 123, auto_start: false, created_at: '', updated_at: '2026-09-23T04:05:06Z' }
   render(<ConfigProvider theme={{ token: { motion: false } }}><MountEditor profile={profile} temporary={false} busy={false} environment={{ platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: ['T:'] }} hosts={[]} fileProfiles={[]} onClose={vi.fn()} onSubmit={submit} onError={vi.fn()} /></ConfigProvider>)
   fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
   await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ volume_name: 'Custom volume', case_sensitive: true, attribute_ttl_seconds: 123, expected_updated_at: profile.updated_at })))
 })

 it('编辑配置后继续展示当前实例实际使用的位置及访问模式', () => {
   const config = { name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5 }
   setup({ profiles: [{ ...config, mount_point: 'U:', read_only: true, id: 'saved', auto_start: false, created_at: '', updated_at: '' }], instances: [{ ...config, id: 'run', profile_id: 'saved', start_origin: 'manual', state: 'running', phase: 'ready', mounted: true, retained: false, dirty_nodes: 0, open_handles: 0, started_at: '' }] })
   expect(screen.getByText('T: · source')).toBeInTheDocument()
   expect(screen.queryByText('U: · source')).not.toBeInTheDocument()
   expect(screen.getByText('mounts.readWrite')).toBeInTheDocument()
 })
