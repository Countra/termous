import { Alert } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { DetachedAppearance } from '#common/contracts'
import { DetachedStatePublisher, finishDetachedMotion, useDetachedOwner } from '#shared/detached-window'
import { AgentWorkspaceHost } from './AgentWorkspaceHost.tsx'
import { AgentSurfaceView } from './AgentSurfaceView.tsx'
import { AgentWindowButton } from './AgentWindowButton.tsx'
import { AgentDetachedPlaceholder } from './AgentDetachedPlaceholder.tsx'
import { AgentSurfaceFeedback } from './AgentSurfaceFeedback.tsx'
import { AgentFeedbackStore } from '../model/surface/agentFeedback.ts'
import { AgentSurfaceAdapter } from '../model/surface/agentSurfaceAdapter.ts'
import { projectAgentSurface } from '../model/surface/agentSurfaceProjection.ts'
import { waitForAgentComposition, type AgentPresentation } from '../model/surface/agentPresentation.ts'
import type { AgentSurfaceModel } from '../model/surface/agentSurfaceModel.ts'
import styles from './AgentWindow.module.scss'

const identity = { module: 'agent', instance: 'workspace' }
type Props = Omit<ComponentProps<typeof AgentWorkspaceHost>, 'renderSurface' | 'feedback'> & {
  onReturnToPage?: () => Promise<boolean>
  onDetachedChange?: (detached: boolean) => void
  appearance?: DetachedAppearance
}

export function AgentPage({ onReturnToPage, onDetachedChange, appearance, ...props }: Props) {
  const { t, i18n } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const placeholder = useRef<HTMLElement>(null)
  const feedback = useMemo(() => new AgentFeedbackStore(), [])
  const notices = useSyncExternalStore(feedback.subscribe, feedback.getSnapshot, feedback.getSnapshot)
  const translate = useRef(t)
  translate.current = t
  const adapter = useMemo(() => new AgentSurfaceAdapter(feedback, () => translate.current('agent.attachments.failed')), [feedback])
  const publisher = useMemo(() => new DetachedStatePublisher(), [])
  const presentation = useRef<AgentPresentation>({})
  const environment = useMemo<DetachedAppearance>(() => appearance ?? {
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    language: i18n?.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en-US',
  }, [appearance, i18n?.resolvedLanguage])
  const window = useDetachedOwner(identity, {
    snapshot: () => publisher.snapshot(), command: packet => adapter.handle(packet),
    retainResponse: packet => adapter.retainResponse(packet),
    prepare: async () => { await waitForAgentComposition(root.current); feedback.cancel(); adapter.inputSequence = 0 },
    returned: value => { if (value && typeof value === 'object') presentation.current = value as AgentPresentation },
    finishReturn: () => finishDetachedMotion(placeholder.current),
    navigate: () => onReturnToPage?.() ?? Promise.resolve(true), cancelFeedback: () => feedback.cancel(),
  }, environment, !props.remote)
  const detached = window.phase === 'detached' || window.phase === 'returning'
  useEffect(() => { onDetachedChange?.(detached); return () => onDetachedChange?.(false) }, [detached, onDetachedChange])
  const focus = window.focus
  useEffect(() => {
    if (detached && (props.launchIntent || props.notificationSessionId)) void focus()
  }, [detached, props.launchIntent, props.notificationSessionId, focus])
  const renderSurface = useCallback((model: AgentSurfaceModel) => <SurfacePublication model={model}
    adapter={adapter} publisher={publisher} feedback={feedback} presentation={presentation.current} publish={window.publish}
    publishing={window.phase !== 'embedded'}>
    {(!detached || window.restoring) && <div className={styles.content} data-motion={window.restoring ? 'restoring' : undefined}
      inert={window.restoring || window.phase === 'opening' && window.frozen}>
        <AgentSurfaceView model={model} presentation={presentation.current} interactive={!window.restoring}
          windowAction={window.available ? <AgentWindowButton busy={window.phase === 'opening'} onClick={() => void window.open(root.current)} /> : undefined} />
        <AgentSurfaceFeedback value={notices} onAnswer={(id, accepted) => feedback.answer(id, accepted)} onDismiss={(id, version) => feedback.dismiss(id, version)} />
      </div>}
    {detached && <AgentDetachedPlaceholder ref={placeholder} capture={window.capture} busy={window.phase === 'returning'}
      restoring={window.restoring} onReturn={() => void window.returnWindow(true)} onFocus={() => void window.focus()} />}
  </SurfacePublication>, [adapter, detached, feedback, notices, publisher, window])
  const openSettings = () => { void window.reveal(); props.onOpenSettings?.() }
  return <div className={styles.surface} ref={root}>
    {window.error && <Alert className={styles.error} type="warning" showIcon closable title={t('agent.window.failed')} />}
    <AgentWorkspaceHost {...props} active={props.active || detached || window.phase === 'opening'}
      backgroundActive={detached}
      feedback={feedback} onOpenSettings={props.onOpenSettings ? openSettings : undefined} renderSurface={renderSurface} />
  </div>
}

function SurfacePublication({ model, adapter, publisher, feedback, presentation, publish, publishing, children }: {
  model: AgentSurfaceModel; adapter: AgentSurfaceAdapter; publisher: DetachedStatePublisher; feedback: AgentFeedbackStore;
  presentation: AgentPresentation; publish: (value: unknown) => void; publishing: boolean; children: import('react').ReactNode
}) {
  useLayoutEffect(() => {
    adapter.model = model
    // 嵌入和远控页面无需序列化整段历史；收回后及时释放独立窗口的投影副本。
    if (!publishing) { publisher.clear(); return }
    const update = publisher.update({ ...projectAgentSurface(model), inputSequence: adapter.inputSequence,
      feedback: feedback.getSnapshot(), presentation: structuredClone(presentation) })
    if (update) publish(update)
  })
  return children
}
