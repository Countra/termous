import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { VNCAccessProfileDraft } from '../../model/vncAccessProfileDraft.ts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#shared/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('#shared/ui')>(),
  CustomSelect: ({
    label,
    value,
    options,
    disabled,
    status,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    onChange,
  }: {
    label: string
    value: string
    options: Array<{ value: string; label: string; description?: string }>
    disabled?: boolean
    status?: 'error' | 'warning'
    'aria-invalid'?: boolean
    'aria-describedby'?: string
    onChange: (value: string) => void
  }) => (
    <label>
      <span>{label}</span>
      <select
        aria-label={label}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        data-status={status}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  ),
}))

import { VNCProfileEditor } from './VNCProfileEditor.tsx'

const sshProfiles: SSHAccessProfile[] = [
  {
    id: 'ssh-primary',
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
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  },
  {
    id: 'ssh-backup',
    host_id: 'host-a',
    name: 'Backup SSH',
    address: 'backup.example.com',
    port: 2222,
    username: 'operator',
    auth_method: 'password',
    credential_id: 'credential-b',
    fingerprint_policy: 'confirm_on_change',
    is_default: false,
    sort_order: 1,
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  },
]

const draft: VNCAccessProfileDraft = {
  name: 'Console VNC',
  description: 'Operations console',
  route: 'ssh_tunnel',
  ssh_profile_id: 'ssh-primary',
  vnc: {
    target_host: '127.0.0.1',
    port: 5901,
    shared: true,
    default_view_only: false,
    default_display_mode: 'fit',
  },
}

function editorProps(): ComponentProps<typeof VNCProfileEditor> {
  return {
    draft,
    errors: {},
    submitted: false,
    disabled: false,
    sshProfiles,
    hasSavedTargetAuth: false,
    targetAuthDraft: { mutation: 'keep', password: '' },
    onChange: vi.fn(),
    onTargetAuthChange: vi.fn(),
  }
}

