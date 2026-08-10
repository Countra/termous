import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEvent, ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForwardInstance, ForwardMode, ForwardProfile } from '#entities/forward'
import type { Host } from '#entities/host'

const workspaceMocks = vi.hoisted(() => ({
  notification: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => {
  interface ButtonProps {
    children?: ReactNode
    disabled?: boolean
    icon?: ReactNode
    onClick?: () => void
    'aria-label'?: string
  }

  interface InputProps {
    id?: string
    name?: string
    value?: string
    placeholder?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    'aria-label'?: string
  }

  const Button = ({
    children,
    disabled,
    icon,
    onClick,
    'aria-label': ariaLabel,
  }: ButtonProps) => (
    <button type="button" disabled={disabled} aria-label={ariaLabel} onClick={onClick}>
      {icon}
      {children}
    </button>
  )

  const Input = Object.assign(
    ({ id, name, value, placeholder, onChange, 'aria-label': ariaLabel }: InputProps) => (
      <input
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={onChange}
      />
    ),
    {
      TextArea: ({
        id,
        name,
        value,
        onChange,
      }: {
        id?: string
        name?: string
        value?: string
        onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void
      }) => <textarea id={id} name={name} value={value} onChange={onChange} />,
    },
  )

  const Empty = Object.assign(
    () => null,
    { PRESENTED_IMAGE_SIMPLE: 'simple' },
  )

  return {
    App: {
      useApp: () => ({ notification: workspaceMocks.notification }),
    },
    Button,
    Empty,
    Input,
    Modal: ({
      open,
      title,
      children,
      okText,
      cancelText,
      onOk,
      onCancel,
    }: {
      open: boolean
      title?: ReactNode
      children?: ReactNode
      okText?: ReactNode
      cancelText?: ReactNode
      onOk?: () => void
      onCancel?: () => void
    }) => open ? (
      <div role="dialog">
        {title}
        {children}
        <button type="button" onClick={onCancel}>{cancelText}</button>
        <button type="button" onClick={onOk}>{okText}</button>
      </div>
    ) : null,
    Popconfirm: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('#shared/ui', () => ({
  termousNotificationClassName: 'termous-notification',
  uiStyles: {
    'field-label': 'field-label',
    'page-actions': 'page-actions',
    'secondary-button': 'secondary-button',
  },
  ConnectionActionButton: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  CustomSelect: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string
    value: string
    options: Array<{ value: string; label: string }>
    onChange: (value: string) => void
  }) => (
    <label>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  ),
  EditorModeContext: ({ mode, label, title }: { mode: string; label: string; title?: ReactNode }) => (
    <div data-editor-mode={mode}>{title}<span>{label}</span></div>
  ),
  ManagementFilterTabs: () => null,
  StatusBadge: () => null,
}))

vi.mock('../features/forwards/ui/ForwardEditorFields', () => ({
  ForwardEditorFields: () => null,
}))

vi.mock('../features/forwards/ui/ForwardModeSelector', () => ({
  ForwardModeBadge: () => null,
  ForwardModeSelector: ({
    value,
    onChange,
  }: {
    value?: ForwardMode
    onChange?: (value: ForwardMode) => void
  }) => (
    <button type="button" aria-label="select-dynamic" onClick={() => onChange?.('dynamic')}>
      {value}
    </button>
  ),
}))

vi.mock('../features/forwards/ui/ForwardRouteDiagram', () => ({
  ForwardRouteDiagram: () => null,
}))

vi.mock('../features/forwards/ui/ForwardRuntimeActions', () => ({
  ForwardRuntimeActions: () => null,
}))

vi.mock('../features/forwards/ui/ForwardRuntimeMetrics', () => ({
  ForwardRuntimeMetrics: () => null,
}))

vi.mock('../features/forwards/ui/ForwardStateFeedback', () => ({
  ForwardStateFeedback: () => null,
}))

import { ForwardManagementWorkspace } from '../features/forwards/ui/ForwardManagementWorkspace'

function host(id: string): Host {
  return {
    id,
    name: `Host ${id}`,
    platform: 'linux',
    group_id: '',
    address: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential-password',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
  }
}

function workspaceProps() {
  return {
    data: {
      hosts: [host('host-a'), host('host-b')],
      forwardProfiles: [],
      forwards: [],
    },
    actionBusy: false,
    temporaryIntent: { key: 1, hostId: 'host-b' },
    onCreateProfile: vi.fn(async () => ({} as never)),
    onUpdateProfile: vi.fn(async () => ({} as never)),
    onDeleteProfile: vi.fn(async () => undefined),
    onStartForward: vi.fn(async () => ({} as ForwardInstance)),
    onRestartForward: vi.fn(async () => undefined),
    onStopForward: vi.fn(async () => undefined),
  } satisfies ComponentProps<typeof ForwardManagementWorkspace>
}

function profile(): ForwardProfile {
  return {
    id: 'profile-a',
    name: 'Profile Alpha',
    description: '',
    mode: 'local',
    host_id: 'host-a',
    bind_host: '127.0.0.1',
    bind_port: 8080,
    target_host: '127.0.0.1',
    target_port: 80,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('端口转发临时启动意图', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('同一意图只消费一次，并按指定主机提交规范化的动态转发参数', async () => {
    const user = userEvent.setup()
    const props = workspaceProps()
    const view = render(<ForwardManagementWorkspace {...props} />)

    const hostSelect = await screen.findByRole('combobox', { name: 'forwards.host' })
    expect(hostSelect).toHaveValue('host-b')
    expect(screen.getByText('forwards.temporaryTitle')).toBeInTheDocument()
    expect(document.querySelector('[data-editor-mode]')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'select-dynamic' }))
    await user.click(screen.getByRole('button', { name: 'forwards.start' }))

    await waitFor(() => {
      expect(props.onStartForward).toHaveBeenCalledWith({
        name: 'forwards.temporaryDefaultName',
        description: '',
        mode: 'dynamic',
        host_id: 'host-b',
        bind_host: '127.0.0.1',
        bind_port: 8080,
        target_host: '',
        target_port: 0,
        scope: 'background_once',
      })
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      view.rerender(
        <ForwardManagementWorkspace
          {...props}
          temporaryIntent={{ key: 1, hostId: 'host-a' }}
        />,
      )
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(props.onStartForward).toHaveBeenCalledTimes(1)
  })

  it('Profile 弹窗区分新建和编辑模式，临时转发不复用模式标识', async () => {
    const user = userEvent.setup()
    const props = workspaceProps()
    const savedProfile = profile()
    render(
      <ForwardManagementWorkspace
        {...props}
        temporaryIntent={undefined}
        data={{
          ...props.data,
          forwardProfiles: [savedProfile],
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'forwards.newProfile' }))
    const createContext = document.querySelector('[data-editor-mode="create"]')
    expect(createContext).toHaveTextContent('forwards.profiles')
    expect(createContext).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'app.cancel' }))
    await user.click(screen.getByRole('button', { name: 'app.update' }))
    const editContext = document.querySelector('[data-editor-mode="edit"]')
    expect(editContext).toHaveTextContent('Profile Alpha')
    expect(editContext).toHaveTextContent('app.edit')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeInTheDocument()
  })
})
