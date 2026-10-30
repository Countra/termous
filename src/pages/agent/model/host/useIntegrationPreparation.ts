import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { getTermousBridge } from '#shared/bridge'
import type { AgentWorkspaceController } from '#features/agent-runtime'

export function useIntegrationPreparation(controller: AgentWorkspaceController, enabled: boolean, report: () => void) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const read = useCallback(() => controller.getSnapshot().selected_session_id, [controller])
  const session = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    const bridge = getTermousBridge()?.agentIntegrations
    if (!enabled || !session || !bridge) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try { await bridge.prepare(session) }
      catch { if (!disposed) report(); return }
      // 仅对账已确认来源；宿主按来源指纹去重，不重试相同配置的失败初始化。
      if (!disposed) timer = setTimeout(() => void refresh(), 10_000)
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer); void bridge.releasePreparation(session).catch(report) }
  }, [enabled, session, report])
}
