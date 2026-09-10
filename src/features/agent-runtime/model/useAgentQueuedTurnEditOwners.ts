import { useCallback, useEffect, useRef } from 'react'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'

export function useAgentQueuedTurnEditOwners(controller: AgentWorkspaceController) {
  const owners = useRef(new Map<string, { turnId: string; key: string }>())
  const sequence = useRef(0)
  const reconcile = useCallback(() => {
    const edits = controller.getSnapshot().queued_turn_edits
    for (const id of owners.current.keys()) if (!edits[id]) owners.current.delete(id)
    for (const [id, edit] of Object.entries(edits)) {
      if (owners.current.get(id)?.turnId !== edit.turn_id) {
        owners.current.set(id, { turnId: edit.turn_id, key: `queued:${edit.turn_id}:${++sequence.current}` })
      }
    }
  }, [controller])
  useEffect(() => {
    reconcile()
    // 订阅每次控制器提交，避免 React 合并渲染遗漏“取消后重新编辑同一条消息”。
    const unsubscribe = controller.subscribe(reconcile)
    return () => { unsubscribe() }
  }, [controller, reconcile])
  return useCallback((sessionId: string) => {
    reconcile()
    return owners.current.get(sessionId)?.key
  }, [reconcile])
}
