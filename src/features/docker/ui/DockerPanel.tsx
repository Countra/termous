import { Container, HardDrive, Layers, Network } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockerResourceKind } from '#entities/docker'
import { DockerContainersPanel, type DockerPanelProps } from './DockerContainersPanel'
import { DockerResourcesPanel } from './DockerResourcesPanel'
import styles from './DockerResources.module.scss'

export type { DockerPanelProps } from './DockerContainersPanel'

const modes = [
  { key: 'containers', icon: Container },
  { key: 'images', icon: Layers },
  { key: 'volumes', icon: HardDrive },
  { key: 'networks', icon: Network },
] as const

export function DockerPanel(props: DockerPanelProps) {
  const { t } = useTranslation()
  const id = useId()
  const [mode, setMode] = useState<'containers' | DockerResourceKind>('containers')
  const [containerRevisions, setContainerRevisions] = useState<Record<string, number>>({})
  const [resourceRevisions, setResourceRevisions] = useState<Record<string, number>>({})
  const containersChanged = useCallback((sessionId: string) => setContainerRevisions((value) => ({ ...value, [sessionId]: (value[sessionId] ?? 0) + 1 })), [])
  const resourcesChanged = useCallback((sessionId: string) => setResourceRevisions((value) => ({ ...value, [sessionId]: (value[sessionId] ?? 0) + 1 })), [])
  return <section className={styles.manager}>
    <div className={styles.modes} role="tablist" aria-label={t('workbench.docker.resources.modes')}>
      {modes.map(({ key, icon: Icon }, index) => <button key={key} type="button" role="tab" tabIndex={mode === key ? 0 : -1}
        id={`${id}-${key}`} aria-controls={`${id}-${key === 'containers' ? 'containers' : 'resources'}-panel`}
        aria-selected={mode === key} className={mode === key ? styles.selected : undefined}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % modes.length : event.key === 'ArrowLeft' ? (index + modes.length - 1) % modes.length : event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : -1
          if (next < 0) return
          event.preventDefault()
          setMode(modes[next].key)
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}
        onClick={() => setMode(key)}>
        <Icon size={14} aria-hidden="true" /><span>{t(`workbench.docker.resources.${key}`)}</span>
      </button>)}
    </div>
    <div className={styles.view} role="tabpanel" id={`${id}-containers-panel`} aria-labelledby={`${id}-containers`} hidden={mode !== 'containers'}>
      <DockerContainersPanel {...props} enabled={props.enabled && mode === 'containers'}
        invalidationRevision={containerRevisions[props.session?.id ?? ''] ?? 0} onResourcesChanged={resourcesChanged} />
    </div>
    <div className={styles.view} role="tabpanel" id={`${id}-resources-panel`} aria-labelledby={`${id}-${mode}`} hidden={mode === 'containers'}>
      <DockerResourcesPanel api={props.api} session={props.session} kind={mode === 'containers' ? 'images' : mode}
        enabled={props.enabled && mode !== 'containers'} invalidationRevision={resourceRevisions[props.session?.id ?? ''] ?? 0} onContainersChanged={containersChanged} />
    </div>
  </section>
}
