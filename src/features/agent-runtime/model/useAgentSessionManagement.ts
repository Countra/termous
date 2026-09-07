import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentSession, AgentSessionMetadataInput, AgentSessionMoveInput } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { loadAgentSessions } from '../runtime/loadAgentSessions.ts'

export function useAgentSessionManagement(
  controller: AgentWorkspaceController,
  gateway: AgentWorkspaceGateway,
  sessions: AgentSession[],
  enabled: boolean,
) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const pending = useRef(new Set<string>())
  const [query, setQuery] = useState('')
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState<{ query: string; items: AgentSession[]; loading: boolean; error?: string }>({ query: '', items: [], loading: false })
  const reloadSearch = useCallback(() => setRetry((value) => value + 1), [])

  useEffect(() => {
    if (!enabled || !query.trim()) return
    const abort = new AbortController()
    const requested = query.trim()
    const timer = setTimeout(() => {
      setSearch({ query: requested, items: [], loading: true })
      void loadAgentSessions(gateway, { archived: false, query: requested, signal: abort.signal }).then(
        (items) => { if (!abort.signal.aborted) setSearch({ query: requested, items, loading: false }) },
        () => { if (!abort.signal.aborted) setSearch({ query: requested, items: [], loading: false, error: 'AGENT_SESSION_SEARCH_FAILED' }) },
      )
    }, 200)
    return () => { clearTimeout(timer); abort.abort() }
  }, [enabled, gateway, query, retry, sessions])

  const perform = useCallback(async <Result,>(keys: string[], operation: () => Promise<Result>) => {
    if (keys.some((key) => pending.current.has(key))) throw new Error('AGENT_MUTATION_IN_PROGRESS')
    for (const key of keys) pending.current.add(key)
    setPendingIds(new Set(pending.current))
    try {
      const result = await operation()
      reloadSearch()
      return result
    } finally {
      for (const key of keys) pending.current.delete(key)
      setPendingIds(new Set(pending.current))
    }
  }, [reloadSearch])

  const metadata = useCallback(async (id: string, input: Omit<AgentSessionMetadataInput, 'expected_revision'>, reference?: AgentSession) => {
    const keys = [id, ...(input.group_id ? [input.group_id] : []), ...(input.pinned === undefined ? [] : ['pin-order'])]
    return perform(keys, async () => {
      const current = controller.getSnapshot().sessions.find((item) => item.id === id)
      const session = current && (!reference || current.revision >= reference.revision)
        ? current : reference ?? await gateway.session(id)
      try {
        return await controller.updateSessionMetadata(id, { ...input, expected_revision: session.revision })
      } catch (error) {
        await Promise.allSettled([controller.reloadSession(id), controller.reloadSessionGroups()])
        throw error
      }
    })
  }, [controller, gateway, perform])

  const group = useCallback((id: string) => {
    const value = controller.getSnapshot().session_groups.find((item) => item.id === id)
    if (!value) throw new Error('AGENT_SESSION_GROUP_NOT_FOUND')
    return value
  }, [controller])

  const groupOperation = useCallback(async (keys: string[], operation: () => Promise<unknown>) => {
    await perform(keys, async () => {
      try { await operation() } catch (error) {
        await Promise.allSettled([controller.reloadSessionGroups()])
        throw error
      }
    })
  }, [controller, perform])

  const move = useCallback(async (kind: 'group' | 'pin' | 'session', id: string, targetId: string, placement: AgentSessionMoveInput['placement']) => {
    const keys = [`${kind}-order`, id, targetId, ...(kind === 'session' ? ['pin-order'] : [])]
    await groupOperation(keys, async () => {
      const values = kind === 'group' ? controller.getSnapshot().session_groups : controller.getSnapshot().sessions
      const source = values.find((item) => item.id === id)
      const target = values.find((item) => item.id === targetId)
      if (!source || !target) throw new Error('AGENT_SESSION_MOVE_TARGET_MISSING')
      const input = { expected_revision: source.revision, target_id: targetId, target_expected_revision: target.revision, placement }
      if (kind === 'group') await controller.moveSessionGroup(id, input)
      else {
        try {
          if (kind === 'session') await controller.moveSession(id, input)
          else await controller.moveSessionPin(id, input)
        } catch (error) {
          await Promise.allSettled([controller.reloadSession(id), controller.reloadSession(targetId)])
          throw error
        }
      }
    })
  }, [controller, groupOperation])

  return {
    pendingIds, query, setQuery, reloadSearch, perform, metadata,
    searchResults: search.query === query.trim() ? search.items : [],
    searchLoading: Boolean(query.trim()) && (search.query !== query.trim() || search.loading),
    searchError: search.query === query.trim() ? search.error : undefined,
    createGroup: (name: string) => groupOperation(['group-create'], () => controller.createSessionGroup(name)),
    renameGroup: (id: string, name: string) => groupOperation([id], () => controller.updateSessionGroup(id, name, group(id).revision)),
    deleteGroup: (id: string) => groupOperation([id], () => controller.deleteSessionGroup(id, group(id).revision)),
    moveGroup: (id: string, targetId: string, placement: AgentSessionMoveInput['placement']) => move('group', id, targetId, placement),
    movePin: (id: string, targetId: string, placement: AgentSessionMoveInput['placement']) => move('pin', id, targetId, placement),
    moveSession: (id: string, targetId: string, placement: AgentSessionMoveInput['placement']) => move('session', id, targetId, placement),
  }
}
