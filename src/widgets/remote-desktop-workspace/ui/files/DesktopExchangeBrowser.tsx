import { Alert, App, Breadcrumb, Button, Dropdown, Form, Input, Modal, Tooltip } from 'antd'
import { ArrowUp, ChevronDown, Download, Folder, FolderPlus, MoreHorizontal, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopExchange, DesktopFileEntry } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { confirmDialogStyles, contextActionMenuPopupClassName } from '#shared/ui'
import type { useDesktopFiles } from '../../model/useDesktopFiles.ts'
import { DesktopFileList } from './DesktopFileList'
import section from './DesktopFileSection.module.scss'
import styles from './DesktopFileTools.module.scss'

interface Props {
  api: DesktopFilesGateway
  exchange: DesktopExchange
  retained?: boolean
  operations: ReturnType<typeof useDesktopFiles>
  overwrite: OverwritePolicy
  blocked?: boolean
}

export function DesktopExchangeBrowser({ api, exchange, retained = false, operations, overwrite, blocked = false }: Props) {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const [path, setPath] = useState('/')
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<{ entry?: DesktopFileEntry; path: string; name: string }>()
  const [nameError, setNameError] = useState(false)
  // 部分失败也可能已提交条目；只在本交换区任务结束时重读，进度轮询不打断选择。
  const completed = operations.tasks.filter(task => task.desktop_exchange_id === exchange.id && task.desktop_resource_generation === exchange.resource_generation && ['completed', 'failed', 'cancelled'].includes(task.status))
    .map(task => `${task.id}:${task.status}`).sort().join('|')
  const query = useMemo(() => ({ id: exchange.id, resource_generation: exchange.resource_generation, path, retained, revision, completed }), [exchange.id, exchange.resource_generation, path, retained, revision, completed])
  const [listing, setListing] = useState<{ query: typeof query; entries: DesktopFileEntry[]; error?: boolean }>()
  const [selection, setSelection] = useState<{ query: typeof query; paths: string[] }>()
  const loading = listing?.query !== query
  const error = !loading && listing?.error === true
  const entries = !loading && !error ? listing?.entries ?? [] : []
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  const selected = !loading && !error && selection?.query === query ? selection.paths.filter(path => byPath.has(path)) : []
  const expired = !!exchange.expires_at && Date.parse(exchange.expires_at) <= Date.now()
  const disabled = operations.busy || loading || error || blocked || expired
  useEffect(() => {
    const abort = new AbortController()
    void api.entries({ id: query.id, resource_generation: query.resource_generation }, query.path, query.retained, abort.signal).then(entries => {
      if (!abort.signal.aborted) setListing({ query, entries })
    }).catch(() => { if (!abort.signal.aborted) setListing({ query, entries: [], error: true }) })
    return () => abort.abort()
  }, [api, query])
  const refresh = () => setRevision(value => value + 1)
  const transfer = (action: 'upload' | 'download', directory = false) => void operations.run(async () => {
    await operations.withGrant(action === 'download' || directory ? 'directories' : 'files', action === 'upload', grant => api.transfer(exchange, retained ? 'claim' : action, grant, selected, path, overwrite))
    refresh()
  })
  const nameDialog = (entry?: DesktopFileEntry) => {
    setNameError(false)
    setEditing({ entry, path, name: entry?.name ?? '' })
  }
  const saveName = async () => {
    if (!editing || operations.busy) return
    const name = editing.name.trim()
    if (!name || /[/\\:\0]/.test(name) || ['.', '..'].includes(name)) { setNameError(true); return }
    const { entry } = editing
    const target = `${editing.path === '/' ? '' : editing.path}/${name}`
    await operations.run(() => api.mutate(exchange, entry ? 'rename' : 'mkdir', entry?.path ?? target, entry?.version, entry ? target : ''))
    // 失败也可能已经修改目录，关闭对话框后在面板展示具体错误，避免原地重复提交。
    setEditing(undefined)
    refresh()
  }
  const remove = (entry: DesktopFileEntry) => modal.confirm({
    title: t('remoteDesktop.files.deleteConfirm'), content: entry.name, centered: true,
    className: confirmDialogStyles.modal, rootClassName: confirmDialogStyles['modal-root'],
    okText: t('remoteDesktop.files.delete'), cancelText: t('app.cancel'), okButtonProps: { danger: true },
    onOk: () => operations.run(async () => { await api.mutate(exchange, 'remove', entry.path, entry.version); refresh() }),
  })
  const parts = path.split('/').filter(Boolean)
  return <div className={styles.browser}>
    <div className={styles.toolbar}>
      <div className={section.actions}>
        {!retained && <><div className={styles['upload-group']}><Button type="primary" icon={<Upload size={15} />} disabled={disabled} onClick={() => transfer('upload')}>{t('remoteDesktop.files.upload')}</Button>
          <Dropdown trigger={['click']} classNames={{ root: contextActionMenuPopupClassName }} menu={{ items: [{ key: 'folder', icon: <Folder size={15} />, label: t('remoteDesktop.files.uploadFolder'), disabled }], onClick: () => transfer('upload', true) }}>
            <Button type="primary" icon={<ChevronDown size={14} />} aria-label={t('remoteDesktop.files.uploadOptions')} disabled={disabled} />
          </Dropdown></div>
          <Tooltip title={t('remoteDesktop.files.newFolder')}><Button icon={<FolderPlus size={15} />} aria-label={t('remoteDesktop.files.newFolder')} disabled={disabled} onClick={() => nameDialog()} /></Tooltip></>}
      </div>
      <Tooltip title={retained ? undefined : t('remoteDesktop.files.snapshotDownloadHint')}><Button icon={<Download size={15} />} disabled={!selected.length || disabled} onClick={() => transfer('download')}>{t('remoteDesktop.files.saveSelected')}</Button></Tooltip>
    </div>
    <div className={styles.path}>
      <Button type="text" size="small" icon={<ArrowUp size={16} />} aria-label={t('remoteDesktop.files.parent')} disabled={path === '/'} onClick={() => setPath(path.slice(0, path.lastIndexOf('/')) || '/')} />
      <Breadcrumb items={[{ title: <button onClick={() => setPath('/')}>{t(`remoteDesktop.files.${retained ? 'retained' : 'exchange'}`)}</button> }, ...parts.map((part, index) => ({ title: <button onClick={() => setPath(`/${parts.slice(0, index + 1).join('/')}`)}>{part}</button> }))]} />
      <Tooltip title={t('remoteDesktop.files.refresh')}><Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label={t('remoteDesktop.files.refresh')} disabled={loading} onClick={refresh} /></Tooltip>
    </div>
    {error && <Alert type="error" showIcon title={t('remoteDesktop.files.readFailed')} action={<Button size="small" onClick={refresh}>{t('remoteDesktop.files.refresh')}</Button>} />}
    {expired && <Alert type="warning" showIcon title={t('remoteDesktop.files.errors.desktop_files_expired')} />}
    <DesktopFileList key={path} entries={entries} selected={selected} onSelect={paths => setSelection({ query, paths })} onOpenDirectory={setPath} loading={loading} disabled={disabled}
      actions={!retained ? item => {
        const entry = byPath.get(item.path)!
        return <Dropdown trigger={['click']} classNames={{ root: contextActionMenuPopupClassName }} menu={{ items: [
          { key: 'rename', icon: <Pencil size={14} />, label: t('remoteDesktop.files.rename'), disabled },
          { key: 'delete', icon: <Trash2 size={14} />, label: t('remoteDesktop.files.delete'), danger: true, disabled },
        ], onClick: ({ key }) => key === 'rename' ? nameDialog(entry) : remove(entry) }}>
          <Button type="text" size="small" icon={<MoreHorizontal size={16} />} aria-label={t('remoteDesktop.files.fileActions', { name: entry.name })} disabled={disabled} />
        </Dropdown>
      } : undefined} />
    <p>{t(`remoteDesktop.files.${retained ? 'claimNote' : 'snapshotNote'}`)}</p>
    <Modal open={!!editing} title={t(`remoteDesktop.files.${editing?.entry ? 'rename' : 'newFolder'}`)} centered destroyOnHidden
      className={confirmDialogStyles.modal} rootClassName={confirmDialogStyles['modal-root']}
      okText={t('app.confirm')} cancelText={t('app.cancel')} confirmLoading={operations.busy} cancelButtonProps={{ disabled: operations.busy }}
      closable={!operations.busy} mask={{ closable: !operations.busy }} keyboard={!operations.busy} onCancel={() => setEditing(undefined)} onOk={() => void saveName()}>
      <Form.Item validateStatus={nameError ? 'error' : undefined} help={nameError ? t('remoteDesktop.files.invalidName') : undefined}>
        <Input autoFocus aria-label={t('remoteDesktop.files.name')} value={editing?.name ?? ''} disabled={operations.busy}
          onChange={event => { setEditing(current => current && { ...current, name: event.target.value }); setNameError(false) }} onPressEnter={() => void saveName()} />
      </Form.Item>
    </Modal>
  </div>
}
