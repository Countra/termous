import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudAuthorization, CloudSecurityOverview } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'

export function useCloudAuthorization(api: CloudGateway, generation: string) {
  const [security, setSecurity] = useState<CloudSecurityOverview>()
  const [requests, setRequests] = useState<CloudAuthorization[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const scope = useRef<{ api: CloudGateway; generation: string; controller: AbortController; request: number; pending: boolean; queued: boolean } | null>(null)
  const reload = useCallback(async () => {
    const current = scope.current
    if (!current || current.api !== api || current.generation !== generation || current.controller.signal.aborted) return
    // 读取期间的新提示合并为一次补读，并阻止旧结果覆盖刚完成的操作。
    if (current.pending) { current.queued = true; current.request++; return }
    current.pending = true
    try {
      const signal = current.controller.signal
      do {
        current.queued = false
        const sequence = ++current.request
        try {
          const [overview, devices, operations] = await Promise.all([api.security(generation, signal), api.deviceRequests(generation, signal), api.recoveryOperations(generation, signal)])
          if (!signal.aborted && sequence === current.request && generation === api.getStatus()?.generation) {
            setSecurity(overview); setRequests([...devices, ...operations]); setError(false)
          }
        } catch {
          if (!signal.aborted && sequence === current.request && generation === api.getStatus()?.generation) setError(true)
        }
      } while (current.queued && !signal.aborted && generation === api.getStatus()?.generation)
    } finally {
      current.pending = false
      if (!current.controller.signal.aborted) setLoading(false)
    }
  }, [api, generation])
  useEffect(() => {
    const controller = new AbortController()
    scope.current = { api, generation, controller, request: 0, pending: false, queued: false }
    setSecurity(undefined); setRequests([]); setLoading(true); setError(false)
    void reload()
    const timer = window.setInterval(() => void reload(), 60_000)
    let hint: number | undefined
    const unsubscribe = api.subscribeStatus(() => {
      window.clearTimeout(hint)
      hint = window.setTimeout(() => void reload(), 700)
    })
    return () => { controller.abort(); window.clearInterval(timer); window.clearTimeout(hint); unsubscribe() }
  }, [api, generation, reload])
  return { security, requests, error, loading, reload }
}
