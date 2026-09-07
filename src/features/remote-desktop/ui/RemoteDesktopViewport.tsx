import { useEffect, useRef } from 'react'
import { useRemoteDesktopRuntime } from '../runtime/core/remoteDesktopRuntimeContext.ts'
import styles from './RemoteDesktopViewport.module.scss'

export function RemoteDesktopViewport({ sessionId }: { sessionId: string }) {
  const { focusViewer, registerViewport } = useRemoteDesktopRuntime()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return undefined
    }
    return registerViewport(sessionId, host)
  }, [registerViewport, sessionId])

  return (
    <div
      ref={hostRef}
      className={styles.viewport}
      data-termous-shortcut-exclusive="true"
      tabIndex={-1}
      onMouseDown={() => focusViewer(sessionId)}
    />
  )
}
