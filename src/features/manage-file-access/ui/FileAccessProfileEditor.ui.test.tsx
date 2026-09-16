import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { FileAccessProfileEditor } from './FileAccessProfileEditor.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const sshProfiles: SSHAccessProfile[] = [{
  id: 'ssh-a',
  host_id: 'host-a',
  name: 'Primary SSH',
  address: 'server.example.com',
  port: 22,
  username: 'root',
  auth_method: 'password',
  credential_id: 'credential-a',
  fingerprint_policy: 'confirm_on_change',
  is_default: true,
  sort_order: 0,
  created_at: '2026-09-15T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
}]

const draft = {
  engine: 'sftp' as const,
  host_id: 'host-a',
  name: 'Files',
  ssh_profile_id: 'ssh-a',
}

describe('文件访问配置编辑器', () => {
  it('新建时将 Engine 作为访问类型选择项展示', () => {
    render(
      <FileAccessProfileEditor
        mode="create"
        draft={draft}
        sshProfiles={sshProfiles}
        disabled={false}
        onChange={vi.fn()}
      />,
    )

    const engineSelect = screen.getByRole('combobox', { name: 'hosts.access.file.type' })
    expect(engineSelect).toBeEnabled()
    expect(screen.getByText('SFTP')).toBeInTheDocument()
  })

  it('编辑时锁定不可变的 Engine 类型', () => {
    render(
      <FileAccessProfileEditor
        mode="edit"
        draft={draft}
        sshProfiles={sshProfiles}
        disabled={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'hosts.access.file.type' })).toBeDisabled()
  })
})
