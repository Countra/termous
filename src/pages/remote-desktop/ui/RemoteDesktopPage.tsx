import {
  RemoteDesktopWorkspace,
  type RemoteDesktopWorkspaceProps,
} from '#widgets/remote-desktop-workspace'
import { Segmented } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import { WorkflowWorkspace } from '#features/desktop-workflows'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import styles from './RemoteDesktopPage.module.scss'

export type RemoteDesktopPageProps = RemoteDesktopWorkspaceProps & {
  workflow: WorkflowGateway
  profiles: RemoteDesktopAccessProfile[]
  onDirtyChange: (dirty: boolean) => void
}

export function RemoteDesktopPage({ workflow, profiles, onDirtyChange, ...props }: RemoteDesktopPageProps) {
  const { t } = useTranslation()
  const runtime = useRemoteDesktopRuntime()
  const [tab, setTab] = useState<'desktops' | 'scripts' | 'runs'>('desktops')
  const [workflowOpened, setWorkflowOpened] = useState(false)
  return <div className={styles.page}>
    <div className={styles.tabs}><Segmented value={tab} options={(['desktops', 'scripts', 'runs'] as const).map((value) => ({ value, label: t(`desktopWorkflow.${value}`) }))} onChange={(value) => { setTab(value); if (value !== 'desktops') setWorkflowOpened(true) }} /></div>
    <div className={styles.content} hidden={tab !== 'desktops'}><RemoteDesktopWorkspace {...props} /></div>
    {workflowOpened && <div className={styles.content} hidden={tab === 'desktops'}><WorkflowWorkspace gateway={workflow} sessions={runtime.sessions} profiles={profiles} view={tab === 'runs' ? 'runs' : 'scripts'} onViewChange={setTab} onDirtyChange={onDirtyChange} onViewDesktop={async (id) => {
      const session = runtime.sessions.find((item) => item.id === id)
      if (session?.automation_host_id) await runtime.automation?.show(id, session.connection_generation, session.automation_host_id)
      runtime.selectSession(id); setTab('desktops')
    }} /></div>}
  </div>
}
