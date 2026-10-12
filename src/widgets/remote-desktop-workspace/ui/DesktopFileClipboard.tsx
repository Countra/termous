import { Alert, Button, Tag } from 'antd'
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCopy, ClipboardPaste, Folder, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopFileClipboard as ClipboardState, RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import { useSystemFileClipboard, type DesktopFilesGateway, type RemoteDesktopViewerState } from '#features/remote-desktop'
import { formatBytes } from '#shared/format'
import type { useDesktopFiles } from '../model/useDesktopFiles.ts'
import { DesktopFileList } from './DesktopFileList'
import { DesktopClipboardProgress } from './DesktopClipboardProgress'
import styles from './DesktopFilesPanel.module.scss'

export function DesktopFileClipboard({ api, session, viewer, operations, overwrite }: {
  api: DesktopFilesGateway; session: RemoteDesktopSession; viewer?: RemoteDesktopViewerState
  operations: ReturnType<typeof useDesktopFiles>; overwrite: OverwritePolicy
}) {
  const { t } = useTranslation()
  const system = useSystemFileClipboard(session.id)
  const receiving = operations.tasks.find(task => task.id === system.task_id && task.desktop_session_id === session.id)
  const [state, setState] = useState<ClipboardState>()
  const [publication, setPublication] = useState<Pick<ClipboardState, 'published' | 'serving' | 'provided_bytes' | 'content_generation'>>()
  const [selected, setSelected] = useState<number[]>([])
  const lifetime = useRef(new AbortController())
  const lease = viewer?.controlLease
  const permitted = viewer?.controlOwned && !viewer.viewOnly && !!lease && viewer.connection === 'connected'
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort() }, [session.id, session.connection_generation, permitted, lease?.id, lease?.generation])
  const current = state && state.content_generation === publication?.content_generation
  const items = useMemo(() => current && state ? state.files.map(file => ({ path: String(file.index), location: file.name, name: file.name, kind: file.directory ? 'directory' : 'file', size: file.size })) : [], [current, state])
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
    if (!permitted || action === 'receive' && !current) return
    await operations.withGrant(action === 'receive' || folder ? 'directories' : 'files', action === 'publish', grant => api.transferClipboard(session.id, { ...query, operation_id: crypto.randomUUID() }, action, grant, selected, overwrite))
  })

  return <section className={styles.section}>
    <div className={styles['section-heading']}><div><h3>{t('remoteDesktop.files.clipboard')}</h3><p>{t('remoteDesktop.files.clipboardNote')}</p></div></div>
    {!permitted && <p className={styles.note}>{t('remoteDesktop.files.controllerRequired')}</p>}
    {system.supported && operations.state?.capabilities.file_clipboard_read && <div className={styles['system-clipboard']}>
      <div><strong>{t('remoteDesktop.files.systemClipboard')}</strong><p>{t('remoteDesktop.files.systemClipboardHint')}</p></div>
      <Tag color={system.enabled ? 'success' : undefined}>{t(`remoteDesktop.files.${system.enabled ? 'systemClipboardEnabled' : 'systemClipboardInactive'}`)}</Tag>
    </div>}
    {system.error_code && <Alert type="error" showIcon title={t(`remoteDesktop.files.errors.${system.error_code}`, { defaultValue: t('remoteDesktop.files.systemClipboardFailed') })} description={<code>{system.error_code}</code>} />}
    <div className={styles['clipboard-directions']}>
      <div className={styles['clipboard-direction']}><h4><ArrowUpFromLine size={17} />{t('remoteDesktop.files.sendToDesktop')}</h4><p>{t('remoteDesktop.files.sendHint')}</p>
        <div className={styles.actions}><Button size="small" type="primary" icon={<ClipboardPaste size={14} />} disabled={!permitted || operations.busy} onClick={() => transfer('publish')}>{t('remoteDesktop.files.publish')}</Button>
          <Button size="small" icon={<Folder size={14} />} disabled={!permitted || operations.busy} onClick={() => transfer('publish', true)}>{t('remoteDesktop.files.publishFolder')}</Button></div>
      </div>
      <div className={styles['clipboard-direction']}><h4><ArrowDownToLine size={17} />{t('remoteDesktop.files.receiveFromDesktop')}</h4><p>{t('remoteDesktop.files.receiveHint')}</p>
        {system.enabled && system.publication_id && !receiving && <p className={styles.note}>{t('remoteDesktop.files.systemClipboardReady', { count: system.files.length })}</p>}
        {receiving && <DesktopClipboardProgress task={receiving} busy={operations.busy} cancel={() => void operations.run(() => api.cancelTask(receiving.id))} />}
        <Button size="small" icon={<ClipboardCopy size={14} />} disabled={!permitted || operations.busy} onClick={read}>{t('remoteDesktop.files.readClipboard')}</Button>
      </div>
    </div>
    <div className={styles['clipboard-status']}><div><strong>{t(`remoteDesktop.files.${permitted && publication?.published ? publication.serving ? 'clipboardServing' : 'clipboardWaiting' : 'publicationIdle'}`)}</strong>
      {permitted && publication?.published && <span>{t('remoteDesktop.files.clipboardProvided', { size: formatBytes(publication.provided_bytes) })}</span>}</div>
      <Button size="small" type="text" icon={<X size={14} />} disabled={!permitted || !publication?.published || operations.busy} onClick={() => void operations.run(() => api.requestClipboard(session.id, { ...query, operation_id: crypto.randomUUID() }, 'revoke'))}>{t('remoteDesktop.files.revoke')}</Button>
    </div>
    {state && !current && <Alert type="info" showIcon title={t('remoteDesktop.files.clipboardChanged')} />}
    <DesktopFileList entries={items}
      selected={current ? selected.map(String) : []} onSelect={paths => setSelected(paths.map(Number))} disabled={!permitted || operations.busy || !current} empty={t('remoteDesktop.files.clipboardEmpty')} />
    <div className={styles['clipboard-save']}><Button type="primary" icon={<ArrowDownToLine size={15} />} disabled={!permitted || !current || !selected.length || operations.busy} onClick={() => transfer('receive')}>{t('remoteDesktop.files.receive')}</Button></div>
  </section>
}
