import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { SFTPProfileEditor } from './SFTPProfileEditor.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const ssh: SSHAccessProfile = {
  id: 'ssh', host_id: 'host', name: 'Primary SSH', address: 'server.example.com', port: 22,
  username: 'operator', auth_method: 'private_key', credential_id: 'key',
  fingerprint_policy: 'confirm_on_change', is_default: true, sort_order: 0, created_at: '', updated_at: '',
}
const draft = { engine: 'sftp' as const, host_id: 'host', name: 'Files', ssh_profile_id: 'ssh' }

describe('SFTP 配置编辑器', () => {
  it('独立使用时保留名称编辑，只提供同主机的 SSH 并展示连接详情', async () => {
    const onChange = vi.fn()
    render(<SFTPProfileEditor draft={draft} sshProfiles={[ssh, { ...ssh, id: 'foreign', host_id: 'other', name: 'Foreign SSH' }]} disabled={false} onChange={onChange} />)
    expect(screen.queryByRole('combobox', { name: 'hosts.access.file.type' })).not.toBeInTheDocument()
    expect(screen.getByText('server.example.com')).toBeVisible()
    expect(screen.getByText('operator')).toBeVisible()
    expect(screen.getByText('hosts.auth.private_key')).toBeVisible()
    fireEvent.change(screen.getByLabelText('hosts.access.profileName'), { target: { value: 'Workspace' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, name: 'Workspace' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.sshProfile' }))
    expect(await screen.findByRole('option', { name: 'Primary SSH' })).toBeInTheDocument()
    expect(screen.queryByText('Foreign SSH')).not.toBeInTheDocument()
  })

  it('无同主机的 SSH 时禁用绑定选择，失效引用不展示其他主机详情', () => {
    render(<SFTPProfileEditor draft={draft} sshProfiles={[{ ...ssh, host_id: 'other' }]} errors={{ ssh_profile_id: 'unavailable' }} disabled={false} onChange={vi.fn()} />)
    const binding = screen.getByRole('combobox', { name: 'hosts.access.file.sshProfile' })
    expect(binding).toBeDisabled()
    expect(binding).toHaveAttribute('aria-invalid', 'true')
    expect(binding).toHaveAccessibleDescription('hosts.access.file.missingSSHDescription')
    expect(screen.queryByText('server.example.com')).not.toBeInTheDocument()
    expect(screen.getByText('hosts.access.file.noSSH')).toBeVisible()
  })

  it('有效引用的更换仍只投影 SSH 标识，忙碌时禁用全部字段', async () => {
    const onChange = vi.fn()
    const props = { draft, sshProfiles: [ssh, { ...ssh, id: 'backup', name: 'Backup SSH' }], onChange }
    const view = render(<SFTPProfileEditor {...props} disabled={false} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.sshProfile' }))
    fireEvent.click(await screen.findByText('Backup SSH'))
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, ssh_profile_id: 'backup' })
    view.rerender(<SFTPProfileEditor {...props} disabled />)
    expect(screen.getByLabelText('hosts.access.profileName')).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
