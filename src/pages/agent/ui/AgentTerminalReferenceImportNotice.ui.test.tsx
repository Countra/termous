import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentTerminalReferenceImportJob } from '#features/agent-runtime'
import { AgentTerminalReferenceImportNotice } from './AgentTerminalReferenceImportNotice'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function job(stage: AgentTerminalReferenceImportJob['stage'], key = 1): AgentTerminalReferenceImportJob {
  return {
    stage, errorCode: 'unavailable',
    request: {
      key, source: 'terminal_selection', target: { kind: 'new' }, text: 'selected text',
      origin: { kind: 'terminal_selection', source_session_id: 'ssh-source', host_name: '生产主机',
        captured_at: '2026-09-09T08:00:00Z', line_count: 1 },
      resource_reference: { kind: 'ssh_session', session_id: 'ssh-source' },
      source_resource: { session_id: 'ssh-source', host_id: 'host-source', host_name: '生产主机',
        ssh_profile_id: 'profile-source', ssh_profile_name: 'SSH', status: 'ready', started_at: '2026-09-09T08:00:00Z' },
    },
  }
}

function fixture(initial: AgentTerminalReferenceImportJob) {
  const actions = { onConfirm: vi.fn(), onRetry: vi.fn(), onDismiss: vi.fn(), onOpenSettings: vi.fn() }
  const content = (current?: AgentTerminalReferenceImportJob, visible = true) => (
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AntdApp notification={{ placement: 'bottomRight', duration: 0.01, showProgress: true }}>
        {visible ? <AgentTerminalReferenceImportNotice job={current} resources={[]} {...actions} /> : null}
      </AntdApp>
    </ConfigProvider>
  )
  const view = render(content(initial))
  return { ...actions, ...view, update: (current?: AgentTerminalReferenceImportJob, visible = true) => view.rerender(content(current, visible)) }
}

