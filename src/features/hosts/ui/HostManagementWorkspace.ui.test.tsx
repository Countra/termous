import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { HostAccessManagementGateway } from '#features/host-access'
import { HostManagementWorkspace } from './HostManagementWorkspace.tsx'

vi.mock('./HostAccessWorkspace', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    HostAccessWorkspace: ({
      host,
      onBack,
      onDirtyChange,
    }: {
      host: Host
      onBack: () => void
      onDirtyChange: (dirty: boolean) => void
    }) => {
      const [draft, setDraft] = React.useState(host.name)
      return (
        <div>
          <output data-testid="access-draft">{draft}</output>
          <button
            type="button"
            onClick={() => {
              setDraft('未保存访问草稿')
              onDirtyChange(true)
            }}
          >
            修改访问草稿
          </button>
          <button type="button" onClick={onBack}>返回主机列表</button>
        </div>
      )
    },
  }
})

const host: Host = {
  id: 'host-a',
  name: '测试主机',
  platform: 'linux',
  group_id: '',
  address: 'host-a.example.com',
  port: 22,
  username: 'root',
  auth_method: 'password',
  credential_id: 'credential-a',
  tags: [],
  favorite: false,
  fingerprint_policy: 'confirm_on_change',
}

const accessGateway: HostAccessManagementGateway = {
  loadCatalog: vi.fn(),
  listSSHProfiles: vi.fn(),
  updateHostAsset: vi.fn(),
  createSSHProfile: vi.fn(),
  updateSSHProfile: vi.fn(),
  deleteSSHProfile: vi.fn(),
  setDefaultSSHProfile: vi.fn(),
  inspectSSHProfileReferences: vi.fn(),
  updateFileProfile: vi.fn(),
  setDefaultFileProfile: vi.fn(),
  createRemoteDesktopProfile: vi.fn(),
  updateRemoteDesktopProfile: vi.fn(),
  deleteRemoteDesktopProfile: vi.fn(),
  setDefaultRemoteDesktopProfile: vi.fn(),
}

describe('主机管理工作区', () => {
  it('确认放弃访问草稿后重置隐藏编辑器状态', () => {
    render(
      <HostManagementWorkspace
        data={{ hosts: [host], groups: [], proxies: [], credentials: [], hostIcons: [] }}
        selectedHostId={host.id}
        actionBusy={false}
        accessGateway={accessGateway}
        onSelectHost={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onReorderGroups={vi.fn()}
        onCreateProxy={vi.fn()}
        onUpdateProxy={vi.fn()}
        onDeleteProxy={vi.fn()}
        onUploadHostIcon={vi.fn()}
        onRenameHostIcon={vi.fn()}
        onReorderHostIcons={vi.fn()}
        onDeleteHostIcon={vi.fn()}
        getHostIconUrl={() => ''}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改访问草稿' }))
    expect(screen.getByTestId('access-draft')).toHaveTextContent('未保存访问草稿')

    fireEvent.click(screen.getByRole('button', { name: '返回主机列表' }))
    fireEvent.click(screen.getByRole('button', { name: 'hosts.discardAndContinue' }))

    expect(screen.getByTestId('access-draft')).toHaveTextContent('测试主机')
    fireEvent.click(screen.getByRole('button', { name: /测试主机/ }))
    expect(screen.getByTestId('access-draft')).toHaveTextContent('测试主机')
  })
})
