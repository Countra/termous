import { App as AntdApp } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { McpClient } from '#entities/mcp-access'
import { McpClientEditor } from './McpClientEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; total?: number }) => {
      if (values?.count !== undefined && values.total !== undefined) {
        return `${key}:${values.count}/${values.total}`
      }
      return key
    },
  }),
}))

const client: McpClient = {
  id: 'client-1',
  name: 'Codex',
  enabled: true,
  approval_bypass: false,
  scopes: ['hosts:probe', 'commands:interrupt'],
  host_access_mode: 'all_saved',
  token_prefix: 'tmcp_abcd',
  revision: 1,
  created_at: '2026-08-13T00:00:00Z',
  updated_at: '2026-08-13T00:00:00Z',
}

function renderEditor({
  editingClient = null,
  busy = false,
  disabled = false,
  onCancel = vi.fn(),
  onSubmit = vi.fn(async () => undefined),
}: {
  editingClient?: McpClient | null
  busy?: boolean
  disabled?: boolean
  onCancel?: () => void
  onSubmit?: (value: {
    name: string
    approval_bypass: boolean
    scopes: McpClient['scopes']
  }) => Promise<void>
} = {}) {
  return {
    onCancel,
    onSubmit,
    ...render(
      <AntdApp>
        <McpClientEditor
          open
          client={editingClient}
          busy={busy}
          disabled={disabled}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      </AntdApp>,
    ),
  }
}

