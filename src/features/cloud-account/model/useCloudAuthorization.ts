import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudAuthorization, CloudSecurityOverview } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudChanges } from './useCloudChanges'
import { useCloudReconnect } from './useCloudReconnect'

interface ReadScope { api: CloudGateway; generation: string; controller: AbortController; request: number; pending: boolean; queued: boolean }

export function useCloudAuthorization(api: CloudGateway, generation: string) {
  const [security, setSecurity] = useState<CloudSecurityOverview>()
  const [deviceRequests, setDeviceRequests] = useState<CloudAuthorization[]>([])
  const [operations, setOperations] = useState<CloudAuthorization[]>([])
  const [requestError, setRequestError] = useState(false)
  const [contextError, setContextError] = useState(false)
  const [loading, setLoading] = useState(true)
  const scope = useRef<ReadScope | null>(null)
  const contextScope = useRef<ReadScope | null>(null)
  const readRequests = useCallback(async (invalidate = true) => {
    const current = scope.current
    if (!current || current.api !== api || current.generation !== generation || current.controller.signal.aborted) return
    // 普通提示只排队补读，避免持续消息使页面一直空白；写后刷新仍作废在途快照。
    if (current.pending) { current.queued = true; if (invalidate) current.request++; return }
    current.pending = true
    try {
      const signal = current.controller.signal
      do {
        current.queued = false
        const sequence = ++current.request
        try {
          const value = await api.deviceRequests(generation, signal)
          if (!signal.aborted && sequence === current.request && generation === api.getStatus()?.generation) { setDeviceRequests(value); setRequestError(false); setLoading(false) }
        } catch {
          if (!signal.aborted && sequence === current.request && generation === api.getStatus()?.generation) setRequestError(true)
        }
      } while (current.queued && !signal.aborted && generation === api.getStatus()?.generation)
    } finally {
      current.pending = false
      if (!current.controller.signal.aborted) setLoading(false)
    }
  }, [api, generation])
  const readContext = useCallback(async (invalidate = true) => {
    const current = contextScope.current
    if (!current || current.api !== api || current.generation !== generation || current.controller.signal.aborted) return
    if (current.pending) { current.queued = true; if (invalidate) current.request++; return }
    current.pending = true
    try {
      const signal = current.controller.signal
      do {
        current.queued = false
        const sequence = ++current.request
        const active = () => !signal.aborted && sequence === current.request && generation === api.getStatus()?.generation
        const results = await Promise.allSettled([
          Promise.resolve().then(() => api.security(generation, signal)).then(value => { if (active()) setSecurity(value) }).catch(cause => { if (active()) setSecurity(undefined); throw cause }),
          Promise.resolve().then(() => api.recoveryOperations(generation, signal)).then(value => { if (active()) setOperations(value) }),
        ])
        if (active()) setContextError(results.some(result => result.status === 'rejected'))
      } while (current.queued && !signal.aborted && generation === api.getStatus()?.generation)
    } finally { current.pending = false }
  }, [api, generation])
  // 待办与安全／恢复上下文分别合并补读，后者慢或失败时仍可立即更新新申请。
  const reload = useCallback(async () => { await Promise.all([readRequests(), readContext()]) }, [readRequests, readContext])
  const refresh = useCallback(async () => { await Promise.all([readRequests(false), readContext(false)]) }, [readRequests, readContext])
  useEffect(() => {
    const controller = new AbortController()
    scope.current = { api, generation, controller, request: 0, pending: false, queued: false }
    contextScope.current = { api, generation, controller, request: 0, pending: false, queued: false }
    setSecurity(undefined); setDeviceRequests([]); setOperations([]); setLoading(true); setRequestError(false); setContextError(false)
    void reload()
    const initialStatus = api.getStatus()
    let identity = JSON.stringify([initialStatus?.authenticated, initialStatus?.device_id, initialStatus?.device_status, initialStatus?.workspace_id])
    const unsubscribe = api.subscribeStatus(() => {
      const status = api.getStatus()
      if (status?.generation !== generation || controller.signal.aborted) return
      const next = JSON.stringify([status.authenticated, status.device_id, status.device_status, status.workspace_id])
      if (next === identity) return
      identity = next
      // 密码登录、设备登记及工作区补齐可发生在同一代次，权限变化必须立即重新读取。
      void reload()
    })
    return () => { controller.abort(); unsubscribe() }
  }, [api, generation, reload])
  useCloudChanges(api, generation, ['authorizations', 'security', 'devices', 'recovery', 'workspaces'], refresh)
  useCloudReconnect(api, generation, reload)
  return { security, requests: [...deviceRequests, ...operations], error: requestError || contextError, loading, reload }
}
