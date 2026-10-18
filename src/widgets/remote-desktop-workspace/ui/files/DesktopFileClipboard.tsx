import { Alert, App, Button, Tag, Tooltip } from 'antd'
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, ClipboardCopy, Files, Folder, Info, Monitor, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import { useSystemClipboardOperation, systemClipboardReasonKey } from '#entities/system-clipboard'
import { prepareSystemFileClipboard, type DesktopFilesGateway, type RemoteDesktopViewerState } from '#features/remote-desktop'
import { formatBytes } from '#shared/format'
import type { useDesktopFiles } from '../../model/useDesktopFiles'
import { useDesktopFileClipboard } from '../../model/useDesktopFileClipboard'
import { useDesktopClipboardPaste } from '../../model/useDesktopClipboardPaste'
import { DesktopFileList } from './DesktopFileList'
import { DesktopClipboardProgress } from './DesktopClipboardProgress'
import { DesktopClipboardSelection } from './DesktopClipboardSelection'
import section from './DesktopFileSection.module.scss'
import styles from './DesktopFileClipboard.module.scss'

export function DesktopFileClipboard(props: {
  api: DesktopFilesGateway; session: RemoteDesktopSession; viewer?: RemoteDesktopViewerState
  operations: ReturnType<typeof useDesktopFiles>; overwrite: OverwritePolicy
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { session, operations } = props
  const { permitted, publication, state, current, items, selected, setSelected, system, selection, preparing, totalBytes, read, transfer, revoke } = useDesktopFileClipboard(props)
  const [direction, setDirection] = useState<'send' | 'receive'>('send')
  const importing = useSystemClipboardOperation('import_files')
  const publishing = useSystemClipboardOperation('publish_files')
  const nativeVisible = importing.visible || publishing.visible
  const nativeReady = importing.available || publishing.available
  const receiving = operations.tasks.find(task => task.id === system.task_id && task.desktop_session_id === session.id)
  const blocked = !permitted || operations.busy || system.busy
  const canPaste = permitted && importing.available && !!system.import_enabled
  const chooseActions = <div className={section.actions}>
    <Button type="primary" icon={<Files size={15} />} disabled={blocked} onClick={() => transfer('publish')}>{t('remoteDesktop.files.publish')}</Button>
    <Button icon={<Folder size={15} />} disabled={blocked} onClick={() => transfer('publish', true)}>{t('remoteDesktop.files.publishFolder')}</Button>
  </div>
  const root = useRef<HTMLElement>(null)
  const paste = () => {
    // 系统文件准备由观看端维护忙碌状态，不能长期占用侧栏操作锁，否则无法取消传输。
    if (!blocked) void prepareSystemFileClipboard(session.id).catch(error => {
      void message.error(t(`remoteDesktop.files.errors.${error instanceof Error ? error.message : ''}`, { defaultValue: t('remoteDesktop.files.systemClipboardFailed') }))
    })
  }
  useDesktopClipboardPaste(root, direction === 'send' && canPaste, paste)

  return <section ref={root} className={section.section}>
    <div className={section.heading}><div><h3>{t('remoteDesktop.files.clipboard')}</h3><p>{t('remoteDesktop.files.clipboardNote')}</p></div></div>
    <div className={styles.directions} role="group" aria-label={t('remoteDesktop.files.transferDirection')}>
      <button type="button" aria-pressed={direction === 'send'} onClick={() => setDirection('send')}><ArrowUpFromLine size={16} />{t('remoteDesktop.files.sendToDesktop')}</button>
      <button type="button" aria-pressed={direction === 'receive'} onClick={() => setDirection('receive')}><ArrowDownToLine size={16} />{t('remoteDesktop.files.receiveFromDesktop')}</button>
    </div>
    {!permitted && <Alert type="info" showIcon title={t('remoteDesktop.files.controllerRequired')} />}
    {system.error_code && <Alert type="error" showIcon title={t(`remoteDesktop.files.errors.${system.error_code}`, { defaultValue: t('remoteDesktop.files.systemClipboardFailed') })} />}
    {direction === 'send' ? <div className={styles.send}>
      <div className={styles['send-content']} data-populated={!!selection || undefined}>
        {selection ? <>
          <div className={styles['send-toolbar']}><div><h4>{t('remoteDesktop.files.sendSelection')}</h4><p>{t('remoteDesktop.files.clipboardPasteHint')}</p></div>{chooseActions}</div>
          <DesktopClipboardSelection items={selection.items} totalBytes={totalBytes} />
        </> : <>
          <div className={styles.route} aria-hidden="true"><Files size={24} /><ArrowRight size={18} /><Monitor size={24} /></div>
          <h4>{t('remoteDesktop.files.chooseFilesToSend')}</h4><p>{t(`remoteDesktop.files.${canPaste ? 'systemPasteHint' : 'sendHint'}`)}</p>
          {chooseActions}
        </>}
      </div>
      <div className={styles.publication} data-active={permitted && publication?.published || undefined}>
        <div><strong>{t(`remoteDesktop.files.${selection && preparing ? 'clipboardPreparing' : permitted && publication?.published ? publication.serving ? 'clipboardServing' : 'clipboardWaiting' : 'publicationIdle'}`)}</strong>
          {permitted && publication?.published && <Tooltip title={t('remoteDesktop.files.clipboardProvidedHint')}><span>{t('remoteDesktop.files.clipboardProvided', { size: formatBytes(publication.provided_bytes) })}</span></Tooltip>}</div>
        <Button size="small" type="text" icon={<X size={14} />} disabled={blocked || !publication?.published} onClick={revoke}>{t('remoteDesktop.files.revoke')}</Button>
      </div>
    </div> : <div className={styles.receive}>
      <div className={styles['receive-toolbar']}><p>{t('remoteDesktop.files.receiveHint')}</p><Button icon={<ClipboardCopy size={15} />} disabled={blocked} onClick={read}>{t('remoteDesktop.files.readClipboard')}</Button></div>
      {publishing.available && system.publish_enabled && system.publication_id && !receiving && <Alert type="info" showIcon title={t('remoteDesktop.files.systemClipboardReady', { count: system.files.length })} />}
      {receiving && <DesktopClipboardProgress task={receiving} busy={operations.busy} cancel={() => void operations.run(() => props.api.cancelTask(receiving.id))} />}
      {state && !current && <Alert type="info" showIcon title={t('remoteDesktop.files.clipboardChanged')} />}
      {state ? <DesktopFileList entries={items} selected={current ? selected.map(String) : []} onSelect={paths => setSelected(paths.map(Number))}
        disabled={blocked || !current} empty={t('remoteDesktop.files.clipboardEmpty')}
        footerAction={<Button type="primary" icon={<ArrowDownToLine size={15} />} disabled={blocked || !current || !selected.length} onClick={() => transfer('receive')}>{t('remoteDesktop.files.receive')}</Button>} />
        : <div className={section.empty}><ClipboardCopy size={30} /><h3>{t('remoteDesktop.files.clipboardUnread')}</h3><p>{t('remoteDesktop.files.clipboardEmpty')}</p></div>}
    </div>}
    {nativeVisible && <div className={styles.system}><span>{t('remoteDesktop.files.systemClipboard')}</span>
      <Tag color={nativeReady && system.enabled ? 'success' : undefined}>{nativeReady ? t(`remoteDesktop.files.${system.enabled ? 'systemClipboardEnabled' : 'systemClipboardInactive'}`) : t(systemClipboardReasonKey(importing.visible ? importing.reason : publishing.reason))}</Tag>
      <Tooltip title={t('remoteDesktop.files.systemClipboardHint')}><button type="button" className={styles.help} aria-label={t('remoteDesktop.files.systemClipboardHint')}><Info size={14} /></button></Tooltip>
    </div>}
  </section>
}
