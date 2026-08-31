import { App as AntdApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpAccessRuntimeValue } from '../runtime/mcpAccessContext'

const oneTimeToken = 'tmcp_one_time_secret'
const testState = vi.hoisted(() => ({
  createClient: vi.fn(),
  patchClient: vi.fn(),
  deleteClient: vi.fn(),
  issueToken: vi.fn(),
  clients: [] as McpAccessRuntimeValue['clients'],
  mutationKey: '',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN', resolvedLanguage: 'zh-CN' },
    t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key,
  }),
}))

vi.mock('../runtime/mcpAccessContext', async () => {
  const actual = await vi.importActual('../runtime/mcpAccessContext')
  return {
    ...actual,
    useMcpAccessRuntime: (): McpAccessRuntimeValue => ({
      phase: 'ready',
      status: {
        instance_id: 'instance-1',
        revision: 2,
        enabled: true,
        state: 'enabled',
        endpoint: 'http://127.0.0.1:49217/mcp',
        protocol_version: '2025-11-25',
      },
      clients: testState.clients,
      approvals: [],
      mutationKey: testState.mutationKey,
      errorCode: '',
      reload: vi.fn(async () => undefined),
      setEnabled: vi.fn(async () => undefined),
      createClient: testState.createClient,
      patchClient: testState.patchClient,
      deleteClient: testState.deleteClient,
      issueToken: testState.issueToken,
      decideApproval: vi.fn(async () => undefined),
    }),
  }
})

import { McpSettingsPanel } from './McpSettingsPanel'

