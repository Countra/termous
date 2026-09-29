import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudProfile, CloudProfilePatch } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'

export type CloudProfileController = ReturnType<typeof useCloudProfile>

export function useCloudProfile(api: CloudGateway, generation: string, userId?: string) {
  const [state, setState] = useState<{ api: CloudGateway; generation: string; userId?: string; value?: CloudProfile; loading: boolean; error?: string }>()
  const lifetime = useRef<{ api: CloudGateway; generation: string; userId?: string; controller: AbortController } | null>(null)
  const pending = useRef(false)
  const load = useCallback(async () => {
    const scope = lifetime.current
    if (!userId || scope?.api !== api || scope.generation !== generation || scope.userId !== userId || scope.controller.signal.aborted || pending.current) return
    const { controller } = scope
    pending.current = true
    setState((current) => ({ ...current, api, generation, userId, loading: true, error: undefined }))
    try {
      const value = await api.profile(generation, controller.signal)
      if (value.user_id !== userId) throw new Error('protocol_invalid')
      if (!controller.signal.aborted) setState({ api, generation, userId, value, loading: false })
    } catch (cause) {
      if (!controller.signal.aborted) setState((current) => ({ ...current, api, generation, userId, loading: false, error: cause instanceof Error ? cause.message : 'local_failed' }))
    } finally { if (!controller.signal.aborted) pending.current = false }
  }, [api, generation, userId])
  useEffect(() => {
    const controller = new AbortController()
    // 旧页面留下的回调也必须核对归属，不能借用新连接的 AbortController 发出请求。
    lifetime.current = { api, generation, userId, controller }
    pending.current = false
    setState(undefined)
    void load()
    return () => controller.abort()
  }, [api, generation, userId, load])
  const save = useCallback(async (patch: CloudProfilePatch) => {
    const scope = lifetime.current
    if (!userId || scope?.api !== api || scope.generation !== generation || scope.userId !== userId || scope.controller.signal.aborted || pending.current) return false
    const { controller } = scope
    pending.current = true
    setState((current) => ({ ...current, api, generation, userId, loading: true, error: undefined }))
    try {
      const value = await api.updateProfile(generation, patch, controller.signal)
      if (value.user_id !== userId) throw new Error('protocol_invalid')
      if (controller.signal.aborted) return false
      setState({ api, generation, userId, value, loading: false })
      return true
    } catch (cause) {
      if (!controller.signal.aborted) setState((current) => ({ ...current, api, generation, userId, loading: false, error: cause instanceof Error ? cause.message : 'local_failed' }))
      return false
    } finally { if (!controller.signal.aborted) pending.current = false }
  }, [api, generation, userId])
  const current = state?.api === api && state.generation === generation && state.userId === userId && userId ? state : undefined
  return { profile: current?.value, loading: current?.loading ?? Boolean(userId), error: current?.error, reload: load, save }
}
