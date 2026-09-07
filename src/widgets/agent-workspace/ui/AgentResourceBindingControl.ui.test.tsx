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
    await waitFor(() => expect(replace).toHaveBeenCalledWith('ses-two'))

    fireEvent.click(screen.getByRole('button', { name: /agent.resource.aria/ }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.resource.remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'confirm-detach' }))
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
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
