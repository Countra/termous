import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { AIRuntimeGateway, AIRuntimeStatus } from './types'

export const AIRuntimeGatewayContext = createContext<AIRuntimeGateway | null>(null)

export function useAIRuntime() {
  const gateway = useContext(AIRuntimeGatewayContext)
  const [status, setStatus] = useState<AIRuntimeStatus>()
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const acting = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!gateway) return
      try {
        const next = await gateway.status(controller.signal)
        if (!controller.signal.aborted) { setStatus(next); setError(undefined) }
      } catch (reason) { if (!controller.signal.aborted) setError(reason) }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer); lifetime.current = null }
  }, [gateway])
  const act = useCallback(async (action: 'download' | 'cancel' | 'check') => {
    const controller = lifetime.current
    if (!gateway || !controller || acting.current) return
    acting.current = true; setPending(true)
    try {
      if (action === 'cancel') { if (status?.task) await gateway.cancel(status.task.id) }
      else await gateway[action]()
      const next = await gateway.status(controller.signal)
      if (!controller.signal.aborted) { setStatus(next); setError(undefined) }
    } catch (reason) { if (!controller.signal.aborted) setError(reason) }
    finally { acting.current = false; if (!controller.signal.aborted) setPending(false) }
  }, [gateway, status?.task])
  const active = !!status?.task && !['complete', 'failed', 'cancelled'].includes(status.task.phase)
  return { available: !!gateway, status, error, pending, active, act }
}
