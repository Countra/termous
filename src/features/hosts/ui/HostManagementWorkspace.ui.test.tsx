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
      openAccessIntentKey,
      onBack,
      onDirtyChange,
    }: {
      host: Host
      openAccessIntentKey?: number
      onBack: () => void
      onDirtyChange: (dirty: boolean) => void
    }) => {
      const [draft, setDraft] = React.useState(host.name)
      return (
        <div>
          <output data-testid="access-draft">{draft}</output>
          <output data-testid="access-intent">{`${host.id}:${openAccessIntentKey ?? 0}`}</output>
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

const secondHost: Host = {
  ...host,
  id: 'host-b',
  name: '备用主机',
  address: 'host-b.example.com',
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
  saveRemoteDesktopTargetAuth: vi.fn(),
  deleteRemoteDesktopTargetAuth: vi.fn(),
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

  it('跨主机访问意图只在目标主机确认加载后消费', () => {
    const onSelectHost = vi.fn()
    const onAccessIntentHandled = vi.fn()
    const props = {
      data: {
        hosts: [host, secondHost],
        groups: [],
        proxies: [],
        credentials: [],
        hostIcons: [],
      },
      actionBusy: false,
      accessGateway,
      onSelectHost,
      onAccessIntentHandled,
      onSave: vi.fn(),
      onDelete: vi.fn(),
      onCreateGroup: vi.fn(),
      onRenameGroup: vi.fn(),
      onDeleteGroup: vi.fn(),
      onReorderGroups: vi.fn(),
      onCreateProxy: vi.fn(),
      onUpdateProxy: vi.fn(),
      onDeleteProxy: vi.fn(),
      onUploadHostIcon: vi.fn(),
      onRenameHostIcon: vi.fn(),
      onReorderHostIcons: vi.fn(),
      onDeleteHostIcon: vi.fn(),
      getHostIconUrl: () => '',
    }
    const view = render(
      <HostManagementWorkspace
        {...props}
        selectedHostId={host.id}
        accessIntent={{ key: 1, hostId: host.id }}
      />,
    )

    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-a:1')
    fireEvent.click(screen.getByRole('button', { name: '修改访问草稿' }))

    view.rerender(
      <HostManagementWorkspace
        {...props}
        selectedHostId={secondHost.id}
        accessIntent={{ key: 2, hostId: secondHost.id }}
      />,
    )

    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-a:0')
    fireEvent.click(screen.getByRole('button', { name: 'app.cancel' }))
    expect(onAccessIntentHandled).toHaveBeenCalledWith(2)
    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-a:0')

    view.rerender(
      <HostManagementWorkspace
        {...props}
        selectedHostId={host.id}
        accessIntent={null}
      />,
    )
    view.rerender(
      <HostManagementWorkspace
        {...props}
        selectedHostId={secondHost.id}
        accessIntent={{ key: 3, hostId: secondHost.id }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'hosts.discardAndContinue' }))
    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-b:3')
    expect(screen.getByTestId('access-draft')).toHaveTextContent('备用主机')
  })
})
