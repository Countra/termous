import { Dropdown, type MenuProps } from 'antd'
import { ChevronDown, FolderOpen, MonitorPlay, Wrench } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { contextActionMenuPopupClassName } from '#shared/ui'
import styles from './RemoteDesktopWorkspaceActions.module.scss'

export interface RemoteDesktopWorkspaceTool {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
}

interface Props {
  retainedSessions: RemoteDesktopSession[]
  onSelectSession: (id: string) => void
  onOpenFiles?: () => void
  tools?: RemoteDesktopWorkspaceTool[]
  toolsButtonRef?: Ref<HTMLButtonElement>
}

export function RemoteDesktopWorkspaceActions({ retainedSessions, onSelectSession, onOpenFiles, tools = [], toolsButtonRef }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<'retained' | 'tools'>()
  const retainedTrigger = useRef<HTMLButtonElement>(null)
  const toolsTrigger = useRef<HTMLButtonElement>(null)
  const setToolsTrigger = useCallback((node: HTMLButtonElement | null) => {
    toolsTrigger.current = node
    if (typeof toolsButtonRef === 'function') return toolsButtonRef(node)
    if (toolsButtonRef) toolsButtonRef.current = node
  }, [toolsButtonRef])
  const actions: RemoteDesktopWorkspaceTool[] = [
    ...(onOpenFiles ? [{ key: 'files', label: t('remoteDesktop.tools.files'), icon: <FolderOpen size={16} />, onClick: onOpenFiles }] : []),
    ...tools,
  ]
  const toolItems: MenuProps['items'] = actions.map((action) => ({
    key: action.key,
    icon: <span className={styles['menu-icon']}>{action.icon}</span>,
    label: action.label,
  }))
  const retainedItems: MenuProps['items'] = retainedSessions.map((session) => ({
    key: session.id,
    icon: <span className={styles['session-icon']} aria-hidden="true">
      <MonitorPlay size={16} />
      <span className={styles['session-dot']} data-status={session.status} />
    </span>,
    label: <span className={styles['menu-copy']}>
      <strong title={session.profile_name}>{session.profile_name}</strong>{' '}
      <span className={styles['session-meta']}>
        <span className={styles['session-protocol']}>{session.protocol.toUpperCase()}</span>{' '}
        <span className={styles['session-host']} title={session.host_name}>{session.host_name}</span>
      </span>
    </span>,
  }))
  if (!actions.length && !retainedSessions.length) return null
  return <div className={styles.actions}>
    {retainedSessions.length > 0 && <Dropdown
      trigger={['click']} placement="bottomRight" autoFocus
      open={open === 'retained'} onOpenChange={(value) => setOpen(value ? 'retained' : undefined)}
      classNames={{ root: `${contextActionMenuPopupClassName} ${styles.popup} ${styles['retained-popup']}` }}
      menu={{ items: retainedItems, 'aria-label': t('remoteDesktop.rdp.retained'), selectable: false,
        onKeyDown: (event) => { if (event.key === 'Escape') { setOpen(undefined); retainedTrigger.current?.focus() } },
        onClick: ({ key }) => { setOpen(undefined); onSelectSession(key) } }}
    >
      <button ref={retainedTrigger} type="button" className={styles.trigger} aria-label={t('remoteDesktop.tools.retainedCount', { count: retainedSessions.length })} title={t('remoteDesktop.rdp.retained')} aria-haspopup="menu" aria-expanded={open === 'retained'} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen('retained') } }}>
        <MonitorPlay size={15} aria-hidden="true" /><span className={styles['trigger-label']}>{t('remoteDesktop.rdp.retained')}</span><span className={styles.count} aria-hidden="true">{retainedSessions.length}</span><ChevronDown size={12} className={styles.chevron} aria-hidden="true" />
      </button>
    </Dropdown>}
    {actions.length > 0 && <Dropdown
      trigger={['click']} placement="bottomRight" autoFocus
      open={open === 'tools'} onOpenChange={(value) => setOpen(value ? 'tools' : undefined)}
      classNames={{ root: `${contextActionMenuPopupClassName} ${styles.popup} ${styles['tools-popup']}` }}
      menu={{ items: toolItems, 'aria-label': t('remoteDesktop.tools.title'), selectable: false,
        onKeyDown: (event) => { if (event.key === 'Escape') { setOpen(undefined); toolsTrigger.current?.focus() } },
        onClick: ({ key }) => { setOpen(undefined); actions.find((action) => action.key === key)?.onClick() } }}
    >
      <button data-tour="desktop-tools" ref={setToolsTrigger} type="button" className={styles.trigger} aria-label={t('remoteDesktop.tools.title')} title={t('remoteDesktop.tools.title')} aria-haspopup="menu" aria-expanded={open === 'tools'} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen('tools') } }}>
        <Wrench size={14} aria-hidden="true" /><span className={styles['trigger-label']}>{t('remoteDesktop.tools.title')}</span><ChevronDown size={12} className={styles.chevron} aria-hidden="true" />
      </button>
    </Dropdown>}
  </div>
}
