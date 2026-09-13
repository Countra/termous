import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentResourceConnectionOperation } from '#entities/agent'
import { AgentProfileConnectionStatus } from './AgentProfileConnectionStatus.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('Agent Profile 临时连接状态', () => {
  it.each(['connecting', 'waiting_host_trust'] as const)('活动状态 %s 可取消', async (status) => {
    const onCancel = vi.fn(async () => true)
    renderStatus({ operation: connectionOperation({ status }), checking: false, submitting: false,
      uncertain: false, reconciling: false }, { onCancel })
    expect(screen.getByRole('status')).toHaveTextContent(`agent.slash.connection.status.${status}`)
    fireEvent.click(screen.getByRole('button', { name: 'agent.slash.connection.cancel' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })

  it('失败状态提供重试和关闭，未知错误码回退后端脱敏消息', async () => {
    const onRetry = vi.fn(async () => true)
    const onDismiss = vi.fn()
    renderStatus({ operation: connectionOperation({ status: 'failed', error_code: 'UNKNOWN_ERROR', message: '连接超时，请重试。' }),
      checking: false, submitting: false, uncertain: false, reconciling: false }, { onRetry, onDismiss })
    expect(screen.getByRole('status')).toHaveTextContent('连接超时，请重试。')
    fireEvent.click(screen.getByRole('button', { name: 'agent.slash.connection.retry' }))
    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'agent.slash.connection.dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('已知错误码优先使用当前语言文案', () => {
    renderStatus({ operation: connectionOperation({
      status: 'failed', error_code: 'SSH_AUTH_FAILED', message: '后端返回的脱敏消息',
    }), checking: false, submitting: false, uncertain: false, reconciling: false })
    expect(screen.getByRole('status')).toHaveTextContent('agent.slash.connection.error.SSH_AUTH_FAILED')
    expect(screen.getByRole('status')).not.toHaveTextContent('后端返回的脱敏消息')
  })

  it.each(['succeeded', 'cancelled'] as const)('终态 %s 不常驻输入区', (status) => {
    renderStatus({ operation: connectionOperation({ status }), checking: false, submitting: false,
      uncertain: false, reconciling: false })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('成功结果与绑定快照对账期间继续展示同步状态', () => {
    renderStatus({ operation: connectionOperation({ status: 'succeeded' }), checking: false, submitting: false,
      uncertain: false, reconciling: true })
    expect(screen.getByRole('status')).toHaveTextContent('agent.slash.connection.status.succeeded')
  })

  it('状态不确定时只等待对账，不提供可能重放请求的重试操作', () => {
    renderStatus({ operation: connectionOperation(), checking: false, submitting: false,
      uncertain: true, reconciling: false }, { onRetry: vi.fn(async () => true) })
    expect(screen.getByRole('status')).toHaveTextContent('agent.slash.connection.uncertain')
    expect(screen.queryByRole('button', { name: 'agent.slash.connection.retry' })).not.toBeInTheDocument()
  })

  it('状态不确定且尚未查到操作时允许安全重放 pending 请求', async () => {
    const onRetry = vi.fn(async () => true)
    renderStatus({ operation: null, checking: false, submitting: false,
      uncertain: true, reconciling: false }, { onRetry })
    fireEvent.click(screen.getByRole('button', { name: 'agent.slash.connection.retry' }))
    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce())
  })

  it('没有操作的确定错误不显示无效重试按钮', () => {
    renderStatus({ operation: null, checking: false, submitting: false,
      uncertain: false, reconciling: false, error_code: 'AGENT_RESOURCE_CONNECTION_FAILED' }, {
      onRetry: vi.fn(async () => true),
    })
    expect(screen.queryByRole('button', { name: 'agent.slash.connection.retry' })).not.toBeInTheDocument()
  })

  it('后台初次查询且尚无连接操作时不占用输入区', () => {
    renderStatus({ operation: null, checking: true, submitting: false,
      uncertain: false, reconciling: false })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

function renderStatus(
  state: Parameters<typeof AgentProfileConnectionStatus>[0]['state'],
  actions: Pick<Parameters<typeof AgentProfileConnectionStatus>[0], 'onRetry' | 'onCancel' | 'onDismiss'> = {},
) {
  return render(<AntdApp><AgentProfileConnectionStatus state={state} {...actions} /></AntdApp>)
}

function connectionOperation(
  overrides: Partial<AgentResourceConnectionOperation> = {},
): AgentResourceConnectionOperation {
  return {
    id: 'operation-one', instance_id: 'core-one', session_id: 'agent-one', kind: 'ssh_session',
    client_request_id: 'request-one', revision: 1, status: 'connecting',
    target: { host_id: 'host-one', host_name: 'Production', ssh_profile_id: 'profile-one',
      profile_name: 'Primary', platform: 'linux' },
    source_binding: null, retryable: true,
    created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z',
    ...overrides,
  }
}
