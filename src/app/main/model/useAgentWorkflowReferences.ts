import { useEffect, useState } from 'react'
import type { Script, WorkflowGateway } from '#entities/desktop-workflow'

// 仅同步脚本摘要；不为引用选择加载定义、运行报告或图片。
export function useAgentWorkflowReferences(gateway: Pick<WorkflowGateway, 'list' | 'eventsURL'>, enabled: boolean) {
  const [state, setState] = useState<{ scripts: Script[]; ready: boolean }>({ scripts: [], ready: false })
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let request: AbortController | undefined
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let refresh: ReturnType<typeof setTimeout> | undefined
    let backoff = 500
    let loadBackoff = 1_000
    let reloadPending = false
    setState((previous) => ({ ...previous, ready: false }))
    const load = async () => {
      if (stopped) return
      // 连续运行事件只登记下一次刷新，不能反复中止较慢的权威查询。
      if (request) { reloadPending = true; return }
      clearTimeout(refresh)
      refresh = undefined
      const current = new AbortController()
      request = current
      try {
        const scripts = await gateway.list(current.signal)
        if (!stopped && !current.signal.aborted) {
          loadBackoff = 1_000
          setState({ scripts, ready: true })
        }
      } catch {
        if (!stopped && !current.signal.aborted) {
          setState((previous) => ({ ...previous, ready: false }))
          refresh = setTimeout(() => { void load() }, loadBackoff)
          loadBackoff = Math.min(10_000, loadBackoff * 2)
        }
      } finally {
        request = undefined
        if (!stopped && reloadPending) {
          reloadPending = false
          refresh ??= setTimeout(() => { refresh = undefined; void load() }, 150)
        }
      }
    }
    const reconnect = () => {
      if (stopped) return
      setState((previous) => ({ ...previous, ready: false }))
      timer = setTimeout(connect, backoff)
      backoff = Math.min(10_000, backoff * 2)
    }
    const connect = () => {
      if (stopped) return
      try { socket = new WebSocket(gateway.eventsURL()) }
      catch { reconnect(); return }
      const current = socket
      const active = () => !stopped && socket === current
      current.onopen = () => { if (active()) { backoff = 500; void load() } }
      current.onmessage = () => { if (active()) refresh ??= setTimeout(() => { refresh = undefined; void load() }, 150) }
      current.onerror = () => { if (active()) current.close() }
      current.onclose = () => { if (active()) { socket = undefined; reconnect() } }
    }
    void load()
    connect()
    return () => { stopped = true; request?.abort(); clearTimeout(timer); clearTimeout(refresh); socket?.close() }
  }, [gateway, enabled])
  return enabled ? state : { scripts: [], ready: false }
}
