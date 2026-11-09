import { useEffect, useRef } from 'react'
import { App } from 'antd'
import { termousNotificationClassName } from '#shared/ui'
import { remoteErrorText, type RemoteCopy } from '../model/copy'

export function RemoteAccessFeedback({ notice, copy, active }: { notice?: { reason: unknown; sequence: number }; copy: RemoteCopy; active: boolean }) {
  const { notification } = App.useApp()
  const key = useRef(`remote-access-${crypto.randomUUID()}`)
  useEffect(() => {
    if (!active || !notice) return
    const reason = notice.reason
    const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : undefined
    notification.open({ key: key.current, type: code === 'remote_policy_reconnect' ? 'info' : 'warning',
      title: code === 'remote_policy_reconnect' ? copy.desktopReconnect : code === 'remote_policy_cleanup_pending' ? copy.cleanupPending : remoteErrorText(copy, reason),
      placement: 'bottomRight', duration: 6, className: termousNotificationClassName,
    })
  }, [notification, notice, copy, active])
  useEffect(() => {
    const id = key.current
    if (!active) notification.destroy(id)
    return () => notification.destroy(id)
  }, [notification, active])
  return null
}
