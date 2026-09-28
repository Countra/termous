import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SettingsModuleId, SettingsSnapshot } from '#common/contracts'

export interface SettingsGateway {
  getModule(id: SettingsModuleId): SettingsSnapshot | undefined
  readModule(id: SettingsModuleId, signal?: AbortSignal): Promise<SettingsSnapshot>
  updateModule(id: SettingsModuleId, patch: Record<string, unknown>, options?: { expectedRevision?: number; signal?: AbortSignal }): Promise<SettingsSnapshot>
  subscribeSettings(listener: () => void): () => void
}
export const SettingsGatewayContext = createContext<SettingsGateway | null>(null)
const emptySubscribe = () => () => {}

// 页面只管理请求反馈；确认值、版本及提交队列始终由注入的设置中心持有。
export function useSettingsModule(id: SettingsModuleId, options: { refreshOnFocus?: boolean; gateway?: SettingsGateway | null } = {}) {
  const context = useContext(SettingsGatewayContext)
  const gateway = options.gateway === undefined ? context : options.gateway
  const subscribe = useCallback((listener: () => void) => gateway?.subscribeSettings(listener) ?? emptySubscribe(), [gateway])
  const getSnapshot = useCallback(() => gateway?.getModule(id), [gateway, id])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [error, setError] = useState<Error | null>(null)
  const [busy, setBusy] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const request = useCallback(async (patch?: Record<string, unknown>, expectedRevision?: number) => {
    if (!gateway || pending.current) return undefined
    const controller = lifetime.current
    if (!controller || controller.signal.aborted) return undefined
    pending.current = true
    setBusy(true)
    try {
      const result = patch ? await gateway.updateModule(id, patch, { expectedRevision, signal: controller.signal }) : await gateway.readModule(id, controller.signal)
      if (!controller.signal.aborted) setError(null)
      return controller.signal.aborted ? undefined : result
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error(String(cause)))
      return undefined
    } finally {
      if (!controller.signal.aborted) { pending.current = false; setBusy(false) }
    }
  }, [gateway, id])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    setError(null)
    setBusy(false)
    void request()
    const refresh = () => { void request() }
    if (options.refreshOnFocus) window.addEventListener('focus', refresh)
    return () => { controller.abort(); pending.current = false; window.removeEventListener('focus', refresh) }
  }, [request, options.refreshOnFocus])
  return { snapshot, error, busy, available: Boolean(gateway), refresh: () => request(), update: (patch: Record<string, unknown>, expectedRevision?: number) => request(patch, expectedRevision) }
}
