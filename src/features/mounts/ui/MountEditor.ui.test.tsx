import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import type { FileAccessProfile } from '#entities/file-access-profile'
import { MountEditor } from './MountEditor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, data?: { count?: number }) => `${key}${data?.count === undefined ? '' : ` ${data.count}`}` }) }))

const fileSource: FileAccessProfile = {
  id: 'source', name: 'Project / Docs', engine: 'sftp', engine_config_version: 1,
  config: { ssh_profile_id: 'ssh' }, is_default: false, sort_order: 0, created_at: '', updated_at: '',
}

function setup(temporary = false, editing = true, busy = false, fileProfiles: FileAccessProfile[] = [], freeDrives = ['T:']) {
  const submit = vi.fn()
  const profile = { id: 'saved', name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0, auto_start: false, created_at: '', updated_at: '2026-09-24T00:00:00Z' }
  render(<ConfigProvider theme={{ token: { motion: false } }}><MountEditor
    profile={editing ? profile : undefined} temporary={temporary} busy={busy}
    environment={{ platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: freeDrives }}
    hosts={[]} fileProfiles={fileProfiles} onClose={vi.fn()} onSubmit={submit} onError={vi.fn()}
  /></ConfigProvider>)
  fireEvent.click(screen.getByText('mounts.advanced'))
  return submit
}

describe('挂载高级选项', () => {
  it.each([
    [false, 'create', 'mounts.configuration', 'app.create'],
    [true, 'edit', 'Archive', 'app.save'],
  ] as const)('新建和编辑共用标题样式，编辑状态为 %s', (editing, mode, title, action) => {
    setup(false, editing)
    expect(document.querySelector(`[data-editor-mode="${mode}"]`)).toHaveTextContent(title)
    expect(screen.getByRole('button', { name: action })).toBeEnabled()
  })

  it('临时挂载不显示自动启动选项', () => {
    setup(true)
    expect(screen.queryByRole('switch', { name: 'mounts.autoStart' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mounts.start' })).toBeEnabled()
  })

  it('优先选择文件连接，并按连接名称生成符合限制的配置名', async () => {
    setup(false, false, false, [fileSource])
    const source = screen.getByRole('combobox', { name: 'mounts.source' })
    const name = screen.getByRole('textbox', { name: 'mounts.name' })
    expect(source.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.mouseDown(source)
    fireEvent.click(await screen.findByText('Project / Docs · SFTP'))
    expect(name).toHaveValue('Termous - Project Docs')
  })

  it('手动修改配置名后切换文件连接不会覆盖输入', async () => {
    setup(false, false, false, [fileSource, { ...fileSource, id: 'other', name: 'Archive' }])
    const source = screen.getByRole('combobox', { name: 'mounts.source' })
    const name = screen.getByRole('textbox', { name: 'mounts.name' })
    fireEvent.mouseDown(source)
    fireEvent.click(await screen.findByText('Project / Docs · SFTP'))
    fireEvent.change(name, { target: { value: 'My mount' } })
    fireEvent.mouseDown(source)
    fireEvent.click(await screen.findByText('Archive · SFTP'))
    expect(name).toHaveValue('My mount')
  })

  it('盘符菜单只显示环境报告的空闲盘符', async () => {
    setup(false, true, false, [], ['G:', 'H:'])
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'mounts.drive' }))
    await screen.findByRole('option', { name: 'G:' })
    expect(Array.from(document.querySelectorAll('.ant-select-item-option-content'), (item) => item.textContent)).toEqual(['G:', 'H:'])
  })

  it('提交中不允许取消弹窗', () => {
    setup(false, true, true)
    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
  })

  it.each([false, true])('保存目录缓存与并发选项，临时模式为 %s', async (temporary) => {
    const submit = setup(temporary)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'mounts.directoryCache' }), { target: { value: '7' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'mounts.metadataConcurrency' }))
    fireEvent.click(await screen.findByText('mounts.concurrentRequests 2'))
    fireEvent.click(screen.getByRole('button', { name: temporary ? 'mounts.start' : 'app.save' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ directory_ttl_seconds: 7, metadata_concurrency: 2, attribute_ttl_seconds: 5 })))
    expect(screen.getByText('mounts.directoryCacheHint')).toBeInTheDocument()
  })

  it('清空缓存时间时阻止提交并显示范围', async () => {
    const submit = setup()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'mounts.directoryCache' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await screen.findByText('mounts.directoryCacheRange')
    expect(submit).not.toHaveBeenCalled()
  })
  it('卷名称含后端禁止的字符时阻止提交', async () => {
    const submit = setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'mounts.volume' }), { target: { value: 'Project,Docs' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await screen.findByText('mounts.volumeInvalid')
    expect(submit).not.toHaveBeenCalled()
  })
})