describe('VNCProfileEditor', () => {
  it('按统一分区展示配置，并精确投影连接、端点和查看器设置', () => {
    const props = editorProps()
    render(<VNCProfileEditor {...props} />)

    const basicSection = screen.getByRole('heading', { name: 'remoteDesktop.basicSection' }).closest('section')
    const connectionSection = screen.getByRole('heading', { name: 'remoteDesktop.connectionSection' }).closest('section')
    expect(basicSection).toBeVisible()
    expect(connectionSection).toBeVisible()
    expect(screen.getByRole('heading', { name: 'remoteDesktop.viewerSection' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'remoteDesktop.targetAuth.title' })).toBeVisible()
    expect(screen.queryByText('remoteDesktop.basicSectionHint')).not.toBeInTheDocument()
    expect(screen.queryByText('hosts.access.desktop.routeHint')).not.toBeInTheDocument()
    expect(screen.queryByText('remoteDesktop.viewerSectionHint')).not.toBeInTheDocument()
    expect(screen.queryByText('remoteDesktop.targetAuth.hint')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'hosts.access.profileName' })).toHaveValue('Console VNC')
    expect(screen.getByRole('textbox', { name: 'remoteDesktop.description' })).toHaveValue('Operations console')
    expect(screen.getByRole('combobox', { name: 'hosts.access.desktop.sshRoute' })).toHaveValue('ssh-primary')
    expect(screen.getByRole('combobox', { name: 'remoteDesktop.loopbackHost' })).toHaveValue('127.0.0.1')
    expect(screen.getByRole('spinbutton', { name: 'remoteDesktop.port' })).toHaveValue('5901')

    const routeMode = screen.getByRole('radiogroup', { name: 'remoteDesktop.route.label' })
    expect(connectionSection).toContainElement(routeMode)
    expect(basicSection).not.toContainElement(routeMode)
    expect(routeMode).toHaveAttribute('aria-controls')
    expect(document.getElementById(routeMode.getAttribute('aria-controls')!)).toBeVisible()

    const displayMode = screen.getByRole('radiogroup', { name: 'remoteDesktop.displayMode' })
    expect(within(displayMode).getByRole('radio', { name: 'remoteDesktop.display.fit' })).toBeChecked()
    const displayModeHintId = displayMode.getAttribute('aria-describedby')
    expect(displayModeHintId).toBeTruthy()
    expect(document.getElementById(displayModeHintId!)).toHaveTextContent('remoteDesktop.displayModeHint')

    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.access.profileName' }), {
      target: { value: 'Updated VNC' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({ ...draft, name: 'Updated VNC' })

    fireEvent.change(screen.getByRole('combobox', { name: 'hosts.access.desktop.sshRoute' }), {
      target: { value: 'ssh-backup' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({ ...draft, ssh_profile_id: 'ssh-backup' })

    fireEvent.change(screen.getByRole('combobox', { name: 'remoteDesktop.loopbackHost' }), {
      target: { value: '::1' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({
      ...draft,
      vnc: { ...draft.vnc, target_host: '::1' },
    })

    fireEvent.click(within(displayMode).getByRole('radio', { name: 'remoteDesktop.display.actual' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      ...draft,
      vnc: { ...draft.vnc, default_display_mode: 'actual' },
    })

    fireEvent.click(screen.getByRole('switch', { name: 'remoteDesktop.shared' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      ...draft,
      vnc: { ...draft.vnc, shared: false },
    })
  })

  it('延迟展示领域错误，并用固定反馈槽保持字段高度稳定', () => {
    const props = editorProps()
    const errors = {
      name: 'required' as const,
      ssh_profile_id: 'missing' as const,
      target_host: 'loopback' as const,
      port: 'range' as const,
    }
    const view = render(<VNCProfileEditor {...props} errors={errors} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(view.container.querySelectorAll('small[aria-hidden="true"]')).toHaveLength(5)

    view.rerender(<VNCProfileEditor {...props} errors={errors} submitted />)

    expect(screen.getByText('hosts.access.errors.required')).toHaveRole('alert')
    expect(screen.getByText('hosts.access.errors.sshMissing')).toHaveRole('alert')
    expect(screen.getByText('remoteDesktop.validationPort')).toHaveRole('alert')
    expect(view.container.querySelectorAll('small[role="alert"], small[aria-hidden="true"]')).toHaveLength(5)

    expectControlError(
      screen.getByRole('textbox', { name: 'hosts.access.profileName' }),
      'hosts.access.errors.required',
    )
    expectControlError(
      screen.getByRole('combobox', { name: 'hosts.access.desktop.sshRoute' }),
      'hosts.access.errors.sshMissing',
    )
    expectControlError(
      screen.getByRole('combobox', { name: 'remoteDesktop.loopbackHost' }),
      'remoteDesktop.validationLoopbackAddress',
    )
    expectControlError(
      screen.getByRole('spinbutton', { name: 'remoteDesktop.port' }),
      'remoteDesktop.validationPort',
    )
  })

  it('切换直连时改为目标 IP 输入并移除 SSH 端点字段', () => {
    const props = editorProps()
    const view = render(<VNCProfileEditor {...props} />)
    const routeMode = screen.getByRole('radiogroup', { name: 'remoteDesktop.route.label' })

    fireEvent.click(within(routeMode).getByRole('radio', { name: 'remoteDesktop.route.direct' }))
    expect(props.onChange).toHaveBeenLastCalledWith({
      ...draft,
      route: 'direct',
      ssh_profile_id: '',
      vnc: { ...draft.vnc, target_host: '' },
      route_memory: {
        ssh_profile_id: 'ssh-primary',
        direct_target_host: '',
      },
    })

    view.rerender(<VNCProfileEditor
      {...props}
      draft={{
        ...draft,
        route: 'direct',
        ssh_profile_id: '',
        vnc: { ...draft.vnc, target_host: '192.0.2.10' },
      }}
      errors={{ target_host: 'invalid' }}
      submitted
    />)
    expect(screen.queryByRole('combobox', { name: 'hosts.access.desktop.sshRoute' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'remoteDesktop.loopbackHost' })).not.toBeInTheDocument()
    expectControlError(
      screen.getByRole('textbox', { name: 'remoteDesktop.targetAddress' }),
      'remoteDesktop.validationTargetAddress',
    )
  })

  it('没有 SSH Profile 时保持直连可用并阻止进入不可完成的隧道路由', () => {
    const props = editorProps()
    render(<VNCProfileEditor
      {...props}
      sshProfiles={[]}
      draft={{
        ...props.draft,
        route: 'direct',
        ssh_profile_id: '',
        vnc: { ...props.draft.vnc, target_host: '192.0.2.10' },
      }}
    />)

    const routeMode = screen.getByRole('radiogroup', { name: 'remoteDesktop.route.label' })
    expect(within(routeMode).getByRole('radio', {
      name: 'remoteDesktop.route.sshTunnel',
    })).toBeDisabled()
    expect(within(routeMode).getByRole('radio', {
      name: 'remoteDesktop.route.direct',
    })).toBeChecked()
  })

  it('完整禁用所有字段和认证操作', () => {
    const props = editorProps()
    const view = render(<VNCProfileEditor {...props} disabled hasSavedTargetAuth />)

    for (const control of screen.getAllByRole('textbox')) expect(control).toBeDisabled()
    for (const control of screen.getAllByRole('combobox')) expect(control).toBeDisabled()
    expect(screen.getByRole('spinbutton')).toBeDisabled()
    for (const control of screen.getAllByRole('switch')) expect(control).toBeDisabled()
    for (const control of screen.getAllByRole('radio')) expect(control).toBeDisabled()
    expect(screen.getByLabelText('remoteDesktop.displayMode')).toHaveClass('ant-segmented-disabled')
    expect(screen.getByLabelText('remoteDesktop.targetAuth.mode')).toHaveClass('ant-segmented-disabled')
    expect(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.replace' })).toBeDisabled()

    view.rerender(
      <VNCProfileEditor
        {...props}
        disabled
        hasSavedTargetAuth
        targetAuthDraft={{ mutation: 'replace', password: '' }}
      />,
    )
    expect(screen.getByLabelText('remoteDesktop.targetAuth.password')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
  })

  it('保持 VNC 密码独立的保留、替换和移除草稿语义', () => {
    const props = editorProps()
    const view = render(<VNCProfileEditor {...props} />)

    expect(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.promptOption' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.saveOption' }))
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({ mutation: 'replace', password: '' })

    view.rerender(
      <VNCProfileEditor
        {...props}
        targetAuthDraft={{ mutation: 'replace', password: '' }}
      />,
    )
    expect(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.saveOption' })).toBeChecked()
    const firstCancel = screen.getByRole('button', { name: 'app.cancel' })
    firstCancel.focus()
    fireEvent.click(firstCancel)
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({ mutation: 'keep', password: '' })
    view.rerender(<VNCProfileEditor {...props} />)
    expect(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.promptOption' })).toHaveFocus()

    view.rerender(<VNCProfileEditor {...props} hasSavedTargetAuth />)
    expect(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.savedOption' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.promptOption' }))
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({ mutation: 'remove', password: '' })

    view.rerender(
      <VNCProfileEditor
        {...props}
        hasSavedTargetAuth
        targetAuthDraft={{ mutation: 'remove', password: '' }}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('remoteDesktop.targetAuth.removePending')
    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.savedOption' }))
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({ mutation: 'keep', password: '' })

    view.rerender(<VNCProfileEditor {...props} hasSavedTargetAuth />)

    fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.replace' }))
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({ mutation: 'replace', password: '' })

    view.rerender(
      <VNCProfileEditor
        {...props}
        hasSavedTargetAuth
        targetAuthDraft={{ mutation: 'replace', password: '' }}
        targetAuthError="required"
      />,
    )
    const password = screen.getByLabelText('remoteDesktop.targetAuth.password')
    const passwordError = screen.getByText('remoteDesktop.targetAuth.errors.required')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-describedby', passwordError.id)
    fireEvent.change(password, { target: { value: ' secret ' } })
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({
      mutation: 'replace',
      password: ' secret ',
    })
    expect(passwordError).toHaveRole('alert')

    const savedCancel = screen.getByRole('button', { name: 'app.cancel' })
    savedCancel.focus()
    fireEvent.click(savedCancel)
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({ mutation: 'keep', password: '' })
    view.rerender(<VNCProfileEditor {...props} hasSavedTargetAuth />)
    expect(screen.getByRole('button', { name: 'remoteDesktop.targetAuth.replace' })).toHaveFocus()

    view.rerender(
      <VNCProfileEditor
        {...props}
        hasSavedTargetAuth
        targetAuthDraft={{ mutation: 'replace', password: '' }}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'remoteDesktop.targetAuth.promptOption' }))
    expect(props.onTargetAuthChange).toHaveBeenLastCalledWith({ mutation: 'remove', password: '' })

    view.rerender(
      <VNCProfileEditor
        {...props}
        hasSavedTargetAuth
        targetAuthDraft={{ mutation: 'remove', password: '' }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'app.cancel' })).not.toBeInTheDocument()
  })
})

function expectControlError(control: HTMLElement, message: string) {
  expect(control).toHaveAttribute('aria-invalid', 'true')
  const feedbackId = control.getAttribute('aria-describedby')
  expect(feedbackId).toBeTruthy()
  expect(document.getElementById(feedbackId!)).toHaveTextContent(message)
}
