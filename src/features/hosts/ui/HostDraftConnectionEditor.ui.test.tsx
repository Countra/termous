import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { addHostCreationSSH, createHostCreationDraft, validateHostCreationDraft } from '../model/hostCreation.ts'
import { HostDraftConnectionEditor } from './HostDraftConnectionEditor.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function renderFileEditor(fileName = 'Files', submitted = false) {
  const first = addHostCreationSSH(createHostCreationDraft())
  const draft = addHostCreationSSH(first.draft).draft
  draft.ssh[0].draft.name = 'Primary SSH'
  draft.ssh[0].draft.address = 'server.example.com'
  draft.ssh[0].fileName = fileName
  draft.ssh[1].draft.name = 'Backup SSH'
  const props: ComponentProps<typeof HostDraftConnectionEditor> = {
    draft,
    selection: { kind: 'file', id: first.id },
    data: { hosts: [], hostAssets: [], sshAccessProfiles: [], groups: [], proxies: [],
      credentials: [], hostIcons: [], sessions: [], fileSessions: [], forwards: [], remoteDesktopSessions: [] },
    validation: validateHostCreationDraft(draft, { credentials: [], proxies: [], sshProfiles: [] }),
    submitted, busy: false, getHostIconUrl: () => '', onChange: vi.fn(), onBack: vi.fn(), onManageProxies: vi.fn(),
  }
  render(<HostDraftConnectionEditor {...props} />)
  return props
}

describe('新建主机的 SFTP 伴生配置', () => {
  it('有多个 SSH 时仍固定绑定对应配置，允许修改名称', () => {
    const props = renderFileEditor()
    expect(screen.getByRole('combobox', { name: 'hosts.access.file.sshProfile' })).toBeDisabled()
    expect(screen.getByText('server.example.com')).toBeVisible()
    expect(screen.getByText('hosts.access.file.companionHint')).toBeVisible()
    const name = screen.getByRole('textbox', { name: 'hosts.access.profileName' })
    expect(name).toBeEnabled()
    fireEvent.change(name, { target: { value: 'Workspace' } })
    expect(props.onChange).toHaveBeenLastCalledWith({
      ...props.draft,
      ssh: [{ ...props.draft.ssh[0], fileName: 'Workspace' }, props.draft.ssh[1]],
    })
  })

  it.each([
    ['', 'hosts.access.errors.required'],
    ['x'.repeat(81), 'hosts.access.errors.tooLong'],
  ])('提交后按真实校验原因显示名称错误：%s', (fileName, error) => {
    renderFileEditor(fileName, true)
    const name = screen.getByRole('textbox', { name: 'hosts.access.profileName' })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription(error)
  })

  it('首次提交前不提前显示名称错误', () => {
    renderFileEditor('', false)
    expect(screen.getByRole('textbox', { name: 'hosts.access.profileName' })).not.toHaveAttribute('aria-invalid', 'true')
  })
})
