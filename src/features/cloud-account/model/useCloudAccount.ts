import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CloudGateway } from '#entities/cloud'

export function useCloudAccount(api: CloudGateway) {
  const status = useSyncExternalStore(api.subscribeStatus, api.getStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [statusError, setStatusError] = useState<string>()
  const lifetime = useRef<{ api: CloudGateway; controller: AbortController; request: number } | null>(null)
  const pending = useRef(false)
  const generation = status?.generation

  useEffect(() => {
    // 状态恢复只消除读取失败，不能让未成功的写操作看起来已经完成。
    if (status?.authenticated && status.phase === 'ready' && !status.error_code) setStatusError(undefined)
  }, [status])

  useEffect(() => { setError(undefined); setStatusError(undefined) }, [generation])

  const refresh = useCallback(async () => {
    const scope = lifetime.current
    if (scope?.api !== api || scope.controller.signal.aborted) return
    const { controller } = scope
    const request = ++scope.request
    const requestGeneration = api.getStatus()?.generation
    // 状态读取也可能乱序完成；旧账号或较早读取的错误不能覆盖当前页面。
    const current = () => !controller.signal.aborted && request === scope.request && requestGeneration === api.getStatus()?.generation
    try {
      await api.status(controller.signal)
      if (current()) setStatusError(undefined)
    } catch (cause) {
      if (current()) setStatusError(cause instanceof Error ? cause.message : 'local_failed')
    }
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = { api, controller, request: 0 }
    pending.current = false
    setBusy(false)
    setError(undefined)
    setStatusError(undefined)
    void refresh()
    return () => controller.abort()
  }, [api, refresh])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    const scope = lifetime.current
    // 保留的旧页面回调不能借用新 Core 或新账号的操作入口。
    if (scope?.api !== api || scope.controller.signal.aborted || generation !== api.getStatus()?.generation || pending.current) return
    const { controller } = scope
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
      if (!controller.signal.aborted && generation === api.getStatus()?.generation) {
        await refresh()
        if (!controller.signal.aborted && generation === api.getStatus()?.generation) setError(cause instanceof Error ? cause.message : 'local_failed')
      }
    } finally {
      if (!controller.signal.aborted) { pending.current = false; setBusy(false) }
    }
  }, [api, generation, refresh])

  const clearError = useCallback(() => { setError(undefined) }, [])

  return { status, busy, error: error ?? statusError, run, refresh, clearError }
}
