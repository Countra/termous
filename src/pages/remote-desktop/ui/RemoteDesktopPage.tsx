import {
  RemoteDesktopWorkspace,
  type RemoteDesktopWorkspaceProps,
} from '#widgets/remote-desktop-workspace'
import { ArrowLeft, Workflow } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { DetachedAppearance } from '#common/contracts'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import { WorkflowWorkspace } from '#features/desktop-workflows'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import styles from './RemoteDesktopPage.module.scss'

export type RemoteDesktopPageProps = Omit<RemoteDesktopWorkspaceProps, 'tools' | 'toolsButtonRef'> & {
  workflow: WorkflowGateway
  profiles: RemoteDesktopAccessProfile[]
  onDirtyChange: (dirty: boolean) => void
  active?: boolean
  appearance?: DetachedAppearance
  workflowResetKey?: number
  onReturnToPage?: () => Promise<boolean>
  onDetachedChange?: (detached: boolean) => void
}

export function RemoteDesktopPage({ workflow, profiles, onDirtyChange, active = true, appearance, workflowResetKey, onReturnToPage, onDetachedChange, ...props }: RemoteDesktopPageProps) {
  const { t } = useTranslation()
  const runtime = useRemoteDesktopRuntime()
  const [view, setView] = useState<'desktops' | 'workflow'>('desktops')
  const [workflowOpened, setWorkflowOpened] = useState(false)
  const entry = useRef<HTMLButtonElement>(null)
  const automation = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    if (view === 'workflow') automation.current?.focus({ preventScroll: true })
    else if (workflowOpened) entry.current?.focus({ preventScroll: true })
  }, [view, workflowOpened, active])
  return <div className={styles.page}>
    <div id="remote-desktop-desktops" className={styles.content} hidden={view !== 'desktops'} inert={view !== 'desktops'}>{active && <RemoteDesktopWorkspace {...props} profiles={profiles} toolsButtonRef={entry} tools={[
      { key: 'automation', label: t('desktopWorkflow.workflow'), icon: <Workflow size={17} />, onClick: () => { setWorkflowOpened(true); setView('workflow') } },
    ]} />}</div>
    {workflowOpened && <div ref={automation} id="remote-desktop-workflow" className={styles.content} role="region" aria-label={t('desktopWorkflow.workflow')} tabIndex={-1} hidden={view !== 'workflow'} inert={view !== 'workflow'}><WorkflowWorkspace key={workflowResetKey} gateway={workflow} sessions={runtime.sessions} activeSessionId={runtime.activeSessionId ?? undefined} profiles={profiles} onDirtyChange={onDirtyChange}
      appearance={appearance} onDetachedChange={onDetachedChange} onReturnToPage={async () => {
        if (onReturnToPage && !await onReturnToPage()) return false
        setView('workflow'); return true
      }} headerActions={
      <button type="button" className={styles['workspace-link']} aria-controls="remote-desktop-desktops" onClick={() => setView('desktops')}><ArrowLeft size={14} aria-hidden="true" />{t('desktopWorkflow.backToDesktop')}</button>
    } onViewDesktop={async (id) => {
      if (onReturnToPage && !await onReturnToPage()) return
      const session = runtime.sessions.find((item) => item.id === id)
      if (session?.automation_host_id) await runtime.automation?.show(id, session.connection_generation, session.automation_host_id)
      runtime.selectSession(id); setView('desktops')
    }} /></div>}
  </div>
}