describe('McpSettingsPanel', () => {
  beforeEach(() => {
    testState.mutationKey = ''
    testState.clients = []
    testState.createClient.mockReset()
    testState.patchClient.mockReset()
    testState.deleteClient.mockReset()
    testState.issueToken.mockReset()
    testState.patchClient.mockResolvedValue(undefined)
    testState.deleteClient.mockResolvedValue(undefined)
    testState.createClient.mockResolvedValue({
      client: {
        id: 'client-1',
        name: 'Codex',
        enabled: true,
        approval_bypass: false,
        scopes: ['hosts:read', 'sessions:read'],
        host_access_mode: 'all_saved',
        source: 'external',
        read_only: false,
        token_prefix: 'tmcp_abcd',
        revision: 1,
        created_at: '2026-08-13T00:00:00Z',
        updated_at: '2026-08-13T00:00:00Z',
      },
      token: oneTimeToken,
    })
    testState.issueToken.mockResolvedValue({
      client: {
        id: 'client-1',
        name: 'Codex',
        enabled: true,
        approval_bypass: false,
        scopes: ['hosts:read', 'sessions:read'],
        host_access_mode: 'all_saved',
        source: 'external',
        read_only: false,
        token_prefix: 'tmcp_rotated',
        revision: 2,
        created_at: '2026-08-13T00:00:00Z',
        updated_at: '2026-08-13T00:01:00Z',
      },
      token: oneTimeToken,
    })
  })

  it('提示动态 Core 地址变化并指引复制完整客户端配置', () => {
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    expect(screen.getByText('settings.mcp.endpointHint')).toBeInTheDocument()
  })

  it('客户端名称超过 80 UTF-8 字节时保留输入并禁用提交', async () => {
    const user = userEvent.setup()
    render(<AntdApp><McpSettingsPanel /></AntdApp>)
    await user.click(screen.getByRole('button', { name: 'settings.mcp.addClient' }))
    const input = screen.getByPlaceholderText('settings.mcp.clientNamePlaceholder')

    await user.type(input, '中'.repeat(27))

    expect(input).toHaveValue('中'.repeat(27))
    expect(screen.getByRole('button', { name: 'settings.mcp.createClient' })).toBeDisabled()
    expect(testState.createClient).not.toHaveBeenCalled()
  })

  it('关闭一次性令牌窗口后等待销毁且 DOM 不再保留 secret', async () => {
    const user = userEvent.setup()
    render(<AntdApp><McpSettingsPanel /></AntdApp>)
    await user.click(screen.getByRole('button', { name: 'settings.mcp.addClient' }))
    await user.type(screen.getByPlaceholderText('settings.mcp.clientNamePlaceholder'), 'Codex')
    await user.click(screen.getByRole('button', { name: 'settings.mcp.createClient' }))

    expect(await screen.findByText(oneTimeToken)).toBeInTheDocument()
    expect(testState.createClient).toHaveBeenCalledWith({
      name: 'Codex',
      approval_bypass: false,
      scopes: ['hosts:read', 'sessions:read'],
    })
    expect(screen.getByRole('button', { name: 'settings.mcp.copyTokenLabel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.mcp.copyConfigLabel' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.mcp.tokenSaved' }))

    await waitFor(() => expect(screen.queryByText(oneTimeToken)).not.toBeInTheDocument())
    expect(document.body.textContent).not.toContain(oneTimeToken)
  })

  it('其他 MCP 管理操作进行时禁用服务开关', () => {
    testState.mutationKey = 'client:client-1'
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    expect(screen.getByRole('switch', { name: 'settings.mcp.enable' })).toBeDisabled()
  })

  it('客户端图标操作提供包含客户端名称的可访问名称', () => {
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: true,
      scopes: ['hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    expect(screen.getByRole('switch', { name: 'settings.mcp.clientToggleLabel:Codex' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.mcp.editClientLabel:Codex' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.mcp.newTokenLabel:Codex' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.mcp.deleteClientLabel:Codex' })).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approvalBypass')).toBeInTheDocument()
  })

  it('Agent 托管客户端正常展示但不提供普通管理操作', () => {
    testState.clients = [{
      id: 'client-agent',
      name: 'Termous Agent',
      source: 'builtin_agent',
      read_only: true,
      enabled: true,
      approval_bypass: false,
      scopes: ['hosts:read', 'sessions:read'],
      host_access_mode: 'all_saved',
      token_prefix: '',
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
    }]
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    expect(screen.getByText('settings.mcp.builtinAgentName')).toBeInTheDocument()
    expect(screen.queryByText('Termous Agent')).not.toBeInTheDocument()
    expect(screen.getByText('settings.mcp.managedByAgent')).toBeInTheDocument()
    expect(screen.queryByRole('switch', {
      name: 'settings.mcp.clientToggleLabel:Termous Agent',
    })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: 'settings.mcp.editClientLabel:Termous Agent',
    })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: 'settings.mcp.newTokenLabel:Termous Agent',
    })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: 'settings.mcp.deleteClientLabel:Termous Agent',
    })).not.toBeInTheDocument()
  })

  it('重新生成令牌前要求二次确认，取消时不调用接口', async () => {
    const user = userEvent.setup()
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: ['hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    const view = render(<AntdApp><McpSettingsPanel /></AntdApp>)

    await user.click(screen.getByRole('button', { name: 'settings.mcp.newTokenLabel:Codex' }))

    expect(screen.getByText('settings.mcp.newTokenConfirmDescription:Codex')).toBeInTheDocument()
    expect(testState.issueToken).not.toHaveBeenCalled()
    testState.clients = testState.clients.map((client) => ({
      ...client,
      name: 'Codex Desktop',
      revision: 2,
    }))
    view.rerender(<AntdApp><McpSettingsPanel /></AntdApp>)
    expect(screen.getByText('settings.mcp.newTokenConfirmDescription:Codex Desktop')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'app.cancel' }))

    expect(testState.issueToken).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'))
  })

  it('确认后重新生成令牌并展示一次性结果', async () => {
    const user = userEvent.setup()
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: ['hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    await user.click(screen.getByRole('button', { name: 'settings.mcp.newTokenLabel:Codex' }))
    expect(testState.issueToken).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'settings.mcp.newTokenConfirm' }))

    await waitFor(() => expect(testState.issueToken).toHaveBeenCalledWith('client-1'))
    expect(await screen.findByText(oneTimeToken)).toBeInTheDocument()
  })

  it('令牌重新生成失败时保留确认框以便重试', async () => {
    const user = userEvent.setup()
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: ['hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    testState.issueToken.mockRejectedValueOnce(new Error('revision conflict'))
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    await user.click(screen.getByRole('button', { name: 'settings.mcp.newTokenLabel:Codex' }))
    await user.click(screen.getByRole('button', { name: 'settings.mcp.newTokenConfirm' }))

    await waitFor(() => expect(testState.issueToken).toHaveBeenCalledWith('client-1'))
    expect(screen.getByText('settings.mcp.newTokenConfirmDescription:Codex')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.mcp.newTokenConfirm' })).toBeEnabled()
    expect(screen.queryByText(oneTimeToken)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.mcp.newTokenConfirm' }))

    await waitFor(() => expect(testState.issueToken).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(oneTimeToken)).toBeInTheDocument()
  })

  it('客户端权限未超过展示上限时保持完整展示', () => {
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: [
        'hosts:read',
        'hosts:probe',
        'sessions:read',
        'sessions:connect',
        'sessions:close',
      ],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    const scopeGroup = screen.getByRole('group', { name: /settings\.mcp\.permissions/ })
    expect(within(scopeGroup).getAllByText(/^settings\.mcp\.scope\./)).toHaveLength(5)
    expect(within(scopeGroup).queryByText(/^\+\d+$/)).not.toBeInTheDocument()
  })

  it('客户端权限超过展示上限时收起并可悬停查看完整列表', async () => {
    const user = userEvent.setup()
    const scopes = [
      'hosts:read',
      'hosts:probe',
      'sessions:read',
      'sessions:connect',
      'sessions:close',
      'commands:execute',
    ] as const
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: [...scopes],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    const scopeGroup = screen.getByRole('group', { name: /settings\.mcp\.permissions/ })
    expect(within(scopeGroup).getByText('+1')).toBeInTheDocument()
    expect(within(scopeGroup).queryByText('settings.mcp.scope.commands_execute')).not.toBeInTheDocument()

    await user.hover(within(scopeGroup).getByText('+1'))

    const tooltip = await screen.findByRole('tooltip')
    for (const scope of scopes) {
      expect(within(tooltip).getByText(`settings.mcp.scope.${scope.replace(':', '_')}`)).toBeInTheDocument()
    }
  })

  it('确认删除时调用客户端删除操作', async () => {
    const user = userEvent.setup()
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: ['hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    await user.click(screen.getByRole('button', { name: 'settings.mcp.deleteClientLabel:Codex' }))

    expect(screen.getByText('settings.mcp.deleteDescription:Codex')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.mcp.deleteConfirm' }))
    await waitFor(() => expect(testState.deleteClient).toHaveBeenCalledWith('client-1'))
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'))
  })

  it('权威列表已移除客户端时自动关闭过期的删除确认框', async () => {
    const user = userEvent.setup()
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: ['hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    const view = render(<AntdApp><McpSettingsPanel /></AntdApp>)

    await user.click(screen.getByRole('button', { name: 'settings.mcp.deleteClientLabel:Codex' }))
    expect(screen.getByText('settings.mcp.deleteDescription:Codex')).toBeInTheDocument()

    testState.clients = []
    view.rerender(<AntdApp><McpSettingsPanel /></AntdApp>)

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'))
  })

  it('删除失败时保留确认框以便用户重试', async () => {
    const user = userEvent.setup()
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: false,
      scopes: ['hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    testState.deleteClient.mockRejectedValueOnce(new Error('revision conflict'))
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    await user.click(screen.getByRole('button', { name: 'settings.mcp.deleteClientLabel:Codex' }))
    await user.click(screen.getByRole('button', { name: 'settings.mcp.deleteConfirm' }))

    await waitFor(() => expect(testState.deleteClient).toHaveBeenCalledWith('client-1'))
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave')
    expect(screen.getByRole('button', { name: 'settings.mcp.deleteConfirm' })).toBeEnabled()
  })

  it('编辑客户端仅提交名称和规范化权限，不改变启停状态', async () => {
    const user = userEvent.setup()
    testState.clients = [{
      id: 'client-1',
      name: 'Codex',
      enabled: true,
      approval_bypass: true,
      scopes: ['commands:read', 'hosts:read'],
      host_access_mode: 'all_saved',
      source: 'external',
      read_only: false,
      token_prefix: 'tmcp_abcd',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
      updated_at: '2026-08-13T00:00:00Z',
    }]
    render(<AntdApp><McpSettingsPanel /></AntdApp>)

    await user.click(screen.getByRole('button', { name: 'settings.mcp.editClientLabel:Codex' }))
    expect(screen.getByRole('switch', { name: 'settings.mcp.approvalBypass' })).toBeChecked()
    const input = screen.getByRole('textbox', { name: 'settings.mcp.clientName' })
    await user.clear(input)
    await user.type(input, '  Codex Desktop  ')
    await user.click(screen.getByRole('checkbox', { name: /settings\.mcp\.scope\.sessions_read/ }))
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(testState.patchClient).toHaveBeenCalledWith('client-1', {
      name: 'Codex Desktop',
      approval_bypass: true,
      scopes: ['hosts:read', 'sessions:read', 'commands:read'],
    }))
    expect(testState.createClient).not.toHaveBeenCalled()
  })
})
