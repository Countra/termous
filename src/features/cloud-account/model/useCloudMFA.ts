import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudMFAStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudReconnect } from './useCloudReconnect'
import { useCloudChanges } from './useCloudChanges'

export function useCloudMFA(api: CloudGateway, generation: string) {
  const [value, setValue] = useState<CloudMFAStatus>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const latest = useRef<CloudMFAStatus | undefined>(undefined)
  const lifetime = useRef<{ api: CloudGateway; generation: string; controller: AbortController; request: number } | null>(null)
  const reload = useCallback(async () => {
    const scope = lifetime.current
    if (!scope || scope.api !== api || scope.generation !== generation || scope.controller.signal.aborted) return
    const request = ++scope.request
    setLoading(true)
    try {
      const next = await api.mfaStatus(generation, scope.controller.signal)
      if (scope.controller.signal.aborted || request !== scope.request || api.getStatus()?.generation !== generation) return
      if (!latest.current || BigInt(next.revision) >= BigInt(latest.current.revision)) { latest.current = next; setValue(next) }
      setError(false)
      return next
    } catch {
      if (!scope.controller.signal.aborted && request === scope.request) setError(true)
    } finally {
      if (!scope.controller.signal.aborted && request === scope.request) setLoading(false)
    }
  }, [api, generation])
  useEffect(() => {
    const scope = { api, generation, controller: new AbortController(), request: 0 }
    lifetime.current = scope
    latest.current = undefined; setValue(undefined); setError(false)
    void reload()
    return () => scope.controller.abort()
  }, [api, generation, reload])
  const refresh = useCallback(() => { void reload() }, [reload])
  useCloudReconnect(api, generation, refresh)
  useCloudChanges(api, generation, ['mfa'], refresh)
  const accept = (next: CloudMFAStatus) => {
    const scope = lifetime.current
    if (!scope || scope.api !== api || scope.generation !== generation || scope.controller.signal.aborted || api.getStatus()?.generation !== generation || latest.current && BigInt(next.revision) < BigInt(latest.current.revision)) return
    // 操作完成后使较早读取失效，避免旧读取撤销当前会话的验证有效期。
    scope.request++; latest.current = next; setValue(next); setLoading(false); setError(false)
  }
  return { value, loading, error, reload, accept }
}
