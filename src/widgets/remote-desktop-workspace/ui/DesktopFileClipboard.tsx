import { Alert, Button, Checkbox, Empty } from 'antd'
import { ClipboardCopy, ClipboardPaste, Folder, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopFileClipboard as ClipboardState, RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import { formatBytes } from '#shared/format'
import type { useDesktopFiles } from '../model/useDesktopFiles.ts'
import styles from './DesktopFilesPanel.module.scss'

export function DesktopFileClipboard({ api, session, viewer, operations, overwrite }: {
  api: DesktopFilesGateway; session: RemoteDesktopSession; viewer?: RemoteDesktopViewerState
  operations: ReturnType<typeof useDesktopFiles>; overwrite: OverwritePolicy
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<ClipboardState>()
  const [publication, setPublication] = useState<Pick<ClipboardState, 'published' | 'serving' | 'provided_bytes'>>()
  const [selected, setSelected] = useState<number[]>([])
  const lifetime = useRef(new AbortController())
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort() }, [])
  const lease = viewer?.controlLease
  const permitted = viewer?.controlOwned && !viewer.viewOnly && !!lease && viewer.connection === 'connected'
  const query = { generation: session.connection_generation, subscription_id: lease?.id ?? '', control_generation: lease?.generation ?? 0, content_generation: state?.content_generation ?? 0 }

  useEffect(() => {
    if (!permitted) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const value = await api.clipboard(session.id, { generation: session.connection_generation, subscription_id: lease!.id, control_generation: lease!.generation, content_generation: 0 }, abort.signal)
        if (!abort.signal.aborted) setPublication(value)
      } catch {
        if (!abort.signal.aborted) setPublication(undefined)
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [api, session.id, session.connection_generation, permitted, lease])

  const read = () => void operations.run(async () => {
    const signal = lifetime.current.signal
    const current = await api.clipboard(session.id, { ...query, content_generation: 0 }, signal)
    if (!current.available) throw new Error(current.reason)
    const request = { ...query, content_generation: current.content_generation, operation_id: crypto.randomUUID() }
    let operation = await api.requestClipboard(session.id, request, 'list')
    const deadline = Date.now() + 10_000
    while (operation.state === 'running' && !signal.aborted && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 150))
      operation = (await api.clipboard(session.id, request, signal)).operation ?? operation
    }
    if (signal.aborted) return
    if (operation.state !== 'completed') throw new Error(operation.error_code ?? 'desktop_files_not_ready')
    const files: ClipboardState['files'] = []
    let page: ClipboardState
    do {
      page = await api.clipboard(session.id, { ...request, offset: files.length, limit: 128 }, signal)
      files.push(...(page.files ?? []))
      if (files.length > 4096 || page.total_files > files.length && !page.files?.length) throw new Error('desktop_files_invalid_list')
    } while (files.length < page.total_files)
    if (!signal.aborted) { setState({ ...page, files }); setSelected(files.filter(file => !file.name.includes('/')).map(file => file.index)) }
  })

  const transfer = (action: 'publish' | 'receive', folder = false) => void operations.run(async () => {
    await operations.withGrant(action === 'receive' || folder ? 'directories' : 'files', action === 'publish', grant => api.transferClipboard(session.id, { ...query, operation_id: crypto.randomUUID() }, action, grant, selected, overwrite))
  })

  return <div className={styles.section}>
    <p className={styles.note}>{t('remoteDesktop.files.clipboardNote')}</p>
    {permitted && publication?.published && <Alert type="info" showIcon title={t(`remoteDesktop.files.${publication.serving ? 'clipboardServing' : 'clipboardWaiting'}`)} description={t('remoteDesktop.files.clipboardProvided', { size: formatBytes(publication.provided_bytes) })} />}
    {!permitted && <p className={styles.note}>{t('remoteDesktop.files.controllerRequired')}</p>}
    <div className={styles.actions}>
      <Button size="small" icon={<ClipboardPaste size={14} />} disabled={!permitted || operations.busy} onClick={() => transfer('publish')}>{t('remoteDesktop.files.publish')}</Button>
      <Button size="small" icon={<Folder size={14} />} disabled={!permitted || operations.busy} onClick={() => transfer('publish', true)}>{t('remoteDesktop.files.publishFolder')}</Button>
      <Button size="small" icon={<ClipboardCopy size={14} />} disabled={!permitted || operations.busy} onClick={read}>{t('remoteDesktop.files.readClipboard')}</Button>
      <Button size="small" icon={<X size={14} />} disabled={!permitted || operations.busy} onClick={() => void operations.run(() => api.requestClipboard(session.id, { ...query, operation_id: crypto.randomUUID() }, 'revoke'))}>{t('remoteDesktop.files.revoke')}</Button>
    </div>
    {state?.files.length ? <>
      <div className={styles.entries}>{state.files.map(file => <div className={styles.entry} key={file.index}>
        <Checkbox aria-label={t('remoteDesktop.files.select', { name: file.name })} checked={selected.includes(file.index)} onChange={event => setSelected(current => event.target.checked ? [...current, file.index] : current.filter(index => index !== file.index))} />
        <span className={styles.filename} title={file.name}>{file.name}</span><span className={styles.size}>{file.directory ? '' : formatBytes(file.size)}</span>
      </div>)}</div>
      <Button disabled={!permitted || !selected.length || operations.busy} onClick={() => transfer('receive')}>{t('remoteDesktop.files.receive')}</Button>
    </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('remoteDesktop.files.clipboardEmpty')} />}
  </div>
}
