import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { createRemoteDesktopAccessProfileDraft, validateRemoteDesktopAccessProfileDraft } from '../model/remoteDesktopAccessProfileDraft.ts'
import type { VNCTargetAuthDraft } from '../model/vncTargetAuthDraft.ts'
import { RemoteDesktopProfileEditor } from './RemoteDesktopProfileEditor.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const ssh: SSHAccessProfile = {
  id: 'ssh-primary', host_id: 'host', name: 'Primary SSH', address: '192.0.2.5', port: 22,
  username: 'operator', auth_method: 'password', credential_id: '', fingerprint_policy: 'confirm_on_change',
  is_default: true, sort_order: 0, created_at: '', updated_at: '',
}

function Editor({ disabled = false, profiles = [ssh], saved = false, submitted = false }: {
  disabled?: boolean; profiles?: SSHAccessProfile[]; saved?: boolean; submitted?: boolean
}) {
  const [draft, setDraft] = useState(() => createRemoteDesktopAccessProfileDraft('', 'rdp'))
  const [auth, setAuth] = useState<VNCTargetAuthDraft>({ mutation: 'keep', password: '' })
  return <RemoteDesktopProfileEditor
    draft={draft} onChange={setDraft} targetAuthDraft={auth} onTargetAuthChange={setAuth}
    disabled={disabled} sshProfiles={profiles} hasSavedTargetAuth={saved} submitted={submitted}
    errors={validateRemoteDesktopAccessProfileDraft(draft, new Set(profiles.map((profile) => profile.id)))}
  />
}

describe('RemoteDesktopProfileEditor', () => {
  it('分区展示 RDP，协议往返切换不丢失账户、目标和尺寸', () => {
    render(<Editor />)
    for (const name of ['basicSection', 'connectionSection', 'targetAuth.title', 'viewerSection']) {
      expect(screen.getByRole('heading', { name: `remoteDesktop.${name}` })).toBeVisible()
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.access.profileName' }), { target: { value: 'Windows' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'remoteDesktop.targetAddress' }), { target: { value: '192.0.2.10' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'remoteDesktop.rdp.username' }), { target: { value: 'operator' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'remoteDesktop.rdp.width' }), { target: { value: '1280' } })
    fireEvent.click(screen.getByRole('radio', { name: 'VNC' }))
    fireEvent.click(screen.getByRole('radio', { name: 'RDP' }))
    expect(screen.getByRole('textbox', { name: 'remoteDesktop.targetAddress' })).toHaveValue('192.0.2.10')
    expect(screen.getByRole('textbox', { name: 'remoteDesktop.rdp.username' })).toHaveValue('operator')
    expect(screen.getByRole('spinbutton', { name: 'remoteDesktop.rdp.width' })).toHaveValue('1280')
  })

  it('进入隧道选择默认 SSH，直连和隧道地址独立恢复', () => {
    render(<Editor />)
    fireEvent.change(screen.getByRole('textbox', { name: 'remoteDesktop.targetAddress' }), { target: { value: '192.0.2.10' } })
    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.route.sshTunnel' }))
    expect(screen.getByText('Primary SSH')).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: 'remoteDesktop.rdp.target' }), { target: { value: 'windows.internal' } })
    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.route.direct' }))
    expect(screen.getByRole('textbox', { name: 'remoteDesktop.targetAddress' })).toHaveValue('192.0.2.10')
    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.route.sshTunnel' }))
    expect(screen.getByRole('textbox', { name: 'remoteDesktop.rdp.target' })).toHaveValue('windows.internal')
  })

  it('没有 SSH 配置时禁用隧道，并解释可用条件', () => {
    render(<Editor profiles={[]} />)
    expect(screen.getByRole('radio', { name: 'remoteDesktop.route.sshTunnel' })).toBeDisabled()
    expect(screen.getByText('remoteDesktop.rdp.noSSH')).toBeVisible()
  })

  it('数字输入可清空，离开字段即提示错误，修正后移除错误关联', () => {
    render(<Editor />)
    const port = screen.getByRole('spinbutton', { name: 'remoteDesktop.rdp.port' })
    fireEvent.change(port, { target: { value: '' } })
    expect(port).toHaveValue('')
    fireEvent.blur(port)
    expect(port).toHaveAttribute('aria-invalid', 'true')
    expect(port).toHaveAccessibleDescription('remoteDesktop.rdp.portInvalid')
    fireEvent.change(port, { target: { value: '3390' } })
    expect(port).not.toHaveAttribute('aria-invalid')
    const server = screen.getByRole('textbox', { name: 'remoteDesktop.rdp.serverName' })
    fireEvent.change(server, { target: { value: 'https://windows' } })
    fireEvent.blur(server)
    expect(server).toHaveAttribute('aria-invalid', 'true')
    expect(server).toHaveAccessibleDescription('remoteDesktop.rdp.hostInvalid remoteDesktop.rdp.serverNameHint')
  })

  it('RDP 保存、替换和移除密码使用对应协议文案', () => {
    render(<Editor saved />)
    expect(screen.getByText('remoteDesktop.rdp.targetAuth.savedHint')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.replace' }))
    expect(screen.getByLabelText('remoteDesktop.rdp.targetAuth.password')).toBeVisible()
    expect(screen.queryByLabelText('remoteDesktop.targetAuth.password')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'app.cancel' }))
    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.promptOption' }))
    expect(screen.getByText('remoteDesktop.rdp.targetAuth.removePendingHint')).toBeVisible()
  })

  it('忙碌状态禁用协议、路由、输入和查看器开关', () => {
    render(<Editor disabled />)
    for (const role of ['textbox', 'spinbutton', 'radio', 'switch']) {
      for (const control of screen.getAllByRole(role)) expect(control).toBeDisabled()
    }
  })

  it('提交后展示丢失 SSH 引用与超限尺寸的精确错误', () => {
    const draft = createRemoteDesktopAccessProfileDraft('missing', 'rdp')
    if (draft.protocol !== 'rdp') throw new Error('需要 RDP 草稿')
    draft.rdp.width = 8192
    draft.rdp.height = 8192
    const props: ComponentProps<typeof RemoteDesktopProfileEditor> = {
      draft, errors: validateRemoteDesktopAccessProfileDraft(draft, new Set()), submitted: true, disabled: false,
      sshProfiles: [], hasSavedTargetAuth: false, targetAuthDraft: { mutation: 'keep', password: '' },
      onChange: vi.fn(), onTargetAuthChange: vi.fn(),
    }
    render(<RemoteDesktopProfileEditor {...props} />)
    expect(screen.getByRole('combobox', { name: 'hosts.access.desktop.sshRoute' })).toHaveAccessibleDescription('hosts.access.errors.sshMissing')
    const viewer = screen.getByRole('region', { name: 'remoteDesktop.viewerSection' })
    expect(within(viewer).getAllByRole('alert')).toHaveLength(2)
  })
})
