import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpApproval } from '#entities/mcp-access'

const testState = vi.hoisted(() => ({
  approvals: [] as McpApproval[],
  mutationKey: '',
  decideApproval: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { time?: string }) => values?.time ? `${key}:${values.time}` : key,
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
