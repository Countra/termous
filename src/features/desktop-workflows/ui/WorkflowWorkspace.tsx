import { Alert, Button } from 'antd'
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DetachedAppearance } from '#common/contracts'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import { DetachedStatePublisher, finishDetachedMotion, useDetachedOwner } from '#shared/detached-window'
import { DetachedWindowButton, DetachedWindowPlaceholder, detachedWindowStyles as styles } from '#shared/ui'
import { WorkflowController } from '../model/workspace/WorkflowController'
import { workflowFailure } from '../model/workspace/types'
import { useWorkflowData } from '../model/useWorkflowData'
import { WorkflowSurfaceAdapter } from '../model/window/WorkflowSurfaceAdapter'
import { useWorkflowComposition } from '../model/window/useWorkflowComposition'
import { WorkflowWorkspaceView } from './WorkflowWorkspaceView'

const identity = { module: 'desktop-workflow', instance: 'workspace' }
export interface WorkflowWorkspaceProps {
  gateway: WorkflowGateway; sessions: RemoteDesktopSession[]; profiles: RemoteDesktopAccessProfile[]
  activeSessionId?: string; headerActions?: ReactNode; appearance?: DetachedAppearance
  onDirtyChange: (dirty: boolean) => void; onViewDesktop: (session: string) => void | Promise<void>
  onReturnToPage?: () => Promise<boolean>; onDetachedChange?: (detached: boolean) => void
}

export function WorkflowWorkspace({ gateway, sessions, activeSessionId, profiles, headerActions, appearance,
  onDirtyChange, onViewDesktop, onReturnToPage, onDetachedChange }: WorkflowWorkspaceProps) {
  const { t, i18n } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const placeholder = useRef<HTMLElement>(null)
  const data = useWorkflowData(gateway)
  const { reload, scripts, runs, loading, error: dataError } = data
  const controller = useMemo(() => new WorkflowController(gateway), [gateway])
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const adapter = useMemo(() => new WorkflowSurfaceAdapter(controller), [controller])
  const publisher = useMemo(() => new DetachedStatePublisher(), [])
  const waitComposition = useWorkflowComposition()
  const environment = useMemo<DetachedAppearance>(() => appearance ?? {
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    language: i18n?.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en-US',
  }, [appearance, i18n?.resolvedLanguage])
  const windowState = useDetachedOwner(identity, {
    snapshot: () => publisher.snapshot(), command: packet => adapter.handle(packet), retainResponse: packet => adapter.retainResponse(packet),
    prepare: async () => { await waitComposition(); await controller.settleMedia(); adapter.inputSequence = 0 },
    returned: () => {}, finishReturn: () => finishDetachedMotion(placeholder.current),
    navigate: () => onReturnToPage?.() ?? Promise.resolve(true), cancelFeedback: () => {},
  }, environment, true)
  const detached = windowState.phase === 'detached' || windowState.phase === 'returning'
  const background = windowState.phase !== 'embedded'
  const reveal = windowState.reveal
  useEffect(() => { onDetachedChange?.(background); return () => onDetachedChange?.(false) }, [background, onDetachedChange])
  useEffect(() => { onDirtyChange(model.state.dirty); return () => onDirtyChange(false) }, [model.state.dirty, onDirtyChange])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (controller.getSnapshot().state.dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [controller])
  useLayoutEffect(() => {
    controller.reload = () => { void reload() }; controller.onViewDesktop = async id => { await reveal(); await onViewDesktop(id) }
    // 独立窗口只接收选择目标所需的摘要，不传递连接配置、凭据或媒体票据。
    controller.configure({ activeSessionId,
      sessions: sessions.map(({ id, profile_name, protocol, connection_generation, status }) => ({ id, profile_name, protocol, connection_generation, status })),
      profiles: profiles.map(({ id, name, protocol }) => ({ id, name, protocol })),
    }, { scripts, runs, loading, dataError: dataError ? workflowFailure(dataError) : undefined })
  }, [controller, sessions, activeSessionId, profiles, onViewDesktop, scripts, runs, loading, dataError, reload, reveal])
  useEffect(() => { controller.execution.selectReport(model.state.selectedRun, model.state.view === 'runs') }, [controller, model.state.selectedRun, model.state.view, data.revision])
  useLayoutEffect(() => {
    if (!background) { publisher.clear(); return }
    const update = publisher.update({ state: model.state, execution: model.execution, environment: model.environment,
      scripts: model.scripts, runs: model.runs, loading: model.loading, dataError: model.dataError, target: model.target, inputSequence: adapter.inputSequence })
    if (update) windowState.publish(update)
  })
  useEffect(() => {
    if (background) return
    void adapter.media.reset().catch(() => { console.warn('[termous:workflow] 独立窗口截图观察清理失败，将由预览租约回收') })
  }, [adapter, background])
  useEffect(() => () => {
    controller.dispose()
    void adapter.media.reset().catch(() => { console.warn('[termous:workflow] 独立窗口截图观察清理失败，将由预览租约回收') })
  }, [adapter, controller])
  return <div ref={root} className={styles.surface}>
    {windowState.error && <Alert className={styles.error} type="warning" showIcon title={t('desktopWorkflow.window.failed')}
      action={<Button size="small" onClick={() => { if (background) void windowState.focus(); else void windowState.open(root.current) }}>{t(background ? 'desktopWorkflow.window.focus' : 'app.retry')}</Button>} />}
    {(!detached || windowState.restoring) && <div className={styles.content} data-motion={windowState.restoring ? 'restoring' : undefined}
      inert={windowState.restoring || windowState.phase === 'opening' && windowState.frozen}>
      <WorkflowWorkspaceView model={model} gateway={controller.media} headerActions={headerActions} onMediaTask={controller.trackMediaTask}
        windowAction={windowState.available ? <DetachedWindowButton label={t('desktopWorkflow.window.open')} busy={windowState.phase === 'opening'} onClick={() => void windowState.open(root.current)} /> : undefined} />
    </div>}
    {detached && <DetachedWindowPlaceholder ref={placeholder} capture={windowState.capture} busy={windowState.phase === 'returning'} restoring={windowState.restoring}
      title={t('desktopWorkflow.window.detached')} description={t('desktopWorkflow.window.description')} returnLabel={t('desktopWorkflow.window.returnHere')} focusLabel={t('desktopWorkflow.window.focus')}
      onReturn={() => void windowState.returnWindow(true)} onFocus={() => void windowState.focus()} />}
  </div>
}
