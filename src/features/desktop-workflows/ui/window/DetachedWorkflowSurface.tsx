import { Alert, Button, Spin } from 'antd'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { DetachedStateReceiver, finishDetachedMotion,
  settleDetachedRender, type DetachedClient, type DetachedStateFrame } from '#shared/detached-window'
import { DetachedWindowButton, detachedWindowStyles as styles } from '#shared/ui'
import type { WorkflowSurfaceModel } from '../../model/workspace/types'
import { WorkflowRemoteAdapter } from '../../model/window/WorkflowRemoteAdapter'
import { useWorkflowComposition } from '../../model/window/useWorkflowComposition'
import { WorkflowWorkspaceView } from '../WorkflowWorkspaceView'

export function DetachedWorkflowSurface({ client }: { client: DetachedClient }) {
  const { t } = useTranslation()
  const [partitions, setPartitions] = useState<Record<string, unknown>>()
  const [error, setError] = useState<'failed' | 'syncFailed' | 'operationFailed'>()
  const [ready, setReady] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [resyncKey, setResyncKey] = useState(0)
  const content = useRef<HTMLDivElement>(null)
  const handoff = useRef(0)
  const waitComposition = useWorkflowComposition()
  const wait = useRef(waitComposition); wait.current = waitComposition
  const receiver = useMemo(() => new DetachedStateReceiver(), [])
  const adapter = useMemo(() => new WorkflowRemoteAdapter(client, () => setError('operationFailed')), [client])
  useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot)
  adapter.interactive = ready && !leaving
  useLayoutEffect(() => {
    // 对话框和菜单可能挂在 body；交接冻结必须覆盖这些 Portal 内的控件。
    document.body.inert = frozen
    return () => { document.body.inert = false }
  }, [frozen])
  useEffect(() => {
    let alive = true
    let resync: Promise<void> | undefined
    const hydrate = () => resync ??= (async () => {
      for (let attempt = 0; attempt < 3 && alive; attempt++) {
        const value = await client.peer.request('snapshot')
        if (!alive) return
        if (receiver.accept(value as DetachedStateFrame) === 'gap') continue
        setPartitions({ ...receiver.snapshot() }); return
      }
      throw new Error('workflow_state_gap')
    })().catch(() => { if (alive) setError('syncFailed') }).finally(() => { resync = undefined })
    const unsubscribe = client.subscribe(packet => {
      if (packet.kind === 'ready') { setReady(true); return }
      if (packet.kind !== 'state') return
      if ((packet.payload as { handoffFailed?: boolean })?.handoffFailed) {
        handoff.current++; setFrozen(false); setLeaving(false); setError('failed'); return
      }
      const status = receiver.accept(packet.payload as DetachedStateFrame)
      if (status === 'gap') void hydrate()
      else if (status === 'applied') setPartitions({ ...receiver.snapshot() })
    })
    const unhandle = client.handle(async packet => {
      if (packet.operation !== 'flush') throw new Error('workflow_operation_invalid')
      const attempt = ++handoff.current
      const check = () => { if (!alive || handoff.current !== attempt) throw new Error('workflow_handoff_cancelled') }
      await wait.current(); check(); setFrozen(true)
      // 等待模板接收及其草稿更新确认；执行任务本身始终由宿主持有，无需等待任务完成。
      await adapter.flush(); await settleDetachedRender(); await adapter.flush(); check()
      adapter.interactive = false; setLeaving(true)
      await settleDetachedRender(); await finishDetachedMotion(content.current); check()
      return {}
    })
    void hydrate()
    return () => { alive = false; unsubscribe(); unhandle() }
  }, [adapter, client, receiver, resyncKey])
  useEffect(() => { if (partitions && !ready) client.ready() }, [client, partitions, ready])
  const returnWindow = async () => {
    setError(undefined)
    try { await client.peer.request('return', true, 120000) }
    catch { handoff.current++; setError('failed'); setFrozen(false); setLeaving(false) }
  }
  const retry = async () => {
    setError(undefined)
    try { await adapter.flush(); setResyncKey(key => key + 1) } catch { setError('syncFailed') }
  }
  if (!partitions || !ready) return error ? <Alert type="error" title={t(`desktopWorkflow.window.${error}`)}
    action={<Button onClick={() => void retry()}>{t('app.reload')}</Button>} /> : <Spin fullscreen />
  const { inputSequence, ...projection } = partitions
  const model = adapter.connect(projection as unknown as Omit<WorkflowSurfaceModel, 'actions'>, Number(inputSequence ?? 0))
  return <div className={styles.surface}>
    {error && <Alert className={styles.error} type="warning" showIcon title={t(`desktopWorkflow.window.${error}`)}
      action={<><Button size="small" onClick={() => void retry()}>{t('app.reload')}</Button><Button size="small" onClick={() => void returnWindow()}>{t('desktopWorkflow.window.return')}</Button></>} />}
    <div ref={content} className={styles.content} data-motion={leaving ? 'leaving' : 'entering'} inert={frozen}>
      <WorkflowWorkspaceView model={model} gateway={adapter.media} onMediaTask={adapter.trackMediaTask}
        windowAction={<DetachedWindowButton label={t('desktopWorkflow.window.return')} returning busy={frozen} onClick={() => void returnWindow()} />} />
    </div>
  </div>
}
