import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudProfile, CloudProfilePatch } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { isCloudConnectionError } from '#entities/cloud'
import { useCloudReconnect } from './useCloudReconnect'

export type CloudProfileController = ReturnType<typeof useCloudProfile>
type ProfileResult = Promise<CloudProfile | undefined>
interface ProfileScope {
  api: CloudGateway
  generation: string
  userId?: string
  controller: AbortController
  read?: { controller: AbortController; result: ProfileResult }
  saving?: ProfileResult
}

export function useCloudProfile(api: CloudGateway, generation: string, userId?: string) {
  const [state, setState] = useState<{ api: CloudGateway; generation: string; userId?: string; value?: CloudProfile; loading: boolean; readError?: string; saveError?: string }>()
  const lifetime = useRef<ProfileScope | null>(null)
  const retryAttempt = useRef(0)
  const load = useCallback(async (): ProfileResult => {
    const scope = lifetime.current
    if (!userId || scope?.api !== api || scope.generation !== generation || scope.userId !== userId || scope.controller.signal.aborted) return
    // 读取共享结果；保存必须完成后再补读，绝不取消或重放写操作。
    if (scope.saving) { await scope.saving; return load() }
    if (scope.read) return scope.read.result
    const controller = new AbortController()
    setState((current) => ({ ...current, api, generation, userId, loading: true, readError: undefined }))
    const result = Promise.resolve().then(async () => {
      if (scope.controller.signal.aborted) return
      try {
        if (controller.signal.aborted) return scope.read?.result
        const value = await api.profile(generation, controller.signal)
        if (scope.controller.signal.aborted) return
        if (controller.signal.aborted) return scope.read?.result
        if (value.user_id !== userId) throw new Error('protocol_invalid')
        retryAttempt.current = 0
        setState((current) => ({ ...current, api, generation, userId, value, loading: false, readError: undefined }))
        return value
      } catch (cause) {
        if (scope.controller.signal.aborted) return
        if (controller.signal.aborted) return scope.read?.result
        setState((current) => ({ ...current, api, generation, userId, loading: false, readError: cause instanceof Error ? cause.message : 'local_failed' }))
      } finally {
        if (scope.read?.controller === controller) scope.read = undefined
      }
    })
    scope.read = { controller, result }
    return result
  }, [api, generation, userId])
  useEffect(() => {
    const controller = new AbortController()
    // 旧页面留下的回调也必须核对归属，不能借用新连接的 AbortController 发出请求。
    const scope: ProfileScope = { api, generation, userId, controller }
    lifetime.current = scope
    retryAttempt.current = 0
    setState(undefined)
    void load()
    return () => { controller.abort(); scope.read?.controller.abort() }
  }, [api, generation, userId, load])
  const reconnect = useCallback(() => {
    const scope = lifetime.current
    if (scope?.api !== api || scope.generation !== generation || scope.userId !== userId || scope.controller.signal.aborted) return
    // 失联前的 GET 可能仍在等待超时，恢复后应立即重新读取。
    scope.read?.controller.abort()
    scope.read = undefined
    void load()
  }, [api, generation, userId, load])
  useCloudReconnect(api, generation, reconnect)
  const save = useCallback(async (patch: CloudProfilePatch): ProfileResult => {
    const scope = lifetime.current
    if (!userId || scope?.api !== api || scope.generation !== generation || scope.userId !== userId || scope.controller.signal.aborted || scope.read || scope.saving) return
    const { controller } = scope
    setState((current) => ({ ...current, api, generation, userId, loading: true, saveError: undefined }))
    const result = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      try {
        const value = await api.updateProfile(generation, patch, controller.signal)
        if (value.user_id !== userId) throw new Error('protocol_invalid')
        if (controller.signal.aborted) return
        retryAttempt.current = 0
        setState({ api, generation, userId, value, loading: false })
        return value
      } catch (cause) {
        if (!controller.signal.aborted) setState((current) => ({ ...current, api, generation, userId, loading: false, saveError: cause instanceof Error ? cause.message : 'local_failed' }))
      } finally { scope.saving = undefined }
    })
    scope.saving = result
    return result
  }, [api, generation, userId])
  const reload = useCallback(async () => {
    const value = await load()
    if (value) setState((current) => current?.api === api && current.generation === generation && current.userId === userId ? { ...current, saveError: undefined } : current)
    return value
  }, [api, generation, userId, load])
  const current = state?.api === api && state.generation === generation && state.userId === userId && userId ? state : undefined
  useEffect(() => {
    // 只补偿读取；后台恢复不能清除失败的保存反馈，更不能重放写入。
    if (!current || current.loading || !isCloudConnectionError(current.readError)) return
    const retry = () => { retryAttempt.current = Math.min(retryAttempt.current + 1, 5); void load() }
    const timer = window.setTimeout(retry, Math.min(2000 * 2 ** retryAttempt.current, 60_000))
    window.addEventListener('online', retry)
    return () => { window.clearTimeout(timer); window.removeEventListener('online', retry) }
  }, [current, load])
  return { profile: current?.value, loading: current?.loading ?? Boolean(userId), error: current?.saveError ?? current?.readError, reload, save }
}
