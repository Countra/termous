import { Alert, Button, Spin } from 'antd'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { DetachedStateReceiver, finishDetachedMotion, settleDetachedRender, type DetachedStateFrame, type DetachedClient } from '#shared/detached-window'
import type { AgentDetachedCommandName } from '#common/contracts'
import { restoreAgentSurface } from '../model/surface/agentSurfaceProjection.ts'
import { AgentRemoteAdapter } from '../model/surface/agentRemoteAdapter.ts'
import { waitForAgentComposition, type AgentPresentation } from '../model/surface/agentPresentation.ts'
import type { AgentFeedbackSnapshot } from '../model/surface/agentFeedback.ts'
import { AgentSurfaceView } from './AgentSurfaceView.tsx'
import { AgentSurfaceFeedback } from './AgentSurfaceFeedback.tsx'
import { AgentWindowButton } from './AgentWindowButton.tsx'
import styles from './AgentWindow.module.scss'

export function DetachedAgentSurface({ client }: { client: DetachedClient }) {
  const { t } = useTranslation()
  const [partitions, setPartitions] = useState<Record<string, unknown>>()
  const [error, setError] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [ready, setReady] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [resyncKey, setResyncKey] = useState(0)
  const handoff = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const presentation = useRef<AgentPresentation>({})
  const receiver = useMemo(() => new DetachedStateReceiver(), [])
  const adapter = useMemo(() => new AgentRemoteAdapter(client, () => setError(true)), [client])
  useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot)
  useEffect(() => {
    let alive = true
    let resync: Promise<void> | undefined
    const hydrate = () => resync ??= (async () => {
      // 补快照期间仍可能收到新的断档更新；有限次重同步后保留明确的手动重试入口。
      for (let attempt = 0; attempt < 3; attempt++) {
        const value = await client.peer.request('snapshot')
        if (!alive) return
        if (receiver.accept(value as DetachedStateFrame) === 'gap') continue
        const next = receiver.snapshot()
        if (next.presentation && !ready) presentation.current = next.presentation as AgentPresentation
        setPartitions({ ...next })
        return
      }
      throw new Error('agent_state_gap')
    })().catch(() => { if (alive) setError(true) }).finally(() => { resync = undefined })
    const unsubscribe = client.subscribe(packet => {
      if (packet.kind === 'ready') { setReady(true); return }
      if (packet.kind !== 'state') return
      if ((packet.payload as { handoffFailed?: boolean })?.handoffFailed) { handoff.current++; setFrozen(false); setLeaving(false); setError(true); return }
      const status = receiver.accept(packet.payload as DetachedStateFrame)
      if (status === 'gap') void hydrate()
      else if (status === 'applied') setPartitions({ ...receiver.snapshot() })
    })
    void hydrate()
    const unhandle = client.handle(async packet => {
      if (packet.operation !== 'flush') throw new Error('agent_operation_invalid')
      const attempt = ++handoff.current
      const checkHandoff = () => {
        if (!alive || handoff.current !== attempt) throw new Error('agent_handoff_cancelled')
      }
      await waitForAgentComposition(root.current)
      checkHandoff()
      setFrozen(true)
      await adapter.flush()
      // 宿主超时取消后，迟到的输入确认不能再把仍可编辑的小窗淡出。
      checkHandoff()
      setLeaving(true)
      await settleDetachedRender()
      await finishDetachedMotion(content.current)
      checkHandoff()
      return presentation.current
    })
    return () => { alive = false; unsubscribe(); unhandle() }
  }, [adapter, client, receiver, resyncKey, ready])
  useEffect(() => { if (partitions && !ready) client.ready() }, [client, partitions, ready])
  useEffect(() => {
    if (!ready) return
    const refresh = () => { void client.peer.request('command', { name: 'surface.onRefreshSetup', args: [] }).catch(() => setError(true)) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [client, ready])
  const returnWindow = async () => {
    setError(false)
    try { await client.peer.request('return', true, 120000) } catch { handoff.current++; setError(true); setFrozen(false); setLeaving(false) }
  }
  const retry = async () => {
    setError(false)
    try { await adapter.flush(); setResyncKey(key => key + 1) } catch { setError(true) }
  }
  if (!partitions) return error ? <Alert type="error" title={t('agent.window.failed')}
    action={<Button onClick={() => void retry()}>{t('app.retry')}</Button>} /> : <Spin fullscreen />
  const model = adapter.connect(restoreAgentSurface(partitions), partitions.capabilities as AgentDetachedCommandName[] ?? [], Number(partitions.inputSequence ?? 0))
  const feedback = partitions.feedback as AgentFeedbackSnapshot | undefined
  return <div className={styles.surface} ref={root}>
    {error && <Alert className={styles.error} type="warning" showIcon title={t('agent.window.failed')}
      action={<><Button size="small" onClick={() => void retry()}>{t('app.retry')}</Button><Button size="small" onClick={() => void returnWindow()}>{t('agent.window.return')}</Button></>} />}
    <div ref={content} className={styles.content} data-motion={leaving ? 'leaving' : ready ? 'entering' : undefined} inert={frozen || !ready}>
      <AgentSurfaceView model={model} presentation={presentation.current} interactive={ready && !frozen}
        windowAction={<AgentWindowButton returning onClick={() => void returnWindow()} busy={frozen} />}
        onRevealApprovals={() => { void client.peer.request('reveal').catch(() => setError(true)) }} />
      {feedback && <AgentSurfaceFeedback value={feedback} onDismiss={(id, version) => {
        void client.peer.request('command', { name: 'feedback.dismiss', args: [id, version] }).catch(() => setError(true))
      }} onAnswer={(id, accepted) => {
        void client.peer.request('command', { name: 'feedback.answer', args: [id, accepted] }).catch(() => setError(true))
      }} />}
    </div>
  </div>
}
