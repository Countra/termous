import { useEffect, useRef, useState } from 'react'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useRemoteDesktopRuntime } from '../runtime/core/remoteDesktopRuntimeContext.ts'
import styles from './RemoteDesktopViewport.module.scss'
import { useSystemFileClipboard } from '../model/useSystemFileClipboard.ts'

export function RemoteDesktopViewport({ sessionId }: { sessionId: string }) {
  const { focusViewer, registerViewport, sessions, reclaimRemoteViewer } = useRemoteDesktopRuntime()
  const { t, i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh') ?? false
  const [working, setWorking] = useState(false)
  const pending = useRef(false)
  const [failed, setFailed] = useState(false)
  const session = sessions.find(item => item.id === sessionId)
  const clipboard = useSystemFileClipboard(sessionId)
  const { viewerStates } = useRemoteDesktopRuntime()
  const clipboardError = !clipboard.dragging && !clipboard.busy ? viewerStates[sessionId]?.clipboardError : undefined
  const canDrop = viewerStates[sessionId]?.controlOwned && !viewerStates[sessionId]?.viewOnly
  const remote = session?.protocol === 'vnc' ? session.remote_viewer : undefined
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return undefined
    }
    return registerViewport(sessionId, host)
  }, [registerViewport, sessionId])

  return (
    <><div
      ref={hostRef}
      className={styles.viewport}
      data-termous-shortcut-exclusive="true"
      tabIndex={-1}
      onMouseDown={() => focusViewer(sessionId)}
    />{clipboardError ? <div className={styles['file-status']} role="alert">{t(`remoteDesktop.viewerErrors.${clipboardError}`)}</div> : session?.protocol === 'rdp' && (clipboard.dragging || clipboard.busy || clipboard.notice || clipboard.error_code) && <div className={clipboard.dragging ? styles.drop : styles['file-status']} role={clipboard.error_code ? 'alert' : 'status'}>
      {clipboard.dragging ? zh ? canDrop ? '松开以准备文件，然后在目标文件夹粘贴' : '取得控制权后才能发送文件' : canDrop ? 'Drop to prepare files, then paste in the target folder' : 'Control is required to send files'
        : clipboard.busy ? zh ? '正在准备文件…' : 'Preparing files…'
          : clipboard.error_code ? <>{zh ? '文件操作失败，桌面连接保持可用' : 'File operation failed; the desktop remains available'}<code>{clipboard.error_code}</code></>
            : zh ? '文件已准备好，请在目标文件夹粘贴' : 'Files are ready. Paste in the target folder.'}
    </div>}{remote && remote.phase !== 'preparing' ? <div className={styles.handoff} role="status">
      <strong>{zh ? '桌面已切换至远端设备' : 'Desktop is open on the remote device'}</strong>
      <span>{zh ? '收回后将重新连接本机观看端。' : 'Reclaim to reconnect this viewer.'}</span>
      {failed ? <span role="alert">{zh ? '收回失败，请重试。' : 'Could not reclaim. Try again.'}</span> : null}
      <Button type="primary" loading={working} onClick={() => {
        if (pending.current || !reclaimRemoteViewer) return
        pending.current = true; setWorking(true); setFailed(false)
        void reclaimRemoteViewer(sessionId).catch(() => setFailed(true)).finally(() => { pending.current = false; setWorking(false) })
      }}>{zh ? '收回桌面' : 'Reclaim desktop'}</Button>
    </div> : null}</>
  )
}
