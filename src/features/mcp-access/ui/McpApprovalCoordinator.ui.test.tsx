import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpApproval, McpApprovalOperation } from '#entities/mcp-access'

const testState = vi.hoisted(() => ({
  approvals: [] as McpApproval[],
  mutationKey: '',
  decideApproval: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { time?: string; count?: number }) => {
      if (values?.time) return `${key}:${values.time}`
      if (values?.count !== undefined) return `${key}:${values.count}`
      return key
    },
  }),
}))

vi.mock('antd', () => ({
  App: { useApp: () => ({ notification: { error: vi.fn() } }) },
  Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) => open ? <div role="dialog">{children}</div> : null,
  Button: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('../runtime/mcpAccessContext', () => ({
  useMcpAccessRuntime: () => ({
    approvals: testState.approvals,
    mutationKey: testState.mutationKey,
    decideApproval: testState.decideApproval,
    reload: testState.reload,
  }),
}))

import { McpApprovalCoordinator } from './McpApprovalCoordinator'

describe('McpApprovalCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T00:00:00Z'))
    testState.approvals = [approvalFixture('2026-08-13T00:00:02Z')]
    testState.mutationKey = ''
    testState.decideApproval.mockClear()
    testState.reload.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('显示真实倒计时，过期后禁用决定并只触发一次权威刷新', () => {
    const { container } = render(<McpApprovalCoordinator />)
    expect(screen.getByText('settings.mcp.approval.expiresIn:00:02')).toBeInTheDocument()
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(2_000))

    expect(screen.getByText('settings.mcp.approval.expired')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('settings.mcp.approval.expired')
    expect(testState.reload).toHaveBeenCalledTimes(1)
    const approve = screen.getByRole('button', { name: 'settings.mcp.approval.allowOnce' })
    expect(approve).toBeDisabled()
    fireEvent.click(approve)
    expect(testState.decideApproval).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(3_000))
    expect(testState.reload).toHaveBeenCalledTimes(1)
  })

  it('主机密钥确认阻塞期间不展示 MCP 审批', () => {
    render(<McpApprovalCoordinator blocked />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('其他 MCP 管理操作进行时禁用审批决定', () => {
    testState.mutationKey = 'client:client-2'
    render(<McpApprovalCoordinator />)

    expect(screen.getByRole('button', { name: 'settings.mcp.approval.reject' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'settings.mcp.approval.allowOnce' })).toBeDisabled()
  })

  it('在现有审批弹窗中展示 SFTP 上传路径、目标和冲突策略', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'sftp',
      command: '',
      session_ids: [],
      operation: {
        action: 'upload',
        file_session_id: 'file-session-1',
        host_name: '测试主机',
        remote_paths: [],
        remote_target: '/srv/releases',
        local_paths: ['C:\\work\\release.zip'],
        overwrite_policy: 'rename',
        item_count: 1,
        total_bytes: 2048,
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.sftpAction.upload')).toBeInTheDocument()
    expect(screen.getByText('测试主机')).toBeInTheDocument()
    expect(screen.getByText('C:\\work\\release.zip')).toBeInTheDocument()
    expect(screen.getByText('/srv/releases')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.overwrite.rename')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.approval.command')).not.toBeInTheDocument()
  })

  it('将 SFTP 文本保存目标标记为远程路径而不是源路径', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'sftp',
      command: '',
      session_ids: [],
      operation: {
        action: 'save_text',
        file_session_id: 'file-session-1',
        remote_paths: ['/srv/config.ini'],
        local_paths: [],
        item_count: 1,
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.remotePath')).toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.approval.remotePaths')).not.toBeInTheDocument()
  })

  it('在同一审批弹窗中展示远程运维资源、参数和显式停用状态', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'remoteops',
      command: '',
      operation: {
        domain: 'crontab',
        action: 'update',
        resource_id: 'job-1',
        resource_name: '备份任务',
        schedule: '0 2 * * *',
        command: '/usr/local/bin/backup --daily',
        enabled: false,
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText(/settings\.mcp\.approval\.remoteOpsDomain\.crontab/)).toHaveTextContent(
      'settings.mcp.approval.remoteOpsAction.update',
    )
    expect(screen.getByText('备份任务 · job-1')).toBeInTheDocument()
    expect(screen.getByText('0 2 * * *')).toBeInTheDocument()
    expect(screen.getByText('/usr/local/bin/backup --daily')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.disabled')).toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.approval.command')).not.toBeInTheDocument()
  })

  it('在同一审批弹窗中展示端口转发模式、运行方式和路由', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'forwarding',
      command: '',
      session_ids: [],
      operation: {
        action: 'start',
        resource_id: 'profile-1',
        resource_name: '数据库隧道',
        host_name: '测试2',
        mode: 'local',
        lifecycle: 'background_profile',
        bind_address: '127.0.0.1:15432',
        target_address: 'db.internal:5432',
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.forwardingAction.start')).toBeInTheDocument()
    expect(screen.getByText('数据库隧道')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.host')).toBeInTheDocument()
    expect(screen.getByText('测试2')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.forwardingModeValue.local')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.forwardingLifecycleValue.backgroundProfile')).toBeInTheDocument()
    expect(screen.getByText('127.0.0.1:15432')).toBeInTheDocument()
    expect(screen.getByText('db.internal:5432')).toBeInTheDocument()
  })

  it('停止端口转发时将操作对象标记为运行实例而不是转发配置', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'forwarding',
      command: '',
      session_ids: [],
      operation: {
        action: 'stop',
        resource_id: 'forward-1',
        resource_name: '临时转发',
        mode: 'local',
        lifecycle: 'background_once',
        bind_address: '127.0.0.1:18080',
        target_address: '127.0.0.1:8080',
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.forwardingAction.stop')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.resource')).toBeInTheDocument()
    expect(screen.getByText('临时转发')).toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.approval.forwardingProfile')).not.toBeInTheDocument()
  })

  it.each([
    {
      mode: 'remote',
      direction: 'settings.mcp.approval.forwardingDirectionValue.remote',
      bindAddress: '0.0.0.0:18081',
      targetAddress: '127.0.0.1:8081',
    },
    {
      mode: 'dynamic',
      direction: 'settings.mcp.approval.forwardingDirectionValue.dynamic',
      bindAddress: '127.0.0.1:1080',
      targetAddress: '',
    },
  ])('展示 $mode 端口转发的网络方向', ({ mode, direction, bindAddress, targetAddress }) => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'forwarding',
      command: '',
      session_ids: [],
      operation: {
        action: 'start',
        mode,
        lifecycle: 'session',
        bind_address: bindAddress,
        target_address: targetAddress,
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText(`settings.mcp.approval.forwardingModeValue.${mode}`)).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.forwardingDirection')).toBeInTheDocument()
    expect(screen.getByText(direction)).toBeInTheDocument()
    expect(screen.getByText(bindAddress)).toBeInTheDocument()
    if (targetAddress) {
      expect(screen.getByText(targetAddress)).toBeInTheDocument()
    } else {
      expect(screen.queryByText('settings.mcp.approval.targetAddress')).not.toBeInTheDocument()
    }
  })

  it('在同一审批弹窗中展示代码片段内容和归属信息', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'snippet',
      command: '',
      session_ids: [],
      operation: {
        action: 'update',
        resource_id: 'snippet-1',
        resource_name: '查看端口',
        group_name: '诊断',
        shell: 'bash',
        description: '查看监听端口',
        tags: ['network', 'diagnostics'],
        command: 'ss -lntp',
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.snippetAction.update')).toBeInTheDocument()
    expect(screen.getByText('查看端口')).toBeInTheDocument()
    expect(screen.getByText('诊断')).toBeInTheDocument()
    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.getByText('network, diagnostics')).toBeInTheDocument()
    expect(screen.getByText('查看监听端口')).toBeInTheDocument()
    expect(screen.getByText('ss -lntp')).toBeInTheDocument()
  })

  it('删除代码片段分组时展示分组标签和保留片段的影响说明', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'snippet',
      command: '',
      session_ids: [],
      operation: {
        action: 'group_delete',
        resource_id: 'group-1',
        group_name: '临时诊断',
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.snippetAction.groupDelete')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.snippetGroup')).toBeInTheDocument()
    expect(screen.getByText('临时诊断')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.impact')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.snippetGroupDeleteImpact')).toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.approval.snippet')).not.toBeInTheDocument()
  })

  it('修改代码片段分组名称时同时展示当前名称和新名称', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'snippet',
      command: '',
      session_ids: [],
      operation: {
        action: 'group_update',
        resource_id: 'group-1',
        resource_name: '旧分组',
        group_name: '新分组',
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.currentSnippetGroup')).toBeInTheDocument()
    expect(screen.getByText('旧分组')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.newSnippetGroupName')).toBeInTheDocument()
    expect(screen.getByText('新分组')).toBeInTheDocument()
  })

  it('分组名称未变化时只展示一次分组信息', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'snippet',
      command: '',
      session_ids: [],
      operation: {
        action: 'group_update',
        resource_id: 'group-1',
        resource_name: '诊断',
        group_name: '诊断',
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.snippetGroup')).toBeInTheDocument()
    expect(screen.getByText('诊断')).toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.approval.currentSnippetGroup')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.mcp.approval.newSnippetGroupName')).not.toBeInTheDocument()
  })

  it('调整代码片段分组顺序时展示完整项目数量', () => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'snippet',
      command: '',
      session_ids: [],
      operation: {
        action: 'groups_reorder',
        item_count: 4,
        remote_paths: [],
        local_paths: [],
      },
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText('settings.mcp.approval.snippetAction.groupsReorder')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.itemCount')).toBeInTheDocument()
    expect(screen.getByText('settings.mcp.approval.itemCountValue:4')).toBeInTheDocument()
  })

  it.each<{
    name: string
    operation: McpApprovalOperation
    headline: RegExp
    details: string[]
  }>([
    {
      name: '进程终止',
      operation: {
        domain: 'processes', action: 'terminate', resource_id: '1234', resource_name: 'nginx',
        signal: 'kill', remote_paths: [], local_paths: [],
      },
      headline: /remoteOpsDomain\.processes.*remoteOpsAction\.terminate/,
      details: ['nginx · 1234', 'kill'],
    },
    {
      name: 'Docker 重启',
      operation: {
        domain: 'docker', action: 'restart', resource_id: 'container-123', resource_name: 'api',
        timeout_seconds: 1, remote_paths: [], local_paths: [],
      },
      headline: /remoteOpsDomain\.docker.*remoteOpsAction\.restart/,
      details: ['api · container-123', 'settings.mcp.approval.timeoutSeconds:1'],
    },
    {
      name: 'systemd 屏蔽',
      operation: {
        domain: 'services', action: 'mask', resource_id: 'nginx.service',
        remote_paths: [], local_paths: [],
      },
      headline: /remoteOpsDomain\.services.*remoteOpsAction\.mask/,
      details: ['nginx.service'],
    },
  ])('展示$name审批摘要', ({ operation, headline, details }) => {
    testState.approvals = [{
      ...approvalFixture('2026-08-13T00:00:30Z'),
      kind: 'remoteops',
      command: '',
      operation,
    }]

    render(<McpApprovalCoordinator />)

    expect(screen.getByText(headline)).toBeInTheDocument()
    for (const detail of details) {
      expect(screen.getByText(detail)).toBeInTheDocument()
    }
  })
})

function approvalFixture(expiresAt: string): McpApproval {
  return {
    id: 'approval-1',
    revision: 3,
    client_id: 'client-1',
    client_name: 'Codex',
    client_request_id: 'request-1',
    kind: 'command',
    command: 'uname -s',
    session_ids: ['session-1'],
    targets: [],
    state: 'pending',
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    expires_at: expiresAt,
  }
}
