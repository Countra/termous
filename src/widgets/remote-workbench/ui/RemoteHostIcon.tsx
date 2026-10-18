import { useEffect, useState } from 'react'
import { Server } from 'lucide-react'
import { retryRemoteRead, type RemoteHostIcons } from '#entities/remote-control'
import styles from './RemoteResources.module.scss'

export function RemoteHostIcon({ hostId, iconId, icons }: { hostId: string; iconId: string; icons?: RemoteHostIcons }) {
  const [image, setImage] = useState<{ source: RemoteHostIcons; hostId: string; iconId: string; url: string }>()
  const [failed, setFailed] = useState('')
  useEffect(() => {
    if (!icons || !iconId) return
    const abort = new AbortController()
    let active = true, url = ''
    void retryRemoteRead(() => icons.load(hostId, iconId), abort.signal).then(blob => {
      if (!active) return
      url = URL.createObjectURL(blob)
      setImage({ source: icons, hostId, iconId, url })
    }).catch(() => { /* 图标失败只回退默认标识，不影响主机连接操作。 */ })
    return () => { active = false; abort.abort(); if (url) URL.revokeObjectURL(url) }
  }, [icons, hostId, iconId])
  const src = image?.source === icons && image?.hostId === hostId && image?.iconId === iconId && image?.url !== failed ? image?.url : undefined
  return <span className={styles['host-icon']} aria-hidden="true">
    {src ? <img className={styles['host-image']} src={src} alt="" draggable={false} onError={() => setFailed(src)} /> : <Server size={15} />}
  </span>
}
