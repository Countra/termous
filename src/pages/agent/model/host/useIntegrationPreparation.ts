import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { getTermousBridge } from '#shared/bridge'
import type { AgentWorkspaceController } from '#features/agent-runtime'

export function useIntegrationPreparation(controller: AgentWorkspaceController, enabled: boolean, report: () => void, paused = false) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const read = useCallback(() => controller.getSnapshot().selected_session_id, [controller])
  const session = useSyncExternalStore(subscribe, read, read)
  const pausedRef = useRef(paused)
  const scheduling = useRef<{ refresh(): void; pause(): void } | null>(null)
  pausedRef.current = paused
  useEffect(() => {
    const bridge = getTermousBridge()?.agentIntegrations
    if (!enabled || !session || !bridge) return
    let disposed = false
    let owned = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      clearTimeout(timer)
      if (disposed || pausedRef.current || inFlight) return
      owned = true
      inFlight = true
      try { await bridge.prepare(session) }
      catch { if (!disposed) report(); return }
      finally { inFlight = false }
      // 仅对账已确认来源；宿主按来源指纹去重，不重试相同配置的失败初始化。
      if (!disposed && !pausedRef.current) timer = setTimeout(() => void refresh(), 10_000)
    }
    scheduling.current = { refresh: () => void refresh(), pause: () => clearTimeout(timer) }
    void refresh()
    return () => {
      disposed = true
      scheduling.current = null
      clearTimeout(timer)
      if (owned) void bridge.releasePreparation(session).catch(report)
    }
  }, [enabled, session, report])
  useEffect(() => {
    // 暂停只阻止新准备，不取消在途请求，也不释放已经取得的准备所有权。
    if (paused) scheduling.current?.pause()
    else scheduling.current?.refresh()
  }, [paused])
}
