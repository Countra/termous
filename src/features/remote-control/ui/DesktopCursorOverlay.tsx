import { useEffect, useState, type RefObject } from 'react'
import type { DesktopState } from '@termous/remote-protocol/desktop'
import styles from './RemoteDesktop.module.scss'

import type { CursorState } from '../model/desktopCursor'

// 光标采用源桌面坐标，与 contain 留白及缩放保持一致，不写入视频或截图。
export function DesktopCursorOverlay({ cursor, video, source, owned, fit }: {
  cursor?: CursorState; video: RefObject<HTMLVideoElement | null>; source?: DesktopState; owned: boolean; fit: boolean
}) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = video.current
    if (!element) return
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [video, fit])
  useEffect(() => {
    const element = video.current
    if (!element) return
    element.style.cursor = cursor?.kind === 'hidden' ? 'none' : cursor?.image
      ? `url("${cursor.image}") ${cursor.hotspotX} ${cursor.hotspotY}, default` : 'default'
    return () => { element.style.cursor = '' }
  }, [video, cursor?.kind, cursor?.image, cursor?.hotspotX, cursor?.hotspotY])
  if (owned || !cursor || cursor.kind === 'hidden' || !source?.width || !source.height) return null
  const scale = Math.min(size.width / source.width, size.height / source.height)
  return <span aria-hidden className={styles.cursor} style={{ left: (size.width - source.width * scale) / 2 + (cursor.x - cursor.hotspotX) * scale, top: (size.height - source.height * scale) / 2 + (cursor.y - cursor.hotspotY) * scale }}>
    {cursor.image ? <img alt="" src={cursor.image} style={{ width: cursor.width * scale, height: cursor.height * scale }} /> : '↖'}
  </span>
}
