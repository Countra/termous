import { useEffect, useRef, useState } from 'react'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useRemoteDesktopRuntime } from '../runtime/core/remoteDesktopRuntimeContext.ts'
import styles from './RemoteDesktopViewport.module.scss'

export function RemoteDesktopViewport({ sessionId }: { sessionId: string }) {
  const { focusViewer, registerViewport, sessions, reclaimRemoteViewer } = useRemoteDesktopRuntime()
  const { i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh') ?? false
  const [working, setWorking] = useState(false)
  const pending = useRef(false)
  const [failed, setFailed] = useState(false)
  const session = sessions.find(item => item.id === sessionId)
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
    />{remote && remote.phase !== 'preparing' ? <div className={styles.handoff} role="status">
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
