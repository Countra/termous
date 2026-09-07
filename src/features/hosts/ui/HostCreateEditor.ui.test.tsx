import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import type { ComponentProps } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { HostCreateEditor } from './HostCreateEditor.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

function renderEditor() {
  const props: ComponentProps<typeof HostCreateEditor> = {
    data: { hosts: [], hostAssets: [], sshAccessProfiles: [], groups: [], proxies: [],
      credentials: [], hostIcons: [], sessions: [], fileSessions: [], forwards: [], remoteDesktopSessions: [] },
    busy: false, getHostIconUrl: () => '', onBack: vi.fn(), onCreate: vi.fn().mockResolvedValue(undefined),
    onDirtyChange: vi.fn(), onProtectedIconIdChange: vi.fn(), onCreateGroup: vi.fn(),
    onManageIcons: vi.fn(), onManageProxies: vi.fn(),
  }
  render(<ConfigProvider theme={{ token: { motion: false } }}><HostCreateEditor {...props} /></ConfigProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: 'Draft host' } })
  return props
}

function clickSaveHostOnly() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'hosts.creation.saveHostOnly' }))
}

describe('HostCreateEditor 异步草稿保护', () => {
  it('丢弃整份新建草稿后，旧分组创建响应不能污染新的主机草稿', async () => {
    let resolve!: (group: { id: string; name: string }) => void
    const pending = new Promise<{ id: string; name: string }>((done) => { resolve = done })
    const onCreateGroup = vi.fn().mockReturnValue(pending)
    const onDirtyChange = vi.fn()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<ConfigProvider theme={{ token: { motion: false } }}><HostCreateEditor
      data={{ hosts: [], hostAssets: [], sshAccessProfiles: [], groups: [], proxies: [],
        credentials: [], hostIcons: [], sessions: [], fileSessions: [], forwards: [], remoteDesktopSessions: [] }}
      busy={false} getHostIconUrl={() => ''} onBack={vi.fn()} onCreate={onCreate}
      onDirtyChange={onDirtyChange} onProtectedIconIdChange={vi.fn()} onCreateGroup={onCreateGroup}
      onManageIcons={vi.fn()} onManageProxies={vi.fn()}
    /></ConfigProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: 'Original host' } })
    fireEvent.click(screen.getByRole('button', { name: 'hosts.addGroup' }))
    const groupInput = screen.getByRole('textbox', { name: 'hosts.groupNamePlaceholder' })
    fireEvent.change(groupInput, { target: { value: 'Old pending group' } })
    fireEvent.keyDown(groupInput, { key: 'Enter', code: 'Enter', charCode: 13 })
    expect(onCreateGroup).toHaveBeenCalledExactlyOnceWith('Old pending group')

    fireEvent.click(screen.getByRole('button', { name: 'hosts.discard' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'hosts.discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveValue('')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    onDirtyChange.mockClear()

    await act(async () => resolve({ id: 'old-pending-group', name: 'Old pending group' }))
    expect(onDirtyChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: 'New host' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    clickSaveHostOnly()
    await waitFor(() => expect(onCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      host: expect.objectContaining({ name: 'New host', group_id: '' }), ssh: [], remote_desktops: [],
    }), 'asset'))
  })
})

describe('新建空连接保存前决策', () => {
  it('保存前不提交，去添加只切换目录；之后同一草稿不重复询问', async () => {
    const props = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(props.onCreate).not.toHaveBeenCalled()
    await waitFor(() => expect(dialog.getByText('hosts.creation.noConnectionsTitle')).toBeVisible())
    expect(dialog.getByText('hosts.creation.noConnectionsDescription')).toBeVisible()
    expect(dialog.queryByRole('button', { name: 'app.cancel' })).not.toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'hosts.connectionSetup.go' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' })).toHaveAttribute('aria-selected', 'true')
    expect(props.onCreate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.hostInfo' }))
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveValue('Draft host')
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      host: expect.objectContaining({ name: 'Draft host' }), ssh: [], remote_desktops: [],
    }), 'asset'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['close', 'escape', 'mask'] as const)('%s 关闭不视为选择，再保存仍询问且保留草稿', async (method) => {
    const props = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('hosts.creation.noConnectionsTitle')).toBeVisible())
    if (method === 'close') {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    } else if (method === 'escape') {
      fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 })
    } else {
      const wrapper = dialog.closest('.ant-modal-wrap') as HTMLElement
      fireEvent.mouseDown(wrapper)
      fireEvent.click(wrapper)
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(props.onCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveValue('Draft host')
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(screen.getByText('hosts.creation.noConnectionsTitle')).toBeVisible())
    expect(props.onCreate).not.toHaveBeenCalled()
    clickSaveHostOnly()
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1))
  })

  it('选择去添加后新增连接，字段错误延后到再次保存时展示', async () => {
    const props = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(screen.getByText('hosts.creation.noConnectionsTitle')).toBeVisible())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'hosts.connectionSetup.go' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'hosts.access.desktop.add' }))
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull()
    expect(props.onCreate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(document.activeElement).toHaveAttribute('aria-invalid', 'true')
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it('仅保存主机失败后保留选择与草稿，后续保存提交最新内容且不重复询问', async () => {
    const props = renderEditor()
    vi.mocked(props.onCreate).mockRejectedValueOnce(new Error('save failed'))
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    clickSaveHostOnly()
    expect(await screen.findByText('save failed')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveValue('Draft host')
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: 'Corrected host' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(2))
    expect(vi.mocked(props.onCreate).mock.calls[1][0]).toMatchObject({ host: { name: 'Corrected host' } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('存在未完成连接时先定位校验，不能退化为仅保存主机', () => {
    const props = renderEditor()
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    fireEvent.click(screen.getByRole('button', { name: 'hosts.access.desktop.add' }))
    fireEvent.click(screen.getByRole('button', { name: 'hosts.creation.backToConnections' }))
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.hostInfo' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(props.onCreate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('hosts.creation.fixIncomplete')).toBeVisible()
    expect(document.activeElement).toHaveAttribute('aria-invalid', 'true')
  })
})
