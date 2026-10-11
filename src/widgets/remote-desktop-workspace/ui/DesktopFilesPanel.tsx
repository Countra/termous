import { Alert, App, Button, Checkbox, Drawer, Empty, Popconfirm, Select, Tabs, Tag } from 'antd'
import { FolderOpen, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopExchange, RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import { TransferQueueDock, TransferQueuePanel } from '#features/transfers'
import { formatDate } from '#shared/format'
import { confirmDialogStyles, customSelectStyles, termousPopconfirmProps } from '#shared/ui'
import { useDesktopFiles } from '../model/useDesktopFiles.ts'
import { DesktopExchangeBrowser } from './DesktopExchangeBrowser.tsx'
import { DesktopFileClipboard } from './DesktopFileClipboard.tsx'
import styles from './DesktopFilesPanel.module.scss'

export function DesktopFilesPanel({ api, session, viewer, onClose }: {
  api: DesktopFilesGateway; session?: RemoteDesktopSession | null; viewer?: RemoteDesktopViewerState; onClose: () => void
}) {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const rdp = session?.protocol === 'rdp' ? session : undefined
  const operations = useDesktopFiles(api, rdp?.id, rdp?.connection_generation ?? 0)
  const { state, retained, tasks, busy, error, run, withGrant } = operations
  const [tab, setTab] = useState(rdp ? 'exchange' : 'retained')
  const [exchangeId, setExchangeId] = useState('')
  const [claim, setClaim] = useState<DesktopExchange>()
  const [overwrite, setOverwrite] = useState<OverwritePolicy>('rename')
  const createOperation = useRef(crypto.randomUUID())
  const active = state?.exchanges.filter(exchange => exchange.state === 'active') ?? []
  const exchange = active.find(exchange => exchange.id === exchangeId) ?? active[0]
  const paused = state?.exchanges.filter(exchange => exchange.state === 'paused' || exchange.state === 'preparing') ?? []
  const unavailable = !!session?.remote_viewer || state?.capabilities.reason === 'desktop_files_revoking'
  const addMapping = () => modal.confirm({ title: t('remoteDesktop.files.addMapping'), content: t('remoteDesktop.files.mappingConsent'), centered: true,
    className: confirmDialogStyles.modal, rootClassName: confirmDialogStyles['modal-root'],
    okText: t('remoteDesktop.files.selectFolder'), cancelText: t('app.cancel'),
    onOk: () => run(() => withGrant('directories', false, grant => api.mapping(rdp!.id, rdp!.connection_generation, 'add', grant))),
  })

  return <Drawer open title={<span className={styles.heading}><FolderOpen size={18} />{t('remoteDesktop.files.title')}</span>} size="min(560px, 100vw)" onClose={onClose} destroyOnHidden
    closeIcon={<X size={18} />} closable={{ placement: 'end', 'aria-label': t('app.close') }} rootClassName={styles.root} classNames={{ section: styles.panel, body: styles.body, header: styles.header, footer: styles.footer }}
    footer={<><span>{t('remoteDesktop.files.taskNote')}</span><Button type="text" size="small" icon={<RefreshCw size={14} />} disabled={busy} onClick={() => void run(() => operations.refresh())}>{t('remoteDesktop.files.refresh')}</Button></>}>
    {error && <Alert type="error" showIcon title={t(`remoteDesktop.files.errors.${error}`, { defaultValue: t('remoteDesktop.files.operationFailed') })} description={<code>{error}</code>} />}
    {unavailable && <Alert type="info" showIcon title={t('remoteDesktop.files.pausedTitle')} description={t('remoteDesktop.files.pausedNote')} />}
    <div className={styles.context}><strong title={rdp?.profile_name}>{rdp?.profile_name ?? t('remoteDesktop.files.retained')}</strong>
      <div className={styles['conflict-field']}><span>{t('remoteDesktop.files.conflicts')}</span><Select size="small" aria-label={t('remoteDesktop.files.conflicts')} value={overwrite} className={`${customSelectStyles.select} ${styles['conflict-select']}`} classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
        options={['rename', 'skip', 'overwrite'].map(value => ({ value, label: t(`remoteDesktop.files.conflict.${value === 'overwrite' ? 'replace' : value}`) }))}
        onChange={value => {
          if (value === 'overwrite') modal.confirm({ title: t('remoteDesktop.files.overwriteConfirm'), className: confirmDialogStyles.modal, rootClassName: confirmDialogStyles['modal-root'], centered: true, onOk: () => setOverwrite(value) })
          else setOverwrite(value)
        }} /></div>
    </div>
    <Tabs className={styles.tabs} activeKey={tab} onChange={setTab} size="small" tabBarGutter={20} items={[
      { key: 'exchange', label: t('remoteDesktop.files.exchange'), disabled: !rdp, children: <div className={styles.section}>
        <p className={styles.note}>{t('remoteDesktop.files.exchangeNote')}</p>
        {!unavailable && paused.map(item => <div key={item.id} className={styles.mapping}><strong>{item.name}</strong><Button size="small" disabled={busy} onClick={() => void run(() => api.rebindExchange(rdp!.id, rdp!.connection_generation, item))}>{t('remoteDesktop.files.resume')}</Button></div>)}
        {exchange ? <>
          {exchange.target_path && <code className={styles['target-path']}>{exchange.target_path}</code>}
          {active.length > 1 && <Select value={exchange.id} onChange={setExchangeId} options={active.map(item => ({ value: item.id, label: item.name }))} />}
          <DesktopExchangeBrowser key={`${exchange.id}:${exchange.resource_generation}`} api={api} exchange={exchange} operations={operations} overwrite={overwrite} />
        </> : <div className={styles.empty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('remoteDesktop.files.exchangeEmpty')} />
          <Button type="primary" icon={<Plus size={15} />} loading={busy} disabled={!state?.capabilities.directory_mapping || unavailable} onClick={() => void run(async () => { const value = await api.createExchange(rdp!.id, rdp!.connection_generation, createOperation.current); setExchangeId(value.id) })}>{t('remoteDesktop.files.openExchange')}</Button>
        </div>}
      </div> },
      { key: 'mappings', label: t('remoteDesktop.files.mappings'), disabled: !rdp, children: <div className={styles.section}>
        <p className={styles.note}>{t('remoteDesktop.files.mappingNote')}</p>
        <Button icon={<Plus size={15} />} size="small" disabled={!state?.capabilities.directory_mapping || unavailable || busy} onClick={addMapping}>{t('remoteDesktop.files.addMapping')}</Button>
        {state?.mappings.map(mapping => <div className={styles.mapping} key={mapping.id}>
          <div className={styles['mapping-title']}><strong>{mapping.label}</strong><Tag color={mapping.state === 'registered' ? 'success' : mapping.state === 'failed' ? 'error' : undefined}>{t(`remoteDesktop.files.states.${mapping.state}`, { defaultValue: mapping.state })}</Tag></div>
          {mapping.target_path && <code className={styles['target-path']}>{mapping.target_path}</code>}
          {mapping.error_code && <code role="alert">{mapping.error_code}</code>}
          <Checkbox checked={mapping.remembered} disabled={busy || unavailable || (!mapping.remembered && mapping.state !== 'registered')} onChange={event => void run(() => api.rememberMapping(rdp!.id, rdp!.connection_generation, mapping.id, event.target.checked))}>{t('remoteDesktop.files.rememberMapping')}</Checkbox>
          <div className={styles.actions}><Button size="small" disabled={busy || unavailable} onClick={() => void run(() => api.mapping(rdp!.id, rdp!.connection_generation, mapping.state === 'paused' ? 'resume' : 'pause', mapping.id))}>{t(`remoteDesktop.files.${mapping.state === 'paused' ? 'resume' : 'pause'}`)}</Button>
            <Popconfirm {...termousPopconfirmProps} title={t('remoteDesktop.files.removeMappingConfirm')} onConfirm={() => run(() => api.mapping(rdp!.id, rdp!.connection_generation, 'remove', mapping.id))}><Button size="small" danger disabled={busy}>{t('remoteDesktop.files.remove')}</Button></Popconfirm></div>
        </div>)}
      </div> },
      { key: 'clipboard', label: t('remoteDesktop.files.clipboard'), disabled: !rdp || !state?.capabilities.file_clipboard || unavailable,
        children: rdp && <DesktopFileClipboard key={`${rdp.id}:${rdp.connection_generation}:${viewer?.controlLease?.generation ?? 0}`} api={api} session={rdp} viewer={viewer} operations={operations} overwrite={overwrite} /> },
      { key: 'retained', label: t('remoteDesktop.files.retained'), children: <div className={styles.section}>
        <p className={styles.note}>{t('remoteDesktop.files.retainedNote')}</p>
        {claim ? <><Button size="small" onClick={() => setClaim(undefined)}>{t('remoteDesktop.files.back')}</Button><DesktopExchangeBrowser key={claim.id} api={api} exchange={claim} retained operations={operations} overwrite={overwrite} /></> : retained.length ? retained.map(item => <div className={styles.mapping} key={item.id}>
          <strong>{item.name}</strong><span className={styles.note}>{t('remoteDesktop.files.expires', { time: formatDate(item.expires_at) })}</span>
          <div className={styles.actions}><Button size="small" disabled={!!item.expires_at && Date.parse(item.expires_at) <= Date.now()} onClick={() => setClaim(item)}>{t('remoteDesktop.files.claim')}</Button>
            <Popconfirm {...termousPopconfirmProps} title={t('remoteDesktop.files.cleanConfirm')} onConfirm={() => run(() => api.clean(item))}><Button size="small" danger icon={<Trash2 size={13} />} disabled={busy}>{t('remoteDesktop.files.clean')}</Button></Popconfirm></div>
        </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('remoteDesktop.files.retainedEmpty')} />}
      </div> },
      { key: 'tasks', label: t('remoteDesktop.files.tasks', { count: tasks.filter(task => task.cancellable).length }), children: <TransferQueueDock className={styles.tasks}><TransferQueuePanel transfers={tasks} liveConnected={false}
        onRefresh={() => operations.refresh()} onCancel={async id => { await run(() => api.cancelTask(id)) }} onDelete={id => run(() => api.cancelTask(id))}
        onRetry={async id => { await run(() => api.retryTask(id)) }} /></TransferQueueDock> },
    ]} />
  </Drawer>
}
