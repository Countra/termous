import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CloudGateway } from '#entities/cloud'

export function useCloudAccount(api: CloudGateway) {
  const status = useSyncExternalStore(api.subscribeStatus, api.getStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const lifetime = useRef<AbortController | null>(null)
  const pending = useRef(false)

  const refresh = useCallback(async () => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted) return
    try {
      await api.status(controller.signal)
      if (!controller.signal.aborted) setError(undefined)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'local_failed')
    }
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void refresh()
    return () => controller.abort()
  }, [refresh])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || pending.current) return
    pending.current = true
    setBusy(true)
    setError(undefined)
    try {
      const result = await action()
      if (controller.signal.aborted) return
      await refresh()
      if (controller.signal.aborted) return
      return result
    } catch (cause) {
      if (!controller.signal.aborted) {
        await refresh()
        setError(cause instanceof Error ? cause.message : 'local_failed')
      }
    } finally {
      pending.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }, [refresh])

  return { status, busy, error, run, refresh }
}
