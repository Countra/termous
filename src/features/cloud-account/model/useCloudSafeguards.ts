import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudSecurityOverview } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudReconnect } from './useCloudReconnect'
import { useCloudChanges } from './useCloudChanges'

export function useCloudSafeguards(api: CloudGateway, generation: string) {
  const [value, setValue] = useState<CloudSecurityOverview>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const scope = useRef<{ controller: AbortController; request: number } | null>(null)
  const reload = useCallback(async () => {
    const current = scope.current
    if (!current || current.controller.signal.aborted) return
    const request = ++current.request
    setLoading(true)
    try {
      const result = await api.security(generation, current.controller.signal)
      if (!current.controller.signal.aborted && current.request === request && api.getStatus()?.generation === generation) { setValue(result); setError(false) }
    } catch { if (!current.controller.signal.aborted && current.request === request) setError(true) }
    finally { if (!current.controller.signal.aborted && current.request === request) setLoading(false) }
  }, [api, generation])
  useEffect(() => {
    const current = { controller: new AbortController(), request: 0 }
    scope.current = current
    setValue(undefined); setError(false); void reload()
    return () => current.controller.abort()
  }, [reload])
  useCloudReconnect(api, generation, reload)
  useCloudChanges(api, generation, ['security', 'recovery', 'workspaces', 'devices'], reload)
  return { value, loading, error, reload }
}
