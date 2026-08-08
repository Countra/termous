import { AlertCircle, CheckCircle2, CircleDashed, CircleOff } from 'lucide-react'
import styles from './StatusBadge.module.scss'

export type StatusBadgeStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'failed'
  | 'available'
  | 'offline'
  | 'persisted'

interface StatusBadgeProps {
  status: StatusBadgeStatus
  label: string
  className?: string
}

const iconMap = {
  connected: CheckCircle2,
  connecting: CircleDashed,
  disconnected: CircleOff,
  failed: AlertCircle,
  available: CheckCircle2,
  offline: AlertCircle,
  persisted: CheckCircle2,
}

const toneClassMap: Partial<Record<StatusBadgeStatus, string>> = {
  connected: styles['is-success'],
  available: styles['is-success'],
  persisted: styles['is-success'],
  failed: styles['is-danger'],
  offline: styles['is-danger'],
  connecting: styles['is-warning'],
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const Icon = iconMap[status]
  return (
    <span className={[
      styles['status-badge'],
      toneClassMap[status],
      className,
      'status-badge',
      `status-${status}`,
    ].filter(Boolean).join(' ')}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  )
}
