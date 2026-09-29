import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DockerCapability, DockerResourceKind, DockerResourceList, DockerResourceDetail,
  DockerResourceActionRequest, DockerResourceCreateRequest, DockerResourceActionResult,
} from '#entities/docker'
import type { DockerGateway, DockerSessionContext } from './contracts'

interface State {
  source?: DockerGateway
  sessionId: string
  capability: DockerCapability | null
  capabilityAt: number
  list: DockerResourceList | null
  listAt: number
  detail: DockerResourceDetail | null
  detailAt: number
  selectedRef: string
  search: string
  query: string
  offset: number
  loading: boolean
  detailLoading: boolean
  error: string
  detailError: string
  actionError: string
}
const empty: State = {
  sessionId: '', capability: null, capabilityAt: 0, list: null, listAt: 0, detail: null, detailAt: 0,
  selectedRef: '', search: '', query: '', offset: 0, loading: false, detailLoading: false,
  error: '', detailError: '', actionError: '',
}
const cacheLifetime = 60_000
const maxCachedScopes = 12
const pageSize = 100
const fresh = (at: number) => at > 0 && Date.now() - at < cacheLifetime

export function useDockerResources(
  api: DockerGateway, session: DockerSessionContext | null, kind: DockerResourceKind, enabled: boolean,
  invalidationRevision = 0, onContainersChanged?: (sessionId: string) => void,
) {
  const id = session?.id ?? ''
  const scope = `${id}:${kind}`
  const supported = Boolean(id && session?.kind === 'ssh' && session.status === 'connected')
  const cache = useRef(new Map<string, State>())
  const [states, setStates] = useState(cache.current)
  const [busyScopes, setBusyScopes] = useState<ReadonlySet<string>>(new Set())
  const pending = useRef(new Set<string>())
  const generations = useRef(new Map<string, number>())
  const observedRevisions = useRef(new Map<string, number>())
  const listRequest = useRef<AbortController | null>(null)
  const detailRequest = useRef<AbortController | null>(null)
  const current = useRef({ scope, api, enabled, supported })
  const mounted = useRef(false)
  current.current = { scope, api, enabled, supported }
  const active = useCallback(() => mounted.current && current.current.api === api && current.current.scope === scope && current.current.enabled && current.current.supported, [api, scope])
  const getState = useCallback(() => {
    const value = cache.current.get(scope)
    return value?.source === api ? value : empty
  }, [api, scope])
  const publish = useCallback(() => {
    if (mounted.current) setStates(new Map(cache.current))
  }, [])
  const write = useCallback((key: string, patch: Partial<State>) => {
    const previous = cache.current.get(key)
    const next = { ...(previous?.source === api ? previous : empty), ...patch, source: api, sessionId: id }
    cache.current.delete(key)
    cache.current.set(key, next)
    // 每个范围仅保留一页列表和最近一个详情，写入中的范围不参与淘汰。
    for (const candidate of cache.current.keys()) {
      if (cache.current.size <= maxCachedScopes) break
      if (candidate !== current.current.scope && !pending.current.has(candidate)) cache.current.delete(candidate)
    }
    publish()
  }, [api, id, publish])
  const update = useCallback((patch: Partial<State>) => { if (active()) write(scope, patch) }, [active, scope, write])

  const refresh = useCallback(async (query?: string, offset?: number, forceCapability = false) => {
    if (!active()) return
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    const previous = getState()
    const nextQuery = query ?? previous.query
    const nextOffset = offset ?? previous.offset
    update({ loading: true, error: '', query: nextQuery, offset: nextOffset, listAt: 0 })
    try {
      const shared = [...cache.current.values()].find((value) => value.source === api && value.sessionId === id && fresh(value.capabilityAt))
      const capability = !forceCapability && shared?.capability
        ? shared.capability : await api.sessionDockerCapability(id, { signal: controller.signal })
      if (!active() || controller.signal.aborted) return
      const capabilityAt = !forceCapability && shared?.capability ? shared.capabilityAt : Date.now()
      // 能力属于会话；一次新探测同时更新其他模式，不能继续展示已失效的可操作资源。
      for (const [key, value] of cache.current) {
        if (value.source !== api || value.sessionId !== id) continue
        cache.current.set(key, {
          ...value, capability, capabilityAt,
          ...(!capability.available ? { list: null, listAt: 0, detail: null, detailAt: 0, selectedRef: '', detailLoading: false, detailError: '' } : {}),
        })
      }
      publish()
      if (!capability.available) { detailRequest.current?.abort(); return }
      let list = await api.sessionDockerResources(id, kind, { query: nextQuery, offset: nextOffset, limit: pageSize }, { signal: controller.signal })
      if (!active() || controller.signal.aborted) return
      // 删除或外部变更可能使末页消失；只回退一次，避免远端持续变化时循环读取。
      if (nextOffset > 0 && list.items.length === 0 && list.filtered <= nextOffset) {
        const fallbackOffset = Math.max(0, Math.floor((list.filtered - 1) / pageSize) * pageSize)
        update({ offset: fallbackOffset })
        list = list.filtered === 0 ? { ...list, offset: 0 }
          : await api.sessionDockerResources(id, kind, { query: nextQuery, offset: fallbackOffset, limit: pageSize }, { signal: controller.signal })
      }
      if (!controller.signal.aborted) update({ list, listAt: Date.now(), offset: list.offset })
    } catch (error) {
      if (!controller.signal.aborted) update({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (!controller.signal.aborted) update({ loading: false })
    }
  }, [active, api, getState, id, kind, publish, update])

  const select = useCallback(async (ref: string, force = false) => {
    if (!active()) return
    detailRequest.current?.abort()
    const previous = getState()
    const detail = previous.detail?.resource.id === ref ? previous.detail : null
    const cached = detail && !force && fresh(previous.detailAt)
    update({ selectedRef: ref, ...(ref ? { detail } : {}), detailLoading: Boolean(ref && !cached), detailError: '', ...(!force ? { actionError: '' } : {}) })
    if (!ref || cached) return
    const controller = new AbortController()
    detailRequest.current = controller
    try {
      const result = await api.sessionDockerResourceDetail(id, kind, ref, { signal: controller.signal })
      if (!controller.signal.aborted) update({ detail: result, detailAt: Date.now() })
    } catch (error) {
      if (!controller.signal.aborted) update({ detailError: error instanceof Error ? error.message : String(error), detailAt: 0 })
    } finally {
      if (!controller.signal.aborted) update({ detailLoading: false })
    }
  }, [active, api, getState, id, kind, update])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const entries = cache.current
    for (const [key, value] of entries) {
      if (value.source !== api || (value.sessionId === id && !supported)) entries.delete(key)
    }
    if (!supported) generations.current.set(id, (generations.current.get(id) ?? 0) + 1)
    const invalidated = (observedRevisions.current.get(id) ?? 0) !== invalidationRevision
    observedRevisions.current.set(id, invalidationRevision)
    if (invalidated) {
      for (const [key, value] of entries) {
        if (value.sessionId === id) entries.set(key, { ...value, listAt: 0, detailAt: 0 })
      }
    }
    publish()
    if (enabled && supported) {
      const value = getState()
      if (!value.list || !fresh(value.listAt)) void refresh()
      if (value.selectedRef && (!value.detail || !fresh(value.detailAt))) void select(value.selectedRef, true)
    }
    return () => {
      listRequest.current?.abort()
      detailRequest.current?.abort()
      const value = entries.get(scope)
      if (value) entries.set(scope, { ...value, loading: false, detailLoading: false })
    }
  }, [api, enabled, getState, id, invalidationRevision, publish, refresh, scope, select, supported])

  const mutate = useCallback(async (operation: () => Promise<DockerResourceActionResult>, removedRef?: string) => {
    if (!active() || !getState().capability?.available || pending.current.has(scope)) return false
    const generation = generations.current.get(id) ?? 0
    pending.current.add(scope)
    setBusyScopes(new Set(pending.current))
    update({ actionError: '' })
    let success = false
    try {
      await operation()
      success = true
      return true
    } catch (error) {
      if (mounted.current && current.current.api === api && generation === (generations.current.get(id) ?? 0)) {
        write(scope, { actionError: error instanceof Error ? error.message : String(error) })
      }
      return false
    } finally {
      // 成败均可能改变远端；隐藏范围标记失效，下一次展示再读取，不重放写操作。
      if (mounted.current && current.current.api === api) {
        if (current.current.scope === scope) {
          listRequest.current?.abort()
          detailRequest.current?.abort()
        }
        const value = cache.current.get(scope)
        if (value) {
          // 断连前的写入仍可能改变远端，但不能直接清除重连后的选择。
          const removed = success && generation === (generations.current.get(id) ?? 0) && value.detail?.resource.id === removedRef
          cache.current.set(scope, { ...value, listAt: 0, detailAt: 0, loading: false, detailLoading: false, ...(removed ? { detail: null, selectedRef: '' } : {}) })
        }
        publish()
        if (kind === 'networks') onContainersChanged?.(id)
        if (active()) {
          void refresh()
          const selectedRef = cache.current.get(scope)?.selectedRef
          if (selectedRef) void select(selectedRef, true)
        }
      }
      pending.current.delete(scope)
      if (mounted.current) setBusyScopes(new Set(pending.current))
    }
  }, [active, api, getState, id, kind, onContainersChanged, publish, refresh, scope, select, update, write])

  const state = states.get(scope)
  return {
    ...(supported && state?.source === api ? state : empty), supported, refresh, select, busy: busyScopes.has(scope),
    setSearch: (search: string) => update({ search }),
    clearActionError: () => update({ actionError: '' }),
    create: (input: DockerResourceCreateRequest) => kind === 'images' ? Promise.resolve(false) : mutate(() => api.sessionDockerResourceCreate(id, kind, input)),
    action: (ref: string, input: DockerResourceActionRequest) => mutate(() => api.sessionDockerResourceAction(id, kind, ref, input), input.action === 'remove' ? ref : undefined),
  }
}
