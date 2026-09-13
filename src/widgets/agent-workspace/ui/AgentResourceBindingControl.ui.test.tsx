import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceResourceContext } from '../model/types.ts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}))

vi.mock('antd', () => ({
  Button: ({ children, disabled, onClick }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  Tooltip: ({ children, title, open, classNames, destroyOnHidden, onOpenChange }: {
    children: ReactNode
    title?: ReactNode
    open?: boolean
    classNames?: { root?: string }
    destroyOnHidden?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    const [innerOpen, setInnerOpen] = useState(false)
    const visible = open ?? innerOpen
    const changeOpen = (nextOpen: boolean) => {
      setInnerOpen(nextOpen)
      onOpenChange?.(nextOpen)
    }
    return (
      <div
        data-testid="resource-tooltip-trigger"
        data-tooltip-controlled={String(open !== undefined)}
        data-tooltip-destroy-on-hidden={String(destroyOnHidden)}
        data-tooltip-root-class={classNames?.root}
        onMouseEnter={() => changeOpen(true)}
        onMouseLeave={() => changeOpen(false)}
      >
        {children}
        {visible ? <div role="tooltip">{title}</div> : null}
      </div>
    )
  },
  Select: ({ options, disabled, onChange }: {
    options: Array<{ value: string; label: string }>
    disabled?: boolean
    onChange: (value: string) => void
  }) => <div>{options.map((option) => (
    <button key={option.value} type="button" disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>
  ))}</div>,
}))

vi.mock('#shared/ui', () => ({
  ConnectionActionButton: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
  FilterPopover: ({ children, content, open, destroyOnHidden, onOpenChange }: {
    children: ReactNode
    content: ReactNode
    open: boolean
    destroyOnHidden?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <div
      data-shared-filter-popover="true"
      data-popover-destroy-on-hidden={String(destroyOnHidden)}
    >
      <div data-testid="resource-popover-trigger" onClick={() => onOpenChange?.(!open)}>{children}</div>
      {open ? <div data-testid="resource-popover-content">{content}</div> : null}
    </div>
  ),
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => (
    open ? <button type="button" onClick={onConfirm}>confirm-detach</button> : null
  ),
  uiStyles: { tooltip: 'shared-tooltip' },
}))

import { AgentResourceBindingControl } from './AgentResourceBindingControl.tsx'

describe('Agent SSH 资源绑定控件', () => {
  it.each([undefined, 'AGENT_RESOURCE_RECOVERY_QUERY_FAILED'])('恢复成功且连接就绪后保持收起，不因后续查询错误重开：%s', (errorCode) => {
    const context = resourceContext()
    render(<AgentResourceBindingControl disabled={false} onReplace={vi.fn()} onRemove={vi.fn()}
      onRecover={vi.fn()} onCancelRecovery={vi.fn()} context={{ ...context, recovery: {
        checking: false, submitting: false, uncertain: false, error_code: errorCode,
        view: { instance_id: 'core', kind: 'ssh_session', can_recover: false, blocked_reason: 'ready', operation: {
          id: 'recovery', instance_id: 'core', session_id: 'agent', kind: 'ssh_session', client_request_id: 'request',
          revision: 3, status: 'succeeded', source_binding: context.binding as Extract<typeof context.binding, { kind: 'ssh_session' }>,
          retryable: false, created_at: context.binding.bound_at, updated_at: context.binding.bound_at,
        } },
      } }} />)
    const chip = screen.getByRole('button', { name: /agent.resource.aria/ })
    fireEvent.click(chip)
    expect(screen.queryByText('agent.resource.recovery.title')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.resource.replace' })).toBeInTheDocument()
    fireEvent.click(chip)
    fireEvent.click(chip)
    expect(screen.queryByLabelText('agent.resource.recovery.details')).not.toBeInTheDocument()
  })

  it('恢复后的连接再次失效时不继续显示成功说明', () => {
    const context = resourceContext()
    const props = { disabled: false, onReplace: vi.fn(), onRemove: vi.fn(), onRecover: vi.fn(), onCancelRecovery: vi.fn() }
    render(<AgentResourceBindingControl {...props} context={{ ...context, status: 'stale', recovery: {
      checking: false, submitting: false, uncertain: false,
      view: { instance_id: 'core', kind: 'ssh_session', can_recover: true, operation: {
        id: 'recovery', instance_id: 'core', session_id: 'agent', kind: 'ssh_session', client_request_id: 'request',
        revision: 3, status: 'succeeded', source_binding: context.binding as Extract<typeof context.binding, { kind: 'ssh_session' }>,
        retryable: false, created_at: context.binding.bound_at, updated_at: context.binding.bound_at,
      } },
    } }} />)
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    expect(screen.queryByText('agent.resource.hint.stale')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('agent.resource.recovery.description')
    expect(screen.getByRole('button', { name: 'agent.resource.recovery.recover' })).toBeEnabled()
  })

  it('普通替换因待派发队列禁用时仍可单独恢复，并提供取消连接操作', async () => {
    const context = resourceContext()
    const recover = vi.fn().mockResolvedValue(true)
    const cancel = vi.fn().mockResolvedValue(true)
    const state = { checking: false, submitting: false, uncertain: false,
      view: { instance_id: 'core', kind: 'ssh_session' as const, can_recover: true, operation: null } }
    const props = { disabled: true, recoveryDisabled: false, onReplace: vi.fn(), onRemove: vi.fn(), onRecover: recover, onCancelRecovery: cancel }
    const view = render(<AgentResourceBindingControl {...props} context={{ ...context, status: 'stale', recovery: state }} />)
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    expect(screen.getByRole('button', { name: 'agent.resource.replace' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.recovery.recover' }))
    await waitFor(() => expect(recover).toHaveBeenCalledOnce())
    view.rerender(<AgentResourceBindingControl {...props} context={{ ...context, status: 'stale', recovery: { ...state, view: {
      ...state.view, can_recover: false, blocked_reason: 'recovering', operation: {
        id: 'recovery', instance_id: 'core', session_id: 'agent', kind: 'ssh_session', client_request_id: 'request',
        revision: 1, status: 'waiting_host_trust', source_binding: context.binding as Extract<typeof context.binding, { kind: 'ssh_session' }>,
        retryable: true, created_at: context.binding.bound_at, updated_at: context.binding.bound_at,
      },
    } } }} />)
    expect(screen.getByText('agent.resource.recovery.status.waiting_host_trust')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.recovery.cancel' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('恢复查询失败可重试，任务锁定时不能恢复', () => {
    const props = { disabled: false, recoveryDisabled: true, onReplace: vi.fn(), onRemove: vi.fn(), onRecover: vi.fn(), onCancelRecovery: vi.fn() }
    const view = render(<AgentResourceBindingControl {...props} context={{ ...resourceContext(), status: 'stale', recovery: {
      checking: false, submitting: false, uncertain: false, error_code: 'AGENT_RESOURCE_RECOVERY_QUERY_FAILED',
    } }} />)
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    expect(screen.getByRole('button', { name: 'agent.resource.recovery.retry' })).toBeDisabled()
    view.rerender(<AgentResourceBindingControl {...props} recoveryDisabled={false} context={{ ...resourceContext(), status: 'stale', recovery: {
      checking: false, submitting: false, uncertain: false, error_code: 'AGENT_RESOURCE_RECOVERY_QUERY_FAILED',
    } }} />)
    expect(screen.getByRole('button', { name: 'agent.resource.recovery.retry' })).toBeEnabled()
  })

  it.each(['stale', 'ready'] as const)('取消时连接清理失败仍展示诊断，当前连接状态=%s', (status) => {
    const context = resourceContext()
    render(<AgentResourceBindingControl disabled={false} onReplace={vi.fn()} onRemove={vi.fn()}
      onRecover={vi.fn()} onCancelRecovery={vi.fn()} context={{ ...context, status, recovery: {
        checking: false, submitting: false, uncertain: false, view: {
          instance_id: 'core', kind: 'ssh_session', can_recover: status !== 'ready', blocked_reason: status === 'ready' ? 'ready' : undefined, operation: {
            id: 'recovery', instance_id: 'core', session_id: 'agent', kind: 'ssh_session', client_request_id: 'request',
            revision: 3, status: 'cancelled', source_binding: context.binding as Extract<typeof context.binding, { kind: 'ssh_session' }>,
            retryable: true, created_at: context.binding.bound_at, updated_at: context.binding.bound_at,
            error_code: 'CLEANUP_FAILED', message: '已取消，但连接清理失败，请重试。',
          },
        },
      } }} />)
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    expect(screen.getByText('已取消，但连接清理失败，请重试。')).toBeInTheDocument()
    expect(screen.queryByText('agent.resource.recovery.status.cancelled')).not.toBeInTheDocument()
  })

  it('常驻展示状态并通过显式选择完成重绑与解除', async () => {
    const replace = vi.fn().mockResolvedValue(true)
    const remove = vi.fn().mockResolvedValue(true)
    render(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled={false}
        onReplace={replace}
        onRemove={remove}
      />,
    )

    expect(screen.getByRole('button', { name: /agent.resource.aria/ }))
      .toHaveAttribute('data-resource-status', 'ready')
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.replace' }))
    fireEvent.click(screen.getByRole('button', { name: /Fallback/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.confirmReplace' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ kind: 'ssh_session', session_id: 'ses-two' }))

    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'confirm-detach' }))
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
  })

  it('文件控件仅选择文件 Profile 并复用替换与解绑交互', async () => {
    const replace = vi.fn().mockResolvedValue(true)
    const remove = vi.fn().mockResolvedValue(true)
    render(<AgentResourceBindingControl disabled={false} onReplace={replace} onRemove={remove}
      context={{
        binding: {
          kind: 'file_profile', file_access_profile_id: 'file-one', file_access_profile_name: '应用文件',
          host_id: 'host-one', ssh_profile_id: 'ssh-one', host_name: 'Production', engine: 'sftp',
          bound_at: '2026-08-31T08:00:00Z',
        },
        status: 'ready',
        candidates: [...resourceContext().candidates, {
          file_access_profile_id: 'file-two', file_access_profile_name: '归档文件', engine: 'sftp',
          host_id: 'host-two', ssh_profile_id: 'ssh-two', host_name: 'Archive', status: 'ready',
        }],
      }} />)

    fireEvent.click(screen.getByRole('button', { name: /agent.fileResource.aria/ }))
    expect(screen.getByRole('group', { name: 'agent.fileResource.details' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.replace' }))
    expect(screen.queryByRole('button', { name: /Fallback/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Archive/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.confirmReplace' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ kind: 'file_profile', file_access_profile_id: 'file-two' }))
    fireEvent.click(screen.getByRole('button', { name: /agent.fileResource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'confirm-detach' }))
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
  })

  it.each([
    ['on_demand', 'agent.sshProfileResource.confirmReplaceOnDemand'],
    ['immediate', 'agent.sshProfileResource.confirmReplaceImmediate'],
  ] as const)('SSH Profile 标签保持简洁并使用 %s 更换行为', async (
    associationMode,
    confirmCopy,
  ) => {
    const replace = vi.fn().mockResolvedValue(true)
    const binding = {
      kind: 'ssh_profile' as const,
      ssh_profile_id: 'ssh-one',
      ssh_profile_name: '默认配置',
      host_id: 'host-one',
      host_name: 'Production',
      platform: 'linux' as const,
      bound_at: '2026-08-31T08:00:00Z',
    }
    render(<AgentResourceBindingControl disabled={false} onReplace={replace} onRemove={vi.fn()}
      sshProfileAssociationMode={associationMode}
      onRecover={vi.fn()} onCancelRecovery={vi.fn()} context={{
        binding,
        status: 'ready',
        live_resource: { ...binding, status: 'ready' },
        candidates: [{
          host_id: 'host-two', host_name: 'Fallback', ssh_profile_id: 'ssh-two',
          ssh_profile_name: '备用配置', platform: 'linux', status: 'ready',
        }],
      }} />)

    const chip = screen.getByRole('button', { name: /agent.sshProfileResource.aria/ })
    expect(chip).toHaveAttribute('data-resource-kind', 'ssh_profile')
    expect(chip).toHaveTextContent('Production')
    expect(chip).not.toHaveTextContent('agent.sshProfileResource.onDemand')
    expect(chip.querySelector('small')).not.toBeInTheDocument()
    expect(chip.querySelector('i')).not.toBeInTheDocument()
    expect(chip.querySelector('.lucide-server-cog')).toBeInTheDocument()
    fireEvent.click(chip)
    expect(screen.getByRole('group', { name: 'agent.sshProfileResource.details' })).toBeInTheDocument()
    expect(screen.getByText('默认配置')).toBeInTheDocument()
    expect(screen.queryByText('agent.sshProfileResource.connectionMode')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.sshProfileResource.onDemand')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.resource.session')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.resource.recovery.title')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'agent.sshProfileResource.replace' }))
    expect(screen.getByRole('button', { name: confirmCopy })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Fallback.*备用配置/ }))
    fireEvent.click(screen.getByRole('button', { name: confirmCopy }))
    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith({
      kind: 'ssh_profile', ssh_profile_id: 'ssh-two',
    }))
  })

  it('相同文件 Profile 的关联身份变化后仍可显式重新绑定，确认前身份再变则清除选择', async () => {
    const replace = vi.fn().mockResolvedValue(true)
    const remove = vi.fn().mockResolvedValue(true)
    const binding = {
      kind: 'file_profile' as const, file_access_profile_id: 'file-one', file_access_profile_name: '应用文件',
      host_id: 'host-one', ssh_profile_id: 'ssh-old', host_name: 'Production', engine: 'sftp' as const,
      bound_at: '2026-08-31T08:00:00Z',
    }
    const candidate = { ...binding, ssh_profile_id: 'ssh-new', status: 'ready' as const }
    const props = { disabled: false, onReplace: replace, onRemove: remove }
    const view = render(<AgentResourceBindingControl {...props}
      context={{ binding, status: 'stale', candidates: [candidate] }} />)
    fireEvent.click(screen.getByRole('button', { name: /agent.fileResource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.replace' }))
    fireEvent.click(screen.getByRole('button', { name: /Production.*应用文件/ }))
    expect(screen.getByRole('button', { name: 'agent.resource.confirmReplace' })).toBeEnabled()

    view.rerender(<AgentResourceBindingControl {...props}
      context={{ binding, status: 'stale', candidates: [{ ...candidate, ssh_profile_id: 'ssh-third' }] }} />)
    expect(screen.getByRole('button', { name: 'agent.resource.confirmReplace' })).toBeDisabled()
    expect(replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Production.*应用文件/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.confirmReplace' }))
    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith({ kind: 'file_profile', file_access_profile_id: 'file-one' }))
  })

  it('失效状态仍展示引用且活动任务期间禁止修改', () => {
    render(
      <AgentResourceBindingControl
        context={{ ...resourceContext(), status: 'stale' }}
        disabled
        onReplace={vi.fn().mockResolvedValue(false)}
        onRemove={vi.fn().mockResolvedValue(false)}
      />,
    )
    expect(screen.getByRole('button', { name: /agent.resource.aria/ }))
      .toHaveAttribute('data-resource-status', 'stale')
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    expect(screen.getByRole('button', { name: 'agent.resource.replace' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.resource.remove' })).toBeDisabled()
  })

  it('解除引用失败时保留确认状态以便重试', async () => {
    const remove = vi.fn().mockResolvedValue(false)
    render(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled={false}
        onReplace={vi.fn().mockResolvedValue(false)}
        onRemove={remove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.remove' }))
    expect(screen.queryByTestId('resource-popover-content')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'confirm-detach' }))
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'confirm-detach' })).toBeInTheDocument()
  })

  it('候选会话在确认前失效时清除选择并阻止提交', async () => {
    const replace = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled={false}
        onReplace={replace}
        onRemove={vi.fn().mockResolvedValue(true)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.replace' }))
    fireEvent.click(screen.getByRole('button', { name: /Fallback/ }))

    rerender(
      <AgentResourceBindingControl
        context={{ ...resourceContext(), candidates: [] }}
        disabled={false}
        onReplace={replace}
        onRemove={vi.fn().mockResolvedValue(true)}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'agent.resource.confirmReplace' })
    await waitFor(() => expect(confirm).toBeDisabled())
    fireEvent.click(confirm)
    expect(replace).not.toHaveBeenCalled()
  })

  it('活动任务开始时收口已打开的重绑编辑和解绑确认', async () => {
    const replace = vi.fn().mockResolvedValue(true)
    const remove = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled={false}
        onReplace={replace}
        onRemove={remove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.replace' }))
    fireEvent.click(screen.getByRole('button', { name: /Fallback/ }))

    rerender(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled
        onReplace={replace}
        onRemove={remove}
      />,
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'agent.resource.confirmReplace' }))
        .not.toBeInTheDocument()
    })
    expect(replace).not.toHaveBeenCalled()

    rerender(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled={false}
        onReplace={replace}
        onRemove={remove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.remove' }))
    expect(screen.getByRole('button', { name: 'confirm-detach' })).toBeInTheDocument()

    rerender(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled
        onReplace={replace}
        onRemove={remove}
      />,
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: 'confirm-detach' }))
      .not.toBeInTheDocument())
    expect(remove).not.toHaveBeenCalled()

    rerender(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled={false}
        onReplace={replace}
        onRemove={remove}
      />,
    )
    expect(screen.queryByRole('button', { name: 'confirm-detach' })).not.toBeInTheDocument()
  })

  it('关闭详情浮层后不会恢复旧的 hover 提示状态', () => {
    render(
      <AgentResourceBindingControl
        context={resourceContext()}
        disabled={false}
        onReplace={vi.fn().mockResolvedValue(true)}
        onRemove={vi.fn().mockResolvedValue(true)}
      />,
    )

    const chip = screen.getByRole('button', { name: /agent.resource.aria/ })
    fireEvent.mouseEnter(chip)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.click(chip)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByTestId('resource-popover-content')).toBeInTheDocument()

    fireEvent.click(chip)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resource-popover-content')).not.toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByTestId('resource-tooltip-trigger'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByTestId('resource-tooltip-trigger'))
      .toHaveAttribute('data-tooltip-controlled', 'true')
    expect(screen.getByTestId('resource-tooltip-trigger'))
      .toHaveAttribute('data-tooltip-destroy-on-hidden', 'true')
    expect(screen.getByTestId('resource-tooltip-trigger'))
      .toHaveAttribute('data-tooltip-root-class', 'shared-tooltip termous-tooltip')
    expect(screen.getByTestId('resource-popover-trigger').parentElement)
      .toHaveAttribute('data-popover-destroy-on-hidden', 'true')
    expect(screen.getByTestId('resource-popover-trigger').parentElement)
      .toHaveAttribute('data-shared-filter-popover', 'true')

    fireEvent.mouseLeave(chip)
    fireEvent.mouseEnter(chip)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
})

function resourceContext(): AgentWorkspaceResourceContext {
  return {
    binding: {
      kind: 'ssh_session',
      session_id: 'ses-one',
      host_id: 'host-one',
      ssh_profile_id: 'ssh-one',
      host_name: 'Production',
      platform: 'linux',
      bound_at: '2026-08-31T08:00:00Z',
    },
    status: 'ready',
    candidates: [{
      session_id: 'ses-two',
      host_id: 'host-two',
      ssh_profile_id: 'ssh-two',
      host_name: 'Fallback',
      ssh_profile_name: 'Primary',
      status: 'ready',
      started_at: '2026-08-31T09:00:00Z',
    }],
  }
}
