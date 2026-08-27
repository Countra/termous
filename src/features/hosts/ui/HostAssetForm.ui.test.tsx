import { fireEvent, render, screen } from '@testing-library/react'
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
