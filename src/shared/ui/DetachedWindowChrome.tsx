import { Button, Tooltip } from 'antd'
import { AppWindow, ArrowUpRight, CornerDownLeft } from 'lucide-react'
import type { Ref } from 'react'
import styles from './DetachedWindow.module.scss'

export function DetachedWindowButton({ label, returning = false, busy = false, onClick }: {
  label: string; returning?: boolean; busy?: boolean; onClick: () => void
}) {
  return <Tooltip title={label}><Button type="text" aria-label={label} loading={busy} disabled={busy}
    icon={returning ? <CornerDownLeft size={16} /> : <AppWindow size={16} />} onClick={onClick} /></Tooltip>
}

export function DetachedWindowPlaceholder({ ref, capture, busy, restoring, title, description, returnLabel, focusLabel, onReturn, onFocus }: {
  ref?: Ref<HTMLElement>; capture?: string; busy: boolean; restoring: boolean
  title: string; description: string; returnLabel: string; focusLabel: string; onReturn: () => void; onFocus: () => void
}) {
  return <section ref={ref} className={styles.placeholder} data-motion={restoring ? 'leaving' : 'entering'} inert={restoring} aria-label={title}>
    {capture ? <img className={styles.capture} src={capture} alt="" aria-hidden="true" /> : <div className={styles.fallback} aria-hidden="true"><aside /><main><i /><i /><i /></main></div>}
    <div className={styles.scrim} />
    <div className={styles.card}>
      <span className={styles.mark}><AppWindow size={23} /></span>
      <h2>{title}</h2><p>{description}</p>
      <div className={styles.actions}>
        <Button type="primary" icon={<CornerDownLeft size={15} />} loading={busy} onClick={onReturn}>{returnLabel}</Button>
        <Button icon={<ArrowUpRight size={15} />} onClick={onFocus}>{focusLabel}</Button>
      </div>
    </div>
  </section>
}
