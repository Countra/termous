import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { AIRuntimeGateway, AIRuntimeStatus } from './types'

export const AIRuntimeGatewayContext = createContext<AIRuntimeGateway | null>(null)

export function useAIRuntime(enabled = true) {
  const gateway = useContext(AIRuntimeGatewayContext)
  const [status, setStatus] = useState<AIRuntimeStatus>()
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const lifetime = useRef<{ signal: AbortSignal; refresh: () => Promise<void> } | null>(null)
  const acting = useRef(false)
  useEffect(() => {
    if (!gateway || !enabled) return
    const controller = new AbortController()
    let reading: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (controller.signal.aborted || document.visibilityState === 'hidden') return
      clearTimeout(timer)
      reading?.abort()
      const current = new AbortController(); reading = current
      try {
        const next = await gateway.status(current.signal)
        if (!current.signal.aborted) { setStatus(next); setError(undefined) }
      } catch (reason) { if (!current.signal.aborted) setError(reason) }
      if (!current.signal.aborted) timer = setTimeout(() => void poll(), 1500)
    }
    // 维护后的刷新与轮询共用读取槽，旧响应和旧定时器不能覆盖较新的观察。
    lifetime.current = { signal: controller.signal, refresh: poll }
    // 设置页切换与窗口隐藏只停止状态观察，后台维护任务仍由服务管理。
    const visibility = () => { clearTimeout(timer); reading?.abort(); if (document.visibilityState !== 'hidden') void poll() }
    document.addEventListener('visibilitychange', visibility)
    void poll()
    return () => {
      controller.abort(); reading?.abort(); clearTimeout(timer); lifetime.current = null
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [gateway, enabled])
  const act = useCallback(async (action: 'download' | 'cancel' | 'check') => {
    const controller = lifetime.current
    if (!enabled || !gateway || !controller || controller.signal.aborted || acting.current) return
    acting.current = true; setPending(true)
    try {
      if (action === 'cancel') { if (status?.task) await gateway.cancel(status.task.id) }
      else await gateway[action]()
      if (controller.signal.aborted || document.visibilityState === 'hidden') return
      await controller.refresh()
    } catch (reason) { if (!controller.signal.aborted) setError(reason) }
    finally { acting.current = false; setPending(false) }
  }, [enabled, gateway, status?.task])
  const active = !!status?.task && !['complete', 'failed', 'cancelled'].includes(status.task.phase)
  return { available: !!gateway, status, error, pending, active, act }
}
