import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HostAssetInput } from '#entities/host-asset'
import type { HostManagementData } from '../model/types.ts'
import { HostAssetForm } from './HostAssetForm.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const data: HostManagementData = {
  groups: [{ id: 'group-a', name: 'Production', sort_order: 0 }],
  proxies: [],
  credentials: [],
  hosts: [],
  hostAssets: [],
  sshAccessProfiles: [],
  hostIcons: [],
  sessions: [],
  fileSessions: [],
  forwards: [],
  remoteDesktopSessions: [],
}

const draft: HostAssetInput = {
  name: 'Host A',
  platform: 'linux',
  icon_id: '',
  group_id: '',
  tags: [],
  favorite: false,
  note: '',
}

describe('HostAssetForm', () => {
  it('异步创建分组只更新最新草稿的分组字段', async () => {
    let resolve!: (group: { id: string; name: string }) => void
    const pending = new Promise<{ id: string; name: string }>((done) => { resolve = done })
    const onChange = vi.fn()
    const onCreateGroup = vi.fn().mockReturnValue(pending)
    const props = { data, draft, disabled: false, getHostIconUrl: () => '', onChange, onCreateGroup, onManageIcons: vi.fn() }
    const view = render(<HostAssetForm {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'hosts.addGroup' }))
    const input = screen.getByRole('textbox', { name: 'hosts.groupNamePlaceholder' })
    fireEvent.change(input, { target: { value: 'New group' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 })
    expect(onCreateGroup).toHaveBeenCalledTimes(1)
    view.rerender(<HostAssetForm {...props} draft={{ ...draft, name: 'Changed while waiting', note: 'Keep this note' }} />)
    await act(async () => resolve({ id: 'new-group', name: 'New group' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Changed while waiting', note: 'Keep this note', group_id: 'new-group' }))
  })

  it('切页卸载后完成分组创建不会回写主机草稿', async () => {
    let resolve!: (group: { id: string; name: string }) => void
    const pending = new Promise<{ id: string; name: string }>((done) => { resolve = done })
    const onChange = vi.fn()
    const view = render(<HostAssetForm data={data} draft={draft} disabled={false} getHostIconUrl={() => ''} onChange={onChange} onCreateGroup={() => pending} onManageIcons={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'hosts.addGroup' }))
    const input = screen.getByRole('textbox', { name: 'hosts.groupNamePlaceholder' })
    fireEvent.change(input, { target: { value: 'New group' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 })
    view.unmount()
    await act(async () => resolve({ id: 'new-group', name: 'New group' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('等待创建分组时改选已有分组，迟到结果不会覆盖用户的新选择', async () => {
    let resolve!: (group: { id: string; name: string }) => void
    const pending = new Promise<{ id: string; name: string }>((done) => { resolve = done })
    const onChange = vi.fn()
    const props = { data, draft, disabled: false, getHostIconUrl: () => '', onChange, onCreateGroup: () => pending, onManageIcons: vi.fn() }
    const view = render(<HostAssetForm {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'hosts.addGroup' }))
    const input = screen.getByRole('textbox', { name: 'hosts.groupNamePlaceholder' })
    fireEvent.change(input, { target: { value: 'New group' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 })

    view.rerender(<HostAssetForm {...props} draft={{ ...draft, group_id: 'group-a' }} />)
    await act(async () => resolve({ id: 'new-group', name: 'New group' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'hosts.groupNamePlaceholder' })).not.toBeInTheDocument()
  })

  it('为分组选择与新增分组输入提供稳定的可访问名称', () => {
    render(
      <HostAssetForm
        data={data}
        draft={draft}
        disabled={false}
        getHostIconUrl={() => ''}
        onChange={vi.fn()}
        onCreateGroup={vi.fn()}
        onManageIcons={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'hosts.group' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'hosts.addGroup' }))
    expect(screen.getByRole('textbox', { name: 'hosts.groupNamePlaceholder' })).toBeInTheDocument()
  })
})
