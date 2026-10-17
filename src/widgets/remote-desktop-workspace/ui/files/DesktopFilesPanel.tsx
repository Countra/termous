import { Alert, App, Drawer, Select } from 'antd'
import { Archive, Clipboard, FolderOpen, HardDrive, ListTodo, X } from 'lucide-react'
import { Activity, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import { isActiveTransferTask, TransferQueueDock, TransferQueuePanel } from '#features/transfers'
import { confirmDialogStyles, customSelectStyles } from '#shared/ui'
import { useDesktopFiles } from '../../model/useDesktopFiles'
import { DesktopExchangeFiles } from './DesktopExchangeFiles'
import { DesktopFileClipboard } from './DesktopFileClipboard'
import { DesktopDirectoryMappings } from './DesktopDirectoryMappings'
import { DesktopRetainedFiles } from './DesktopRetainedFiles'
import section from './DesktopFileSection.module.scss'
import styles from './DesktopFilesPanel.module.scss'

export type DesktopFilesTab = 'exchange' | 'mappings' | 'clipboard' | 'retained' | 'tasks'

export function DesktopFilesPanel({ api, session, viewer, open = true, activeTab, onTabChange, onClose }: {
  api: DesktopFilesGateway; session?: RemoteDesktopSession | null; viewer?: RemoteDesktopViewerState; open?: boolean; onClose: () => void
  activeTab?: DesktopFilesTab; onTabChange?: (tab: DesktopFilesTab) => void
}) {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const rdp = session?.protocol === 'rdp' ? session : undefined
  const operations = useDesktopFiles(api, rdp?.id, rdp?.connection_generation ?? 0, open)
  const { state, retained, tasks, error, run } = operations
  const [localTab, setLocalTab] = useState<DesktopFilesTab>(rdp ? 'exchange' : 'retained')
  const tab = activeTab ?? localTab
  const selectTab = (next: DesktopFilesTab) => { setLocalTab(next); onTabChange?.(next) }
  const [overwrite, setOverwrite] = useState<OverwritePolicy>('rename')
  const unavailable = !!session?.remote_viewer || state?.capabilities.reason === 'desktop_files_revoking'
  const unsupported = state && !state.capabilities.exchange && !state.capabilities.file_clipboard && !state.capabilities.directory_mapping
  const running = tasks.filter(isActiveTransferTask).length
  const sections = [
    { key: 'exchange', icon: <FolderOpen size={16} />, label: t('remoteDesktop.files.exchange'), disabled: !rdp },
    { key: 'mappings', icon: <HardDrive size={16} />, label: t('remoteDesktop.files.mappings'), disabled: !rdp },
    { key: 'clipboard', icon: <Clipboard size={16} />, label: t('remoteDesktop.files.clipboard'), disabled: !rdp || !state?.capabilities.file_clipboard || unavailable },
    { key: 'retained', icon: <Archive size={16} />, label: t('remoteDesktop.files.retained'), count: retained.length },
    { key: 'tasks', icon: <ListTodo size={16} />, label: t('remoteDesktop.files.taskTitle'), count: running },
  ] satisfies { key: DesktopFilesTab; icon: React.ReactNode; label: string; disabled?: boolean; count?: number }[]
  return <Drawer open={open} title={<div className={styles.heading}><FolderOpen size={20} /><strong>{t('remoteDesktop.files.workspaceTitle')}</strong><span title={rdp?.profile_name}>{rdp?.profile_name ?? t('remoteDesktop.files.retainedTitle')}</span></div>}
    size="min(820px, 100vw)" onClose={onClose} closeIcon={<X size={18} />} closable={{ placement: 'end', 'aria-label': t('app.close') }}
    classNames={{ section: styles.panel, body: styles.body, header: styles.header, footer: styles.footer }}
    footer={<><span>{t('remoteDesktop.files.taskNote')}</span>{['exchange', 'clipboard', 'retained'].includes(tab) && <label className={styles['conflict-field']}><span>{t('remoteDesktop.files.conflicts')}</span>
      <Select size="small" aria-label={t('remoteDesktop.files.conflicts')} value={overwrite} className={customSelectStyles.select} classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
        options={['rename', 'skip', 'overwrite'].map(value => ({ value, label: t(`remoteDesktop.files.conflict.${value === 'overwrite' ? 'replace' : value}`) }))}
        onChange={value => {
          if (value === 'overwrite') modal.confirm({ title: t('remoteDesktop.files.overwriteConfirm'), className: confirmDialogStyles.modal, rootClassName: confirmDialogStyles['modal-root'], centered: true, onOk: () => setOverwrite(value) })
          else setOverwrite(value)
        }} /></label>}</>}>
    {/* 缓存内容状态并在隐藏时清理副作用；抽屉本身保持挂载，避免动画恢复时重建文件列表。 */}
    <Activity mode={open ? 'visible' : 'hidden'}><div className={styles.workspace}>
      <nav className={styles.navigation} aria-label={t('remoteDesktop.files.title')}>
        {sections.map(item => <button key={item.key} className={tab === item.key ? styles.active : ''} aria-label={item.label} aria-pressed={tab === item.key} disabled={item.disabled} onClick={() => selectTab(item.key)}>
          {item.icon}<span>{item.label}</span>{!!item.count && <small aria-hidden="true">{item.count}</small>}
        </button>)}
      </nav>
      <main className={styles.content}>
        <div className={styles.feedback}>
          {error && <Alert type="error" showIcon title={t(`remoteDesktop.files.errors.${error}`, { defaultValue: t('remoteDesktop.files.operationFailed') })} description={<code>{error}</code>} />}
          {unavailable && !['retained', 'tasks'].includes(tab) && <Alert type="info" showIcon title={t('remoteDesktop.files.pausedTitle')} description={t('remoteDesktop.files.pausedNote')} />}
          {!unavailable && unsupported && ['exchange', 'mappings', 'clipboard'].includes(tab) && <Alert type="info" showIcon title={t(`remoteDesktop.files.errors.${state.capabilities.reason ?? 'desktop_files_unsupported'}`, { defaultValue: t('remoteDesktop.files.errors.desktop_files_unsupported') })} />}
        </div>
        {tab === 'exchange' && rdp && <DesktopExchangeFiles api={api} session={rdp} operations={operations} overwrite={overwrite} unavailable={unavailable} />}
        {tab === 'mappings' && rdp && <DesktopDirectoryMappings api={api} session={rdp} operations={operations} unavailable={unavailable} />}
        {tab === 'clipboard' && rdp && <DesktopFileClipboard key={`${rdp.id}:${rdp.connection_generation}:${viewer?.controlLease?.generation ?? 0}`} api={api} session={rdp} viewer={viewer} operations={operations} overwrite={overwrite} />}
        {tab === 'retained' && <DesktopRetainedFiles api={api} operations={operations} overwrite={overwrite} />}
        {tab === 'tasks' && <section className={section.section}>
          <div className={section.heading}><div><h3>{t('remoteDesktop.files.taskTitle')}</h3></div></div>
          <TransferQueueDock className={styles.tasks}><TransferQueuePanel transfers={tasks} liveConnected={operations.liveConnected} onRefresh={() => operations.refresh()}
            onCancel={async id => { await run(() => api.cancelTask(id)) }} onDelete={id => run(() => api.cancelTask(id))} onRetry={async id => { await run(() => api.retryTask(id)) }} /></TransferQueueDock>
        </section>}
      </main>
    </div></Activity>
  </Drawer>
}
