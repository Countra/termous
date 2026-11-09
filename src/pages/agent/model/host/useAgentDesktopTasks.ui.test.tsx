import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { AgentRun } from '#entities/agent'
import type { AgentWorkspaceGateway } from '#features/agent-runtime'
import type { AgentWorkspaceMessage } from '#widgets/agent-workspace'
import { useAgentDesktopTasks } from './useAgentDesktopTasks.ts'

it('同 Run 切换执行代次时立即丢弃旧快照，不能把旧回执合并到复用的工具标识', async () => {
  const messages: AgentWorkspaceMessage[] = [{ id: 'message', role: 'assistant', status: 'streaming', created_at: '', attachments: [],
    parts: [{ id: 'part', kind: 'tool', tool_call_id: 'call', name: 'termous.desktops.execute', status: 'running' }] }]
  const desktopTasks = vi.fn().mockResolvedValueOnce({ cursor: 'a'.repeat(64), tasks: [{ tool_call_id: 'call', client_request_id: 'request', generation: 1,
    execution_id: 'desktop_execution_old', receipt: { tool_call_id: 'call', execution_id: 'desktop_execution_old', revision: 3,
      result: { run: { id: 'desktop_execution_old', revision: 3, state: 'completed', accepted_actions: 1,
        steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 500 }] }, capture_state: 'unavailable' } } }] })
    .mockImplementation(() => new Promise(() => {}))
  const gateway = { desktopTasks } as unknown as AgentWorkspaceGateway
  const view = renderHook(({ generation }) => useAgentDesktopTasks(gateway, { id: 'run', assistant_message_id: 'message', generation, status: 'running' } as AgentRun, messages, true), { initialProps: { generation: 1 } })
  try {
    await waitFor(() => expect(view.result.current[0].parts[0]).toMatchObject({ status: 'completed' }))
    view.rerender({ generation: 2 })
    expect(view.result.current).toBe(messages)
    expect(desktopTasks).toHaveBeenLastCalledWith('run', 2, '', 0, expect.any(AbortSignal))
  } finally { view.unmount() }
})

it('已持久化终态不会被迟到的运行快照覆盖', async () => {
  const task = batchTask('running')
  const messages: AgentWorkspaceMessage[] = [{ id: 'message', role: 'assistant', status: 'completed', created_at: '', attachments: [],
    parts: [{ id: 'part', kind: 'tool', tool_call_id: 'call', name: 'termous.desktops.execute', status: 'completed',
      desktop_batch: { id: 'desktop_execution_task', state: 'completed', accepted_actions: 1, capture_state: 'ready',
        steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 500 }] } }] }]
  const gateway = { desktopTasks: vi.fn().mockResolvedValueOnce({ cursor: 'a'.repeat(64), tasks: [task] }).mockImplementation(() => new Promise(() => {})) } as unknown as AgentWorkspaceGateway
  const view = renderHook(() => useAgentDesktopTasks(gateway, { id: 'run', assistant_message_id: 'message', generation: 1, status: 'running' } as AgentRun, messages, true))
  try {
    await waitFor(() => expect(gateway.desktopTasks).toHaveBeenCalledTimes(1))
    expect(view.result.current[0].parts[0]).toMatchObject({ status: 'completed' })
    expect(view.result.current[0].parts[0]).not.toHaveProperty('cancelDesktop')
  } finally { view.unmount() }
})

it('Run 结束后补查终态，保留原工具身份并移除取消入口', async () => {
  const messages: AgentWorkspaceMessage[] = [{ id: 'message', role: 'assistant', status: 'completed', created_at: '', attachments: [],
    parts: [{ id: 'part', kind: 'tool', tool_call_id: 'call', name: 'termous.desktops.execute', status: 'running' }] }]
  const desktopTasks = vi.fn().mockResolvedValueOnce({ cursor: 'a'.repeat(64), tasks: [batchTask('running')] })
    .mockResolvedValueOnce({ cursor: 'b'.repeat(64), tasks: [batchTask('cancelled')] })
  const gateway = { desktopTasks, cancelDesktopTask: vi.fn() } as unknown as AgentWorkspaceGateway
  const view = renderHook(({ status }) => useAgentDesktopTasks(gateway, { id: 'run', assistant_message_id: 'message', generation: 1, status } as AgentRun, messages, true), { initialProps: { status: 'running' } })
  try {
    await waitFor(() => expect(view.result.current[0].parts[0]).toHaveProperty('cancelDesktop'))
    view.rerender({ status: 'cancelled' })
    await waitFor(() => expect(view.result.current[0].parts[0]).toMatchObject({ tool_call_id: 'call', desktop_batch: { state: 'cancelled' } }))
    expect(view.result.current[0].parts[0]).toHaveProperty('cancelDesktop', undefined)
    expect(desktopTasks).toHaveBeenLastCalledWith('run', 1, '', 0, expect.any(AbortSignal))
  } finally { view.unmount() }
})

