import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import type { AgentSSHResourceState } from '#entities/agent'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { agentSessionFixture } from './agentRuntimeTestFixtures.ts'
import { useAgentResourceRecovery } from './useAgentResourceRecovery.ts'

it('窗口隐藏时不轮询，重新显示立即找回恢复状态', async () => {
  const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  const session = agentSessionFixture({ resource_bindings: [{ kind: 'ssh_session', session_id: 'ssh', ssh_profile_id: 'profile',
    host_id: 'host', host_name: '主机', platform: 'linux', bound_at: '2026-09-10T00:00:00Z' }] })
  const query = vi.fn().mockResolvedValue({ instance_id: 'core', kind: 'ssh_session', can_recover: true, operation: null })
  const gateway = { resourceBindingRecovery: query } as unknown as AgentWorkspaceGateway
  const controller = { acceptRecoveredResourceSession: vi.fn() } as unknown as AgentWorkspaceController
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  const view = renderHook(() => useAgentResourceRecovery(gateway, controller, session, true, undefined))
  try {
    expect(query).not.toHaveBeenCalled()
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1))
    expect(view.result.current.state?.view?.instance_id).toBe('core')
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(query).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
    if (previous) Object.defineProperty(document, 'visibilityState', previous)
    else Reflect.deleteProperty(document, 'visibilityState')
  }
})

it('SSH 配置目录变更后重新检查恢复能力，不要求切换聊天', async () => {
  const session = agentSessionFixture({ resource_bindings: [{ kind: 'ssh_session', session_id: 'ssh', ssh_profile_id: 'profile',
    host_id: 'host', host_name: '主机', platform: 'linux', bound_at: '2026-09-10T00:00:00Z' }] })
  const query = vi.fn().mockResolvedValueOnce({ instance_id: 'core', kind: 'ssh_session', can_recover: false, blocked_reason: 'profile_unavailable', operation: null })
    .mockResolvedValue({ instance_id: 'core', kind: 'ssh_session', can_recover: true, operation: null })
  const gateway = { resourceBindingRecovery: query } as unknown as AgentWorkspaceGateway
  const controller = { acceptRecoveredResourceSession: vi.fn() } as unknown as AgentWorkspaceController
  const view = renderHook(({ resources }) => useAgentResourceRecovery(gateway, controller, session, true, undefined, resources), {
    initialProps: { resources: [] as AgentSSHResourceState[] },
  })
  await waitFor(() => expect(view.result.current.state?.view?.blocked_reason).toBe('profile_unavailable'))
  view.rerender({ resources: [] })
  await waitFor(() => expect(view.result.current.state?.view?.can_recover).toBe(true))
  expect(query).toHaveBeenCalledTimes(2)
  view.unmount()
})
