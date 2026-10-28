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
  const view = renderHook(({ generation }) => useAgentDesktopTasks(gateway, { id: 'run', generation, status: 'running' } as AgentRun, messages, true), { initialProps: { generation: 1 } })
  try {
    await waitFor(() => expect(view.result.current[0].parts[0]).toMatchObject({ status: 'completed' }))
    view.rerender({ generation: 2 })
    expect(view.result.current).toBe(messages)
    expect(desktopTasks).toHaveBeenLastCalledWith('run', 2, '', 0, expect.any(AbortSignal))
  } finally { view.unmount() }
})