describe('McpClientEditor', () => {
  it('新建客户端保持精简信息层级，并完整展示四个权限组', () => {
    renderEditor()

    expect(screen.queryByText('settings.mcp.editorCreateHint')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.clientIdentity')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.clientIdentityHint')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.permissionsHint')).not.toBeInTheDocument()
    expect(scopeCheckbox('hosts_read')).toBeChecked()
    expect(scopeCheckbox('sessions_read')).toBeChecked()
    expect(scopeCheckbox('hosts_probe')).not.toBeChecked()
    expect(scopeCheckbox('sessions_connect')).not.toBeChecked()
    expect(scopeCheckbox('sessions_close')).not.toBeChecked()
    expect(scopeCheckbox('commands_execute')).not.toBeChecked()
    expect(scopeCheckbox('commands_read')).not.toBeChecked()
    expect(scopeCheckbox('commands_interrupt')).not.toBeChecked()
    expect(scopeCheckbox('sftp_read')).not.toBeChecked()
    expect(scopeCheckbox('sftp_connect')).not.toBeChecked()
    expect(scopeCheckbox('sftp_close')).not.toBeChecked()
    expect(scopeCheckbox('sftp_write')).not.toBeChecked()
    expect(scopeCheckbox('sftp_transfer')).not.toBeChecked()
    expect(scopeCheckbox('sftp_cancel')).not.toBeChecked()
    expect(approvalBypassSwitch()).not.toBeChecked()
    expect(screen.getByRole('group', { name: /settings\.mcp\.permissionGroup\.hosts/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /settings\.mcp\.permissionGroup\.sessions/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /settings\.mcp\.permissionGroup\.commands/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /settings\.mcp\.permissionGroup\.sftp/ })).toBeInTheDocument()
    expect(screen.getAllByText('settings.mcp.approvalRequired')).toHaveLength(3)
    expect(screen.getByText('settings.mcp.selectedPermissions:2/14')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.mcp.restoreReadOnly' })).toBeEnabled()
  })

  it('悬停权限说明时展示权限名称与完整说明', async () => {
    const user = userEvent.setup()
    renderEditor()

    const trigger = screen.getByText('settings.mcp.scopeDescription.sftp_transfer')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.hover(trigger)

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('settings.mcp.scope.sftp_transfer')
    expect(tooltip).toHaveTextContent('settings.mcp.scopeDescription.sftp_transfer')
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)
  })

  it('编辑时回填权限，提交名称与规范顺序的精确权限集合', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    renderEditor({ editingClient: client, onSubmit })

    expect(screen.getByRole('textbox', { name: 'settings.mcp.clientName' })).toHaveValue('Codex')
    expect(scopeCheckbox('hosts_probe')).toBeChecked()
    expect(scopeCheckbox('commands_interrupt')).toBeChecked()
    await user.clear(screen.getByRole('textbox', { name: 'settings.mcp.clientName' }))
    await user.type(screen.getByRole('textbox', { name: 'settings.mcp.clientName' }), '  Codex Desktop  ')
    await user.click(scopeCheckbox('sessions_read'))
    await user.click(scopeCheckbox('sftp_transfer'))
    await user.click(approvalBypassSwitch())
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Codex Desktop',
      approval_bypass: true,
      scopes: ['hosts:probe', 'sessions:read', 'commands:interrupt', 'sftp:transfer'],
    })
  })

  it('无需审批默认关闭，开启后更新敏感权限提示并显示高风险警告', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(approvalBypassSwitch()).not.toBeChecked()
    expect(screen.getAllByText('settings.mcp.approvalRequired')).toHaveLength(3)
    expect(screen.queryByText('settings.mcp.approvalBypassDescription')).not.toBeInTheDocument()

    await user.click(approvalBypassSwitch())

    expect(approvalBypassSwitch()).toBeChecked()
    expect(screen.queryByText('settings.mcp.approvalRequired')).not.toBeInTheDocument()
    expect(screen.getAllByText('settings.mcp.approvalBypassed')).toHaveLength(3)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('settings.mcp.approvalBypassTitle')
    expect(alert).toHaveTextContent('settings.mcp.approvalBypassDescription')
  })

  it('权限可以独立移除，空权限时显示校验并禁止保存', async () => {
    const user = userEvent.setup()
    renderEditor({ editingClient: client })

    await user.click(scopeCheckbox('hosts_probe'))
    await user.click(scopeCheckbox('commands_interrupt'))

    expect(screen.getByRole('status')).toHaveTextContent('settings.mcp.permissionsEmpty')
    expect(screen.getByRole('button', { name: /app\.save$/ })).toBeDisabled()
  })

  it('高风险权限始终带风险标识，选中时追加核心警告', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.getAllByText('settings.mcp.highRisk')).toHaveLength(2)
    expect(screen.queryByText('settings.mcp.closeScopeDescription')).not.toBeInTheDocument()
    await user.click(scopeCheckbox('sessions_close'))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('settings.mcp.closeScopeTitle')
    expect(alert).toHaveTextContent('settings.mcp.closeScopeDescription')
    await user.click(scopeCheckbox('sessions_close'))
    expect(screen.queryByText('settings.mcp.closeScopeDescription')).not.toBeInTheDocument()
  })

  it('恢复默认只读不会自动保留其他授权', async () => {
    const user = userEvent.setup()
    renderEditor({
      editingClient: { ...client, approval_bypass: true },
    })

    expect(approvalBypassSwitch()).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'settings.mcp.restoreReadOnly' }))

    expect(scopeCheckbox('hosts_read')).toBeChecked()
    expect(scopeCheckbox('sessions_read')).toBeChecked()
    expect(scopeCheckbox('hosts_probe')).not.toBeChecked()
    expect(scopeCheckbox('commands_interrupt')).not.toBeChecked()
    expect(approvalBypassSwitch()).not.toBeChecked()
  })

  it('保存期间锁定字段、权限与退出操作', () => {
    renderEditor({ editingClient: client, busy: true })

    expect(screen.getByRole('textbox', { name: 'settings.mcp.clientName' })).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled()
    expect(approvalBypassSwitch()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /app\.save$/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('其他 MCP 操作进行时锁定编辑器但不显示提交 loading', () => {
    renderEditor({ editingClient: client, disabled: true })

    expect(screen.getByRole('textbox', { name: 'settings.mcp.clientName' })).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled()
    expect(approvalBypassSwitch()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'settings.mcp.restoreReadOnly' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    expect(screen.queryByRole('img', { name: 'loading' })).not.toBeInTheDocument()
  })
})

function scopeCheckbox(scopeKey: string) {
  return screen.getByRole('checkbox', { name: new RegExp(`settings\\.mcp\\.scope\\.${scopeKey}`) })
}

function approvalBypassSwitch() {
  return screen.getByRole('switch', { name: 'settings.mcp.approvalBypass' })
}
