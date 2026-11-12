import { useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Network, ShieldCheck, Timer } from 'lucide-react'
import type { RemoteConnection } from '#common/contracts'
import { DesktopMediaDetails, type RemoteDesktopMediaDetails } from '#entities/remote-desktop'
import type { RemoteCopy } from '#features/remote-control'
import { formatBytes } from '#shared/format'
import { FilterPopover } from '#shared/ui'
import styles from './RemoteConnectionStatus.module.scss'

export function RemoteConnectionStatus({ connection, media, ready, closed, path, copy, zh }: {
  connection?: RemoteConnection
  media?: RemoteDesktopMediaDetails
  ready: boolean
  closed: boolean
  path: string
  copy: RemoteCopy
  zh: boolean
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const stats = connection?.stats
  const label = (cn: string, en: string) => zh ? cn : en
  const latency = ready && stats?.path ? `${Math.round(stats.rtt_ms)} ms` : '—'
  const rate = (value?: number) => ready && value !== undefined ? `${formatBytes(value)}/s` : '—'
  const rows = [
    [copy.transport, ready && stats?.protocol ? stats.protocol.toUpperCase() : '—'],
    [copy.addressFamily, ready && stats?.ip_version === 'ipv4' ? 'IPv4' : ready && stats?.ip_version === 'ipv6' ? 'IPv6' : '—'],
    [copy.security, ready ? copy.encrypted : '—'],
    ...(ready && stats?.relay_protocol ? [[copy.relayTransport, stats.relay_protocol.toUpperCase()]] : []),
    ...(connection?.transport_policy ? [[label('连接偏好', 'Connection preference'), connection.transport_policy === 'relay' ? label('仅中继', 'Relay only') : connection.transport_policy === 'auto' ? label('自动（优先直连）', 'Auto (prefer direct)') : '—']] : []),
  ]
  const content = <div id={id} className={styles.details} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }}>
    <section aria-label={label('控制连接', 'Control connection')}>
      <header className={styles.heading}>
        <span className={styles.icon}><Network size={17} aria-hidden="true" /></span>
        <div><span>{label('控制连接', 'Control connection')}</span><strong>{path}</strong></div>
        <span className={styles.security}><ShieldCheck size={14} aria-hidden="true" />{ready ? label('已加密', 'Encrypted') : '—'}</span>
      </header>
      <dl className={styles.metrics}>
        <Metric icon={<Timer size={12} />} label={copy.latency} value={latency} />
        <Metric icon={<ArrowDown size={12} />} label={copy.receiveRate} value={rate(stats?.receive_bytes_per_second)} />
        <Metric icon={<ArrowUp size={12} />} label={copy.sendRate} value={rate(stats?.send_bytes_per_second)} />
      </dl>
      <dl className={styles.rows}>{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    </section>
    {media && media.connectionId === connection?.id ? <div className={styles.media}><DesktopMediaDetails value={media} zh={zh} /></div> : null}
  </div>
  return <FilterPopover content={content} open={open} onOpenChange={setOpen}>
    <button ref={trigger} type="button" className={styles.trigger} data-state={ready ? 'connected' : closed ? 'closed' : 'connecting'} aria-label={copy.details} aria-expanded={open} aria-controls={open ? id : undefined} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <span className={styles.dot} aria-hidden="true" /><span role="status">{path}</span>
      {ready && stats?.path ? <span className={styles.latency}>{latency}</span> : null}
      <ChevronDown size={12} aria-hidden="true" />
    </button>
  </FilterPopover>
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div><dt>{icon}{label}</dt><dd>{value}</dd></div>
}
