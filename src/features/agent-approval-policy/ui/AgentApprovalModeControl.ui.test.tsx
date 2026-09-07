import { App as AntdApp } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentApprovalMode, AgentApprovalPolicyState } from '../model/approvalMode.ts'
import { AgentApprovalModeControl } from './AgentApprovalModeControl.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

interface ControlProps {
  policy: AgentApprovalPolicyState
  disabled: boolean
  onChange: (mode: AgentApprovalMode) => Promise<void>
}

function controlProps(overrides: Partial<ControlProps> = {}): ControlProps {
  return {
    policy: { status: 'ready', mode: 'review' },
    disabled: false,
    onChange: vi.fn(async () => undefined),
    ...overrides,
  }
}

function control(props: ControlProps) {
  return <AntdApp><AgentApprovalModeControl {...props} /></AntdApp>
}

function renderControl(overrides: Partial<ControlProps> = {}) {
  const props = controlProps(overrides)
  return { props, ...render(control(props)) }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('AgentApprovalModeControl', () => {
  it('禁用时关闭尚未确认的高风险策略选择', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(async () => undefined)
    const view = renderControl({ onChange })
    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.label' }))
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ }))
    expect(screen.getByText('agent.approvalMode.confirmBypassTitle')).toBeInTheDocument()

    view.rerender(control(controlProps({ disabled: true, onChange })))
    expect(screen.getByRole('button', { name: 'agent.approvalMode.label' })).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('策略不可用时展示明确状态并禁止打开菜单', async () => {
    const user = userEvent.setup()
    renderControl({ policy: { status: 'unavailable' } })

    const trigger = screen.getByRole('button', { name: 'agent.approvalMode.label' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveTextContent('agent.approvalMode.unavailable')
    await user.click(trigger)
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })

  it('取消无需确认的二次确认后将焦点还给触发器', async () => {
    const user = userEvent.setup()
    renderControl()
    const trigger = screen.getByRole('button', { name: 'agent.approvalMode.label' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ }))
    await user.click(screen.getByRole('button', { name: 'app.cancel' }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('保存失败时保留确认窗口并允许重试', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
      .mockRejectedValueOnce(new Error('update failed'))
      .mockResolvedValueOnce(undefined)
    renderControl({ onChange })

    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.label' }))
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ }))
    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.confirmBypass' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(screen.getByText('agent.approvalMode.confirmBypassTitle')).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: /agent\.approvalMode\.confirmBypass/ })
    await waitFor(() => expect(retry).not.toBeDisabled())
    await user.click(retry)
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
  })

  it('保存失败且期间被禁用后不恢复过期确认窗口', async () => {
    const user = userEvent.setup()
    const request = deferred<void>()
    const onChange = vi.fn(() => request.promise)
    const view = renderControl({ onChange })

    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.label' }))
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ }))
    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.confirmBypass' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce())

    view.rerender(control(controlProps({ disabled: true, onChange })))
    await act(async () => {
      request.reject(new Error('update failed'))
      await request.promise.catch(() => undefined)
    })
    view.rerender(control(controlProps({ onChange })))

    expect(screen.getByRole('button', { name: 'agent.approvalMode.label' })).not.toBeDisabled()
    expect(screen.queryByRole('button', {
      name: 'agent.approvalMode.confirmBypass',
    })).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('权威策略在其他入口更新时关闭过期确认窗口', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(async () => undefined)
    const view = renderControl({ onChange })
    const trigger = screen.getByRole('button', { name: 'agent.approvalMode.label' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ }))

    view.rerender(control(controlProps({
      policy: { status: 'ready', mode: 'bypass' },
      onChange,
    })))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('策略已写入但响应失败时在对账完成后恢复触发器焦点', async () => {
    const user = userEvent.setup()
    const request = deferred<void>()
    const onChange = vi.fn(() => request.promise)
    const view = renderControl({ onChange })
    const trigger = screen.getByRole('button', { name: 'agent.approvalMode.label' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ }))
    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.confirmBypass' }))

    view.rerender(control(controlProps({
      policy: { status: 'ready', mode: 'bypass' },
      onChange,
    })))
    await act(async () => {
      request.reject(new Error('response lost'))
      await request.promise.catch(() => undefined)
    })

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('菜单支持方向键选择并保持单选语义', async () => {
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.label' }))
    expect(screen.getByRole('menu', { name: 'agent.approvalMode.title' })).toBeInTheDocument()
    const review = screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.review/ })
    const bypass = screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ })
    await waitFor(() => expect(review).toHaveFocus())
    fireEvent.keyDown(review, { key: 'ArrowDown' })
    expect(bypass).toHaveFocus()
    expect(review).toHaveAttribute('tabindex', '-1')
    expect(bypass).toHaveAttribute('tabindex', '0')
    await user.keyboard('{Enter}')
    expect(screen.getByText('agent.approvalMode.confirmBypassTitle')).toBeInTheDocument()
  })

  it('从方向键移动后的选项反向退出菜单时不重复经过旧选中项', async () => {
    const user = userEvent.setup()
    renderControl()
    const trigger = screen.getByRole('button', { name: 'agent.approvalMode.label' })

    await user.click(trigger)
    const review = screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.review/ })
    const bypass = screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ })
    await waitFor(() => expect(review).toHaveFocus())
    fireEvent.keyDown(review, { key: 'ArrowDown' })
    expect(bypass).toHaveFocus()
    await user.tab({ shift: true })

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    await waitFor(() => expect(review).toHaveFocus())
    expect(review).toHaveAttribute('tabindex', '0')
    expect(bypass).toHaveAttribute('tabindex', '-1')
  })

  it('键盘焦点离开菜单时关闭弹层', async () => {
    const user = userEvent.setup()
    renderControl()
    const trigger = screen.getByRole('button', { name: 'agent.approvalMode.label' })

    await user.click(trigger)
    const review = screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.review/ })
    await waitFor(() => expect(review).toHaveFocus())
    await user.tab()

    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  })

  it('从无需确认切回逐次审批时直接保存', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(async () => undefined)
    renderControl({
      policy: { status: 'ready', mode: 'bypass' },
      onChange,
    })

    await user.click(screen.getByRole('button', { name: 'agent.approvalMode.label' }))
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.review/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('review'))
    expect(screen.queryByText('agent.approvalMode.confirmBypassTitle')).not.toBeInTheDocument()
  })
})
