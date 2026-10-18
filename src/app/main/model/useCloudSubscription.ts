import { useCallback, useEffect, useRef } from 'react'
import { decodeCloudEvent, type CloudGateway } from '#entities/cloud'
import { cloudDatasets } from '#app/data-runtime'
import { useAuthoritativeSnapshotSubscription } from './useAuthoritativeSnapshotSubscription'

export function useCloudSubscription(api: CloudGateway, enabled: boolean, blocked: boolean, reload: (datasets: string[], current: () => boolean) => Promise<void>) {
  const pending = useRef(new Set<string>())
  const latest = useRef({ blocked, reload })
  const editing = useRef(0)
  const connection = useRef(0)
  const lifetime = useRef<{ api: CloudGateway; active: boolean; flushing: boolean; retry?: number; delay: number } | null>(null)
  useEffect(() => {
    // 进入编辑永久作废此前读取，退出编辑不能让旧快照重新获得写入权限。
    if (blocked && !latest.current.blocked) editing.current++
    latest.current = { blocked, reload }
  }, [blocked, reload])
  useEffect(() => {
    const scope: NonNullable<typeof lifetime.current> = { api, active: enabled, flushing: false, delay: 1000 }
    lifetime.current = scope
    return () => { scope.active = false; window.clearTimeout(scope.retry) }
  }, [api, enabled])
  const flush = useCallback(async () => {
    const scope = lifetime.current
    if (!scope?.active || scope.api !== api || scope.flushing || latest.current.blocked || !pending.current.size) return
    window.clearTimeout(scope.retry)
    scope.retry = undefined
    scope.flushing = true
    let failed = false
    try {
      // 一次刷新期间到达的新失效继续合并补读，不等待固定间隔；草稿解除保护也立即推进。
      while (scope.active && !latest.current.blocked && pending.current.size) {
        const epoch = connection.current
        const edit = editing.current
        const binding = api.getStatus()?.generation
        const datasets = [...pending.current]
        pending.current.clear()
        const bound = () => scope.active && connection.current === epoch && api.getStatus()?.generation === binding
        const current = () => bound() && editing.current === edit && !latest.current.blocked
        try {
          await latest.current.reload(datasets, current)
          if (!current() && bound()) datasets.forEach((dataset) => pending.current.add(dataset))
        } catch {
          if (bound()) {
            datasets.forEach((dataset) => pending.current.add(dataset))
            // 编辑使在途读取失效时立即等待／补读，只有真实读取失败才进入网络退避。
            if (editing.current !== edit || latest.current.blocked) continue
            failed = true
            break
          }
        }
      }
    } finally {
      scope.flushing = false
      if (failed && scope.active && !latest.current.blocked && pending.current.size) {
        // 仅失败且仍有待办时安排有界重试，成功的空闲连接不产生轮询。
        scope.retry = window.setTimeout(() => { scope.retry = undefined; void flush() }, scope.delay)
        scope.delay = Math.min(scope.delay * 2, 30_000)
      } else scope.delay = 1000
    }
  }, [api])
  const eventsUrl = useCallback(() => api.eventsUrl(), [api])
  useAuthoritativeSnapshotSubscription({
    enabled, eventsUrl, decode: decodeCloudEvent,
    onAwaitingSnapshot: () => {
      connection.current++; pending.current.clear()
      const scope = lifetime.current
      if (scope) { window.clearTimeout(scope.retry); scope.retry = undefined; scope.delay = 1000 }
    },
    onSnapshot: (event) => {
      api.acceptEvent(event)
      // HTTP 可先返回更高版本的状态；同一绑定的数据失效提示仍须处理，避免列表永久停留在旧值。
      if (api.getStatus()?.generation !== event.status.generation) return
      if (event.type === 'datasets') event.datasets?.forEach((dataset) => pending.current.add(dataset))
      if ((event.type === 'snapshot' || event.type === 'resync') && event.status.confirmed) cloudDatasets.forEach((dataset) => pending.current.add(dataset))
      void flush()
    },
  })
  useEffect(() => {
    if (enabled && !blocked) void flush()
  }, [enabled, blocked, flush])
}
