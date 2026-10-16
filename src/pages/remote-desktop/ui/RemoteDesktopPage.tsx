import {
  RemoteDesktopWorkspace,
  type RemoteDesktopWorkspaceProps,
} from '#widgets/remote-desktop-workspace'
import { ArrowLeft, Workflow } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import { WorkflowWorkspace } from '#features/desktop-workflows'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import styles from './RemoteDesktopPage.module.scss'

export type RemoteDesktopPageProps = Omit<RemoteDesktopWorkspaceProps, 'tools' | 'toolsButtonRef'> & {
  workflow: WorkflowGateway
  profiles: RemoteDesktopAccessProfile[]
  onDirtyChange: (dirty: boolean) => void
}

export function RemoteDesktopPage({ workflow, profiles, onDirtyChange, ...props }: RemoteDesktopPageProps) {
  const { t } = useTranslation()
  const runtime = useRemoteDesktopRuntime()
  const [view, setView] = useState<'desktops' | 'workflow'>('desktops')
  const [workflowOpened, setWorkflowOpened] = useState(false)
  const entry = useRef<HTMLButtonElement>(null)
  const automation = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view === 'workflow') automation.current?.focus({ preventScroll: true })
    else if (workflowOpened) entry.current?.focus({ preventScroll: true })
  }, [view, workflowOpened])
  return <div className={styles.page}>
    <div id="remote-desktop-desktops" className={styles.content} hidden={view !== 'desktops'} inert={view !== 'desktops'}><RemoteDesktopWorkspace {...props} toolsButtonRef={entry} tools={[
      { key: 'automation', label: t('desktopWorkflow.workflow'), icon: <Workflow size={17} />, onClick: () => { setWorkflowOpened(true); setView('workflow') } },
    ]} /></div>
    {workflowOpened && <div ref={automation} id="remote-desktop-workflow" className={styles.content} role="region" aria-label={t('desktopWorkflow.workflow')} tabIndex={-1} hidden={view !== 'workflow'} inert={view !== 'workflow'}><WorkflowWorkspace gateway={workflow} sessions={runtime.sessions} activeSessionId={runtime.activeSessionId ?? undefined} profiles={profiles} onDirtyChange={onDirtyChange} headerActions={
      <button type="button" className={styles['workspace-link']} aria-controls="remote-desktop-desktops" onClick={() => setView('desktops')}><ArrowLeft size={14} aria-hidden="true" />{t('desktopWorkflow.backToDesktop')}</button>
    } onViewDesktop={async (id) => {
      const session = runtime.sessions.find((item) => item.id === id)
      if (session?.automation_host_id) await runtime.automation?.show(id, session.connection_generation, session.automation_host_id)
      runtime.selectSession(id); setView('desktops')
    }} /></div>}
  </div>
}
