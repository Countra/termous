import { useId, useRef, useState } from 'react'
import { Activity, ChevronUp, Gauge, Monitor, Network, Timer } from 'lucide-react'
import { DesktopMediaDetails, desktopMediaMetrics } from '#entities/desktop-presentation'
import type { RemoteDesktopMediaDetails } from '#entities/remote-desktop'
import { FilterPopover } from '#shared/ui'
import type { DesktopCopy } from '../../model/desktopCopy'
import styles from './DesktopMediaStatusBar.module.scss'

export function DesktopMediaStatusBar({ value, copy, zh, getContainer, targetSize }: {
  value: RemoteDesktopMediaDetails
  copy: DesktopCopy
  zh: boolean
  getContainer(): HTMLElement
  targetSize?: { width: number; height: number }
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const metrics = desktopMediaMetrics(value, zh)
  const showTargetSize = metrics.resolution === '—' && value.phase === 'viewing' && targetSize && targetSize.width > 0 && targetSize.height > 0
  return <footer className={styles.bar}>
    <FilterPopover open={open} onOpenChange={setOpen} placement="topLeft" getPopupContainer={getContainer} content={<div id={id} className={styles.details} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }}><DesktopMediaDetails value={value} zh={zh} /></div>}>
      <button ref={trigger} type="button" className={styles.trigger} aria-label={copy.mediaDetails} aria-expanded={open} aria-controls={open ? id : undefined} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
        <Network size={13} aria-hidden="true" /><span>{copy.media}</span><strong>{metrics.path}</strong><ChevronUp size={12} aria-hidden="true" />
      </button>
    </FilterPopover>
    <div className={styles.metrics}>
      <span title={showTargetSize ? copy.target : copy.picture}><Monitor size={12} aria-hidden="true" />{showTargetSize ? `${targetSize.width} × ${targetSize.height}` : metrics.resolution}</span>
      {value.transport === 'h264' ? <>
        <span className={styles.framerate} title={copy.framerate}><Activity size={12} aria-hidden="true" />{metrics.framerate}</span>
        <span className={styles.bitrate} title={copy.bitrate}><Gauge size={12} aria-hidden="true" />{metrics.bitrate}</span>
      </> : null}
      <span title={copy.latency}><Timer size={12} aria-hidden="true" />{metrics.latency}</span>
    </div>
  </footer>
}
