import { Alert, App, Button, Drawer, Select } from 'antd'
import { Archive, Clipboard, FolderOpen, HardDrive, ListTodo, Plus, RefreshCw, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import { TransferQueueDock, TransferQueuePanel } from '#features/transfers'
import { confirmDialogStyles, customSelectStyles } from '#shared/ui'
import { useDesktopFiles } from '../model/useDesktopFiles'
import { DesktopExchangeBrowser } from './DesktopExchangeBrowser'
import { DesktopFileClipboard } from './DesktopFileClipboard'
import { DesktopDirectoryMappings } from './DesktopDirectoryMappings'
import { DesktopRetainedFiles } from './DesktopRetainedFiles'
import { DesktopSharePath } from './DesktopSharePath'
import styles from './DesktopFilesPanel.module.scss'

export function DesktopFilesPanel({ api, session, viewer, onClose }: {
  api: DesktopFilesGateway; session?: RemoteDesktopSession | null; viewer?: RemoteDesktopViewerState; onClose: () => void
}) {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const rdp = session?.protocol === 'rdp' ? session : undefined
  const operations = useDesktopFiles(api, rdp?.id, rdp?.connection_generation ?? 0)
  const { state, retained, tasks, busy, error, run } = operations
  const [tab, setTab] = useState(rdp ? 'exchange' : 'retained')
  const [exchangeId, setExchangeId] = useState('')
  const [overwrite, setOverwrite] = useState<OverwritePolicy>('rename')
  const createOperation = useRef(crypto.randomUUID())
  const active = state?.exchanges.filter(exchange => exchange.state === 'active') ?? []
  const exchange = active.find(exchange => exchange.id === exchangeId) ?? active[0]
  const paused = state?.exchanges.filter(exchange => exchange.state === 'paused' || exchange.state === 'preparing') ?? []
  const unavailable = !!session?.remote_viewer || state?.capabilities.reason === 'desktop_files_revoking'
  const unsupported = state && !state.capabilities.exchange && !state.capabilities.file_clipboard
  const running = tasks.filter(task => task.cancellable).length
  const sections = [
    { key: 'exchange', icon: <FolderOpen size={17} />, label: t('remoteDesktop.files.exchange'), disabled: !rdp },
    { key: 'mappings', icon: <HardDrive size={17} />, label: t('remoteDesktop.files.mappings'), disabled: !rdp },
    { key: 'clipboard', icon: <Clipboard size={17} />, label: t('remoteDesktop.files.clipboard'), disabled: !rdp || !state?.capabilities.file_clipboard || unavailable },
    { key: 'retained', icon: <Archive size={17} />, label: t('remoteDesktop.files.retained'), count: retained.length },
    { key: 'tasks', icon: <ListTodo size={17} />, label: t('remoteDesktop.files.taskTitle'), count: running },
  ]
  return <Drawer open title={<div className={styles.heading}><span className={styles['heading-icon']}><FolderOpen size={20} /></span><div><strong>{t('remoteDesktop.files.workspaceTitle')}</strong><span title={rdp?.profile_name}>{rdp?.profile_name ?? t('remoteDesktop.files.retainedTitle')}</span></div></div>}
    size="min(920px, 100vw)" onClose={onClose} destroyOnHidden closeIcon={<X size={18} />} closable={{ placement: 'end', 'aria-label': t('app.close') }}
    rootClassName={styles.root} classNames={{ section: styles.panel, body: styles.body, header: styles.header, footer: styles.footer }}
    footer={<><span>{t('remoteDesktop.files.taskNote')}</span><div className={styles['conflict-field']}><span>{t('remoteDesktop.files.conflicts')}</span>
      <Select size="small" aria-label={t('remoteDesktop.files.conflicts')} value={overwrite} className={customSelectStyles.select} classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
        options={['rename', 'skip', 'overwrite'].map(value => ({ value, label: t(`remoteDesktop.files.conflict.${value === 'overwrite' ? 'replace' : value}`) }))}
        onChange={value => {
          if (value === 'overwrite') modal.confirm({ title: t('remoteDesktop.files.overwriteConfirm'), className: confirmDialogStyles.modal, rootClassName: confirmDialogStyles['modal-root'], centered: true, onOk: () => setOverwrite(value) })
          else setOverwrite(value)
        }} /></div></>}>
    <div className={styles.workspace}>
      <nav className={styles.navigation} aria-label={t('remoteDesktop.files.title')}>
        {sections.map(item => <button key={item.key} className={tab === item.key ? styles.active : ''} aria-label={item.label} aria-pressed={tab === item.key} disabled={item.disabled} onClick={() => setTab(item.key)}>
          {item.icon}<span>{item.label}</span>{!!item.count && <small aria-hidden="true">{item.count}</small>}
        </button>)}
        <div className={styles['navigation-note']}>{t('remoteDesktop.files.localOnly')}</div>
      </nav>
      <main className={styles.content}>
        <div className={styles['feedback-stack']}>
          {error && <Alert type="error" showIcon title={t(`remoteDesktop.files.errors.${error}`, { defaultValue: t('remoteDesktop.files.operationFailed') })} description={<code>{error}</code>} />}
          {unavailable && tab !== 'retained' && tab !== 'tasks' && <Alert type="info" showIcon title={t('remoteDesktop.files.pausedTitle')} description={t('remoteDesktop.files.pausedNote')} />}
          {!unavailable && unsupported && ['exchange', 'mappings', 'clipboard'].includes(tab) && <Alert type="info" showIcon title={t(`remoteDesktop.files.errors.${state.capabilities.reason ?? 'desktop_files_unsupported'}`, { defaultValue: t('remoteDesktop.files.errors.desktop_files_unsupported') })} />}
        </div>
        {tab === 'exchange' && <section className={styles.section}>
          <div className={styles['section-heading']}><div><h3>{t('remoteDesktop.files.exchange')}</h3><p>{t('remoteDesktop.files.exchangeNote')}</p></div>
            <Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label={t('remoteDesktop.files.refresh')} disabled={busy} onClick={() => void run(() => operations.refresh())} />
          </div>
          {!unavailable && paused.map(item => <div key={item.id} className={styles['paused-exchange']}><span>{item.name}</span><Button size="small" disabled={busy} onClick={() => void run(() => api.rebindExchange(rdp!.id, rdp!.connection_generation, item))}>{t('remoteDesktop.files.resume')}</Button></div>)}
          {exchange ? <>
            {active.length > 1 && <Select aria-label={t('remoteDesktop.files.chooseExchange')} value={exchange.id} onChange={setExchangeId} options={active.map(item => ({ value: item.id, label: `${item.name} · ${item.id.slice(-6)}` }))} />}
            {exchange.target_path && <DesktopSharePath path={exchange.target_path} />}
            <DesktopExchangeBrowser key={`${exchange.id}:${exchange.resource_generation}`} api={api} exchange={exchange} operations={operations} overwrite={overwrite} blocked={unavailable} />
          </> : <div className={styles.empty}><FolderOpen size={36} /><h3>{t('remoteDesktop.files.exchangeEmpty')}</h3><p>{t('remoteDesktop.files.exchangeEmptyHint')}</p>
            <Button type="primary" icon={<Plus size={15} />} loading={busy} disabled={!state?.capabilities.exchange || unavailable} onClick={() => void run(async () => { const value = await api.createExchange(rdp!.id, rdp!.connection_generation, createOperation.current); setExchangeId(value.id) })}>{t('remoteDesktop.files.openExchange')}</Button>
          </div>}
        </section>}
        {tab === 'mappings' && rdp && <DesktopDirectoryMappings api={api} session={rdp} operations={operations} unavailable={unavailable} />}
        {tab === 'clipboard' && rdp && <DesktopFileClipboard key={`${rdp.id}:${rdp.connection_generation}:${viewer?.controlLease?.generation ?? 0}`} api={api} session={rdp} viewer={viewer} operations={operations} overwrite={overwrite} />}
        {tab === 'retained' && <DesktopRetainedFiles api={api} operations={operations} overwrite={overwrite} />}
        {tab === 'tasks' && <section className={styles.section}>
          <div className={styles['section-heading']}><div><h3>{t('remoteDesktop.files.taskTitle')}</h3><p>{t('remoteDesktop.files.taskNote')}</p></div></div>
          <TransferQueueDock className={styles.tasks}><TransferQueuePanel transfers={tasks} liveConnected={false} onRefresh={() => operations.refresh()}
            onCancel={async id => { await run(() => api.cancelTask(id)) }} onDelete={id => run(() => api.cancelTask(id))} onRetry={async id => { await run(() => api.retryTask(id)) }} /></TransferQueueDock>
        </section>}
      </main>
    </div>
  </Drawer>
}