it('实时回执只更新原 Run 的回复，复用调用标识也不能覆盖其他执行', async () => {
  const part = { id: 'part', kind: 'tool' as const, tool_call_id: 'call', name: 'termous.desktops.execute', status: 'running' as const }
  const current: AgentWorkspaceMessage = { id: 'message', role: 'assistant', status: 'streaming', created_at: '', attachments: [], parts: [part] }
  const previous = { ...current, id: 'previous-message' }
  const desktopTasks = vi.fn().mockResolvedValueOnce({ cursor: 'a'.repeat(64), tasks: [batchTask('running')] })
    .mockImplementation(() => new Promise(() => {}))
  const gateway = { desktopTasks, cancelDesktopTask: vi.fn() } as unknown as AgentWorkspaceGateway
  const run = { id: 'run', assistant_message_id: current.id, generation: 1, status: 'running' } as AgentRun
  const view = renderHook(({ messages }) => useAgentDesktopTasks(gateway, run, messages, true), { initialProps: { messages: [previous, current] } })
  try {
    await waitFor(() => expect(view.result.current[1].parts[0]).toHaveProperty('cancelDesktop'))
    expect(view.result.current[0]).toBe(previous)
    const anotherExecution = { ...part, desktop_batch: { id: 'desktop_execution_other', state: 'running' as const,
      accepted_actions: 1, capture_state: 'pending' as const, steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted' as const, wait_after_ms: 500 }] } }
    view.rerender({ messages: [previous, { ...current, parts: [anotherExecution] }] })
    expect(view.result.current[1].parts[0]).toBe(anotherExecution)
    const otherTool = { ...part, name: 'termous.desktops.capture' }
    view.rerender({ messages: [previous, { ...current, parts: [otherTool] }] })
    expect(view.result.current[1].parts[0]).toBe(otherTool)
  } finally { view.unmount() }
})

it.each(['cleanup_error', 'report_error'])('已接受输入但有 %s 时不能显示成功', async (errorKey) => {
  const task = batchTask('completed')
  const result = { ...task.receipt.result, run: { ...task.receipt.result.run, [errorKey]: 'desktop_cleanup_uncertain' } }
  const messages: AgentWorkspaceMessage[] = [{ id: 'message', role: 'assistant', status: 'completed', created_at: '', attachments: [],
    parts: [{ id: 'part', kind: 'tool', tool_call_id: 'call', name: 'termous.desktops.execute', status: 'running' }] }]
  const gateway = { desktopTasks: vi.fn().mockResolvedValue({ cursor: 'a'.repeat(64), tasks: [{ ...task, receipt: { ...task.receipt, result } }] }) } as unknown as AgentWorkspaceGateway
  const view = renderHook(() => useAgentDesktopTasks(gateway, { id: 'run', assistant_message_id: 'message', generation: 1, status: 'completed' } as AgentRun, messages, true))
  try {
    await waitFor(() => expect(view.result.current[0].parts[0]).toMatchObject({ status: 'failed', desktop_batch: { state: 'completed' } }))
  } finally { view.unmount() }
})

function batchTask(state: 'running' | 'cancelled' | 'completed') {
  return { tool_call_id: 'call', client_request_id: 'request', generation: 1, execution_id: 'desktop_execution_task',
    receipt: { tool_call_id: 'call', execution_id: 'desktop_execution_task', revision: state === 'running' ? 2 : 3,
      result: { run: { id: 'desktop_execution_task', state, accepted_actions: 1,
        steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 500 }] }, capture_state: 'unavailable' } } }
}
