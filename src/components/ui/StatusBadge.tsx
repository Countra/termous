import { AlertCircle, CheckCircle2, CircleDashed, CircleOff } from 'lucide-react'
import type { SessionStatus } from '../../types/domain'

interface StatusBadgeProps {
  status: SessionStatus | 'available' | 'offline' | 'persisted'
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

