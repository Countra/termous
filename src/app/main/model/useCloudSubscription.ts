import { useCallback, useEffect, useRef } from 'react'
import { decodeCloudEvent, type CloudGateway } from '#entities/cloud'
import { cloudDatasets } from '#app/data-runtime'
import { useAuthoritativeSnapshotSubscription } from './useAuthoritativeSnapshotSubscription'

export function useCloudSubscription(api: CloudGateway, enabled: boolean, blocked: boolean, reload: (datasets: string[], current: () => boolean) => Promise<void>) {
  const pending = useRef(new Set<string>())
  const latest = useRef({ enabled, blocked, reload })
  const connection = useRef(0)
  const flushing = useRef(false)
  useEffect(() => { latest.current = { enabled, blocked, reload } }, [enabled, blocked, reload])
  const flush = useCallback(async () => {
    if (flushing.current || !latest.current.enabled || latest.current.blocked || !pending.current.size) return
    const epoch = connection.current
    const binding = api.getStatus()?.generation
    const datasets = [...pending.current]
    pending.current.clear()
    flushing.current = true
    try {
      const current = () => latest.current.enabled && connection.current === epoch && api.getStatus()?.generation === binding && !latest.current.blocked
      await latest.current.reload(datasets, current)
      if (!current()) throw new Error('cloud_refresh_deferred')
    } catch {
      if (connection.current === epoch) datasets.forEach((dataset) => pending.current.add(dataset))
    } finally { flushing.current = false }
  }, [api])
  const eventsUrl = useCallback(() => api.eventsUrl(), [api])
  useAuthoritativeSnapshotSubscription({
    enabled, eventsUrl, decode: decodeCloudEvent,
    onAwaitingSnapshot: () => { connection.current++; pending.current.clear() },
    onSnapshot: (event) => {
      api.acceptStatus(event.status)
      // HTTP 可先返回更高版本的状态；同一绑定的数据失效提示仍须处理，避免列表永久停留在旧值。
      if (api.getStatus()?.generation !== event.status.generation) return
      if (event.type === 'datasets') event.datasets?.forEach((dataset) => pending.current.add(dataset))
      if ((event.type === 'snapshot' || event.type === 'resync') && event.status.confirmed) cloudDatasets.forEach((dataset) => pending.current.add(dataset))
      void flush()
    },
  })
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => void flush(), 1500)
    return () => window.clearInterval(timer)
  }, [enabled, flush])
}
