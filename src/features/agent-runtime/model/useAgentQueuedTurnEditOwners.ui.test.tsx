import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { createAgentWorkspaceState } from './agentWorkspaceState.ts'
import { useAgentQueuedTurnEditOwners } from './useAgentQueuedTurnEditOwners.ts'

describe('useAgentQueuedTurnEditOwners', () => {
  it('正文与保留附件变化沿用 owner，取消后同一轮重新编辑获得新 owner', () => {
    const fixture = setup()
    const view = renderHook(() => useAgentQueuedTurnEditOwners(fixture.controller))
    expect(view.result.current('session')).toBeUndefined()
    act(() => fixture.edit('session', 'turn-one'))
    const first = view.result.current('session')
    expect(first).toBeTruthy()
    act(() => fixture.edit('session', 'turn-one', '修改后的草稿', ['attachment']))
    expect(view.result.current('session')).toBe(first)
    act(() => {
      // 两次控制器提交发生在同一 React 批次，订阅仍须观察到中间的取消。
      fixture.remove('session')
      fixture.edit('session', 'turn-one')
    })
    expect(view.result.current('session')).not.toBe(first)
  })

  it('各会话 owner 独立，更换排队消息只更新所属会话，卸载释放订阅', () => {
    const fixture = setup()
    fixture.edit('first', 'turn-one')
    fixture.edit('second', 'turn-two')
    const view = renderHook(() => useAgentQueuedTurnEditOwners(fixture.controller))
    const first = view.result.current('first')
    const second = view.result.current('second')
    act(() => fixture.edit('first', 'turn-three'))
    expect(view.result.current('first')).not.toBe(first)
    expect(view.result.current('second')).toBe(second)
    view.unmount()
    expect(fixture.unsubscribe).toHaveBeenCalledOnce()
    expect(fixture.listenerCount()).toBe(0)
  })
})

function setup() {
  let state = createAgentWorkspaceState()
  const listeners = new Set<() => void>()
  const unsubscribe = vi.fn()
  const controller = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener); unsubscribe() }
    },
  } as unknown as AgentWorkspaceController
  return {
    controller, unsubscribe, listenerCount: () => listeners.size,
    edit: (sessionId: string, turnId: string, text = '', retainedIds: string[] = []) => {
      state = { ...state, queued_turn_edits: { ...state.queued_turn_edits,
        [sessionId]: { turn_id: turnId, text, retained_attachment_ids: retainedIds },
      } }
      for (const listener of listeners) listener()
    },
    remove: (sessionId: string) => {
      const edits = { ...state.queued_turn_edits }
      delete edits[sessionId]
      state = { ...state, queued_turn_edits: edits }
      for (const listener of listeners) listener()
    },
  }
}
