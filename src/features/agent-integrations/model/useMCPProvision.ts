import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import type { AgentIntegrationSource, AgentIntegrationsGateway, MCPDependency } from '#entities/agent-integrations'
import { invokeIntegration } from './nativeOperation'
import { integrationFailure } from './errors'

export type ProvisionOperation = 'enable' | 'upgrade' | 'repair'

export function useMCPProvision(source: AgentIntegrationSource, gateway: AgentIntegrationsGateway, operation: ProvisionOperation, onChanged: () => void) {
  const { t } = useTranslation()
  const [dependency, setDependency] = useState<MCPDependency | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const managed = source.mcp?.mode === 'managed_npm'
  const needsInstall = managed && (operation !== 'enable' || !source.mcp?.dependency_id)
  const poll = useCallback(async (signal: AbortSignal, initial: MCPDependency) => {
    let current = initial
    while (['resolving', 'preparing', 'verifying'].includes(current.state)) {
      signal.throwIfAborted(); setDependency(current)
      await pause(signal)
      const next = await gateway.dependency(source.id, source.revision, signal)
      if (!next || next.id !== initial.id) throw new Error(t('mcpPreparation.configChanged'))
      current = next
    }
    signal.throwIfAborted(); setDependency(current)
    if (['failed', 'cancelled', 'uncertain'].includes(current.state)) throw new Error(current.error || t('extensions.failed'))
    return current
  }, [gateway, source.id, source.revision, t])
  const perform = useCallback(async (action: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return
    const abort = new AbortController(); pending.current = abort
    setBusy(true); setError('')
    try { await action(abort.signal) }
    catch (cause) { if (!abort.signal.aborted) setError(integrationFailure(cause, t)) }
    finally { if (pending.current === abort) pending.current = null; if (!abort.signal.aborted) setBusy(false) }
  }, [t])
  const load = useCallback(() => perform(async signal => {
    if (!managed) return
    const current = await gateway.dependency(source.id, source.revision, signal)
    if (!needsInstall) { setDependency(current); return }
    const reusable = current && current.id !== source.mcp?.dependency_id && current.revision === source.revision && !['failed', 'cancelled', 'uncertain'].includes(current.state)
    const next = reusable ? current : operation === 'repair'
      ? await gateway.repairDependency(source.id, source.revision, signal)
      : await gateway.previewDependency(source.id, source.revision, signal)
    await poll(signal, next)
  }), [gateway, managed, needsInstall, operation, perform, poll, source.id, source.revision, source.mcp?.dependency_id])
  useEffect(() => {
    setDependency(null); setDone(false); setCancelling(false)
    void load()
    return () => { pending.current?.abort(); pending.current = null }
  }, [load])
  const activate = () => perform(async signal => {
    const native = getTermousBridge()?.agentIntegrations
    if (!native) throw new Error(t('extensions.desktopRequired'))
    let candidate: string | undefined
    try {
      if (needsInstall) {
        if (!dependency) throw new Error(t('mcpPreparation.notReady'))
        if (dependency.state === 'preview') await gateway.confirmDependency(source.id, source.revision, dependency.id, signal)
        const current = await gateway.dependency(source.id, source.revision, signal)
        if (!current || current.id !== dependency.id) throw new Error(t('mcpPreparation.configChanged'))
        const installed = await poll(signal, current)
        if (installed.state !== 'ready' || installed.cancel_requested) throw new Error(t('mcpPreparation.notReady'))
        candidate = installed.id
      } else if (!source.startup_confirmed) await gateway.confirmLaunch(source.id, source.revision, signal)
      const result = await invokeIntegration(native, source, 'test', signal, candidate)
      if (!candidate && !source.enabled) await gateway.enabled(source, true, signal)
      if (candidate && (!('source' in result) || !result.source)) throw new Error(t('extensions.failed'))
    } catch (cause) {
      signal.throwIfAborted()
      // 后台准备可能先完成同一候选的激活；只对账原身份，不重新安装或握手。
      if (!needsInstall || !dependency) throw cause
      const sources = await gateway.sources(signal).catch(() => undefined)
      if (!sources?.some(value => value.id === source.id && value.enabled && value.mcp?.dependency_id === dependency.id)) throw cause
    }
    signal.throwIfAborted(); setDone(true); onChanged()
  })
  const cancel = async () => {
    if (cancelling) return
    setCancelling(true)
    try { await gateway.cancelDependency(source.id, source.revision, AbortSignal.timeout(15_000)) }
    catch (cause) { setError(integrationFailure(cause, t)) }
    finally { setCancelling(false) }
  }
  return { dependency, busy, done, error, managed, needsInstall, cancelling, load, activate, cancel }
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
