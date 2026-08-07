import { AlertCircle, CheckCircle2, CircleDashed, CircleOff } from 'lucide-react'

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

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const Icon = iconMap[status]
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  )
}