describe('终端引用状态通知', () => {
  it('准备和导入期间不显示通知，仅在失败后于右上角提供重试入口', async () => {
    const user = userEvent.setup()
    const f = fixture(job('pending'))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
    expect(document.querySelector('.ant-notification-notice')).toBeNull()

    f.update(job('importing'))
    expect(document.querySelector('.ant-notification-notice')).toBeNull()
    f.update(job('failed'))
    const failed = await screen.findByText('agent.terminalReference.failed')
    expect(failed.closest('.ant-notification-topRight')).not.toBeNull()
    expect(document.querySelector('.ant-notification-bottomRight')).toBeNull()
    expect(document.querySelectorAll('.ant-notification-notice')).toHaveLength(1)
    expect(screen.getByText('agent.terminalReference.errors.unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'app.retry' }))
    expect(f.onRetry).toHaveBeenCalledOnce()

    f.update()
    await waitFor(() => expect(screen.queryByText('agent.terminalReference.failed')).not.toBeInTheDocument())
    expect(f.onDismiss).not.toHaveBeenCalled()
  })

  it.each(['pending', 'importing'] as const)('从 %s 完成后提示两秒，重渲染不会延长计时', async (stage) => {
    vi.useFakeTimers()
    const f = fixture(job(stage))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(document.querySelector('.ant-notification-notice')).toBeNull()

    f.update()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.getByText('agent.terminalReference.completed')).toBeInTheDocument()
    expect(screen.getByText('agent.terminalReference.completedDescription')).toBeInTheDocument()
    expect(document.querySelectorAll('.ant-notification-notice')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'app.cancel' })).not.toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1700) })
    f.update()
    expect(screen.getByText('agent.terminalReference.completed')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(screen.queryByText('agent.terminalReference.completed')).not.toBeInTheDocument()
    expect(f.onDismiss).not.toHaveBeenCalled()
  })

  it('下一项处理中收起旧结果，旧计时不会关闭新的失败通知，重试成功后可离页清理', async () => {
    vi.useFakeTimers()
    const f = fixture(job('importing'))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    f.update()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.getByText('agent.terminalReference.completed')).toBeInTheDocument()

    f.update(job('importing', 2))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.queryByText('agent.terminalReference.completed')).not.toBeInTheDocument()
    expect(document.querySelector('.ant-notification-notice')).toBeNull()
    f.update(job('failed', 2))
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.getByText('agent.terminalReference.failed')).toBeInTheDocument()

    f.update(job('pending', 2))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(document.querySelector('.ant-notification-notice')).toBeNull()
    f.update(job('importing', 2))
    expect(document.querySelector('.ant-notification-notice')).toBeNull()

    f.update()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.getByText('agent.terminalReference.completed')).toBeInTheDocument()
    f.update(undefined, false)
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.queryByText('agent.terminalReference.completed')).not.toBeInTheDocument()
    expect(f.onDismiss).not.toHaveBeenCalled()
  })

  it.each(['failed', 'configuration'] as const)('主动取消 %s 任务立即关闭，不显示完成反馈', async (stage) => {
    const user = userEvent.setup()
    const f = fixture(job(stage))
    await user.click(await screen.findByRole('button', { name: 'app.cancel' }))
    expect(f.onDismiss).toHaveBeenCalledOnce()
    f.update()
    await waitFor(() => expect(document.querySelector('.ant-notification-notice')).toBeNull())
    expect(screen.queryByText('agent.terminalReference.completed')).not.toBeInTheDocument()
  })

  it('前往设置及离页只移除通知，回来后仍提供设置和取消入口', async () => {
    const user = userEvent.setup()
    const f = fixture(job('configuration'))
    await user.click(await screen.findByRole('button', { name: 'agent.terminalReference.openSettings' }))
    expect(f.onOpenSettings).toHaveBeenCalledOnce()
    f.update(job('configuration'), false)
    await waitFor(() => expect(screen.queryByText('agent.terminalReference.configuration')).not.toBeInTheDocument())
    expect(f.onDismiss).not.toHaveBeenCalled()
    f.update(job('configuration'))
    const title = await screen.findByText('agent.terminalReference.configuration')
    await user.click(within(title.closest('.ant-notification-notice')!).getByRole('button', { name: 'Close' }))
    expect(f.onDismiss).toHaveBeenCalledOnce()
  })

  it('进入换绑确认只移除通知，保留原有确认弹窗及取消行为', async () => {
    const user = userEvent.setup()
    const f = fixture(job('importing'))
    expect(document.querySelector('.ant-notification-notice')).toBeNull()
    f.update(job('confirm'))
    await screen.findByRole('dialog', { name: 'agent.terminalReference.confirmTitle' })
    expect(document.querySelector('.ant-notification-notice')).toBeNull()
    expect(f.onDismiss).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'app.cancel' }))
    expect(f.onDismiss).toHaveBeenCalledOnce()
    f.update()
    expect(screen.queryByText('agent.terminalReference.completed')).not.toBeInTheDocument()
  })

  it('退场通知的迟到关闭不会取消下一项，卸载时也不取消引用', () => {
    const notification = { open: vi.fn(), destroy: vi.fn() }
    vi.spyOn(AntdApp, 'useApp').mockReturnValue({ notification } as unknown as ReturnType<typeof AntdApp.useApp>)
    const onDismiss = vi.fn()
    const renderNotice = (current: AgentTerminalReferenceImportJob) => (
      <AgentTerminalReferenceImportNotice job={current} resources={[]} onDismiss={onDismiss} onRetry={vi.fn()} onConfirm={vi.fn()} />
    )
    const view = render(renderNotice(job('configuration')))
    const oldClose = notification.open.mock.calls[0]![0].closable.onClose
    view.rerender(renderNotice(job('failed', 2)))
    oldClose()
    expect(onDismiss).not.toHaveBeenCalled()
    const currentClose = notification.open.mock.lastCall![0].closable.onClose
    view.unmount()
    currentClose()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(notification.destroy.mock.calls).toEqual([
      ['agent-terminal-reference-1'], ['agent-terminal-reference-2'],
    ])
  })
})
