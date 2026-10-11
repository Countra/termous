import { Alert, Button, Checkbox, Empty, Form, Input, Modal, Popconfirm, Spin } from 'antd'
import { ArrowUp, Download, File, Folder, FolderPlus, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopExchange, DesktopFileEntry } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { formatBytes } from '#shared/format'
import { confirmDialogStyles, termousPopconfirmProps } from '#shared/ui'
import type { useDesktopFiles } from '../model/useDesktopFiles.ts'
import styles from './DesktopFilesPanel.module.scss'

interface Props {
  api: DesktopFilesGateway
  exchange: DesktopExchange
  retained?: boolean
  operations: ReturnType<typeof useDesktopFiles>
  overwrite: OverwritePolicy
}

export function DesktopExchangeBrowser({ api, exchange, retained = false, operations, overwrite }: Props) {
  const { t } = useTranslation()
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
  const selected = !loading && !error && selection?.query === query ? selection.paths : []
  const disabled = operations.busy || loading || error
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
  return <div className={styles.browser}>
    <div className={styles.path}>
      <Button type="text" size="small" icon={<ArrowUp size={16} />} aria-label={t('remoteDesktop.files.parent')} disabled={path === '/'} onClick={() => setPath(path.slice(0, path.lastIndexOf('/')) || '/')} />
      <code title={path}>{path}</code><Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label={t('remoteDesktop.files.refresh')} onClick={refresh} />
    </div>
    <div className={styles.actions}>
      {!retained && <><Button size="small" icon={<Upload size={14} />} disabled={disabled} onClick={() => transfer('upload')}>{t('remoteDesktop.files.upload')}</Button>
        <Button size="small" icon={<Folder size={14} />} disabled={disabled} onClick={() => transfer('upload', true)}>{t('remoteDesktop.files.uploadFolder')}</Button>
        <Button size="small" icon={<FolderPlus size={14} />} disabled={disabled} onClick={() => nameDialog()}>{t('remoteDesktop.files.newFolder')}</Button></>}
      <Button size="small" icon={<Download size={14} />} disabled={!selected.length || disabled} onClick={() => transfer('download')}>{t('remoteDesktop.files.saveSelected')}</Button>
    </div>
    <div className={styles.entries} aria-label={t('remoteDesktop.files.entries')} aria-busy={loading}>
      {loading ? <Spin /> : error ? <Alert type="error" showIcon title={t('remoteDesktop.files.readFailed')} /> : entries.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('remoteDesktop.files.empty')} /> : entries.map(entry => <div className={styles.entry} key={entry.path}>
        <Checkbox aria-label={t('remoteDesktop.files.select', { name: entry.name })} checked={selected.includes(entry.path)} disabled={!['file', 'directory'].includes(entry.kind)} onChange={event => setSelection({ query, paths: event.target.checked ? [...selected, entry.path] : selected.filter(path => path !== entry.path) })} />
        {entry.kind === 'directory' ? <Folder size={17} /> : <File size={17} />}
        <button className={styles.filename} title={entry.name} disabled={entry.kind !== 'directory'} onClick={() => setPath(entry.path)}>{entry.name}</button>
        <span className={styles.size}>{entry.kind === 'file' ? formatBytes(entry.size) : ''}</span>
        {!retained && <><Button size="small" type="text" icon={<Pencil size={13} />} disabled={operations.busy} aria-label={t('remoteDesktop.files.rename')} onClick={() => nameDialog(entry)} />
          <Popconfirm {...termousPopconfirmProps} title={t('remoteDesktop.files.deleteConfirm')} onConfirm={() => operations.run(async () => { await api.mutate(exchange, 'remove', entry.path, entry.version); refresh() })}>
            <Button size="small" type="text" danger icon={<Trash2 size={13} />} disabled={operations.busy} aria-label={t('remoteDesktop.files.delete')} />
          </Popconfirm></>}
      </div>)}
    </div>
    <p className={styles.note}>{t(`remoteDesktop.files.${retained ? 'claimNote' : 'snapshotNote'}`)}</p>
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
