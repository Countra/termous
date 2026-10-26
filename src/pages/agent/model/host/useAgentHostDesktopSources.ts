import { useEffect, useMemo, useState } from 'react'
import { hostDesktopTargetKey, type HostDesktopTarget } from '#common/contracts'
import type { AgentDesktopResourceState, AgentSlashCandidateCatalog } from '#entities/agent'
import type { AgentWorkspaceGateway } from '#features/agent-runtime'

export function useAgentHostDesktopSources(gateway: AgentWorkspaceGateway, enabled: boolean) {
  const [sources, setSources] = useState<HostDesktopTarget[]>([])
  useEffect(() => {
    if (!enabled || !gateway.hostDesktopSources) { setSources([]); return }
    const abort = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || abort.signal.aborted) return
      pending = true
      try {
        const next = await gateway.hostDesktopSources!(abort.signal)
        if (!abort.signal.aborted) setSources(next)
      } catch {
        // 发现失败即移除可选身份，不能继续把历史来源显示为当前可用。
        if (!abort.signal.aborted) setSources([])
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 5000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [gateway, enabled])
  return useMemo(() => {
  const current = enabled ? sources : []
  const resources: AgentDesktopResourceState[] = current.map(desktop_target => ({ kind: 'host_desktop', desktop_target, status: 'ready' }))
  const candidates: NonNullable<AgentSlashCandidateCatalog['session']['desktop']> = current.map(desktop_target => ({
    kind: 'host_desktop', resource_kind: 'desktop', desktop_target, id: hostDesktopTargetKey(desktop_target), status: 'ready', current: false,
  }))
  return { resources, candidates }
  }, [sources, enabled])
}
