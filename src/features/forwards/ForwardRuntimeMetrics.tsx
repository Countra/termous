import { ArrowDownLeft, ArrowUpRight, Cable, Clock3, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ForwardInstance } from '../../types/domain'
import { formatBytes } from '../files/fileUtils'
import { formatForwardDuration } from './forwardTiming'

interface ForwardRuntimeMetricsProps {
  forward: ForwardInstance
  now?: number
  compact?: boolean
  showTiming?: boolean
}

export function ForwardRuntimeMetrics({
  forward,
  now = Date.now(),
  compact = false,
  showTiming = true,
}: ForwardRuntimeMetricsProps) {
  const { t } = useTranslation()

  return (
    <div className={`forward-runtime-metrics${compact ? ' is-compact' : ''}`}>
      <Metric icon={<Cable size={13} />} label={t('forwards.connections')} value={String(forward.active_connections)} />
      <Metric icon={<ArrowUpRight size={13} />} label={t('forwards.sent')} value={formatBytes(forward.bytes_out)} />
      <Metric icon={<ArrowDownLeft size={13} />} label={t('forwards.received')} value={formatBytes(forward.bytes_in)} />
      {showTiming ? (
        <>
          <Metric icon={<Clock3 size={13} />} label={t('forwards.startedAt')} value={formatTime(forward.started_at)} />
          <Metric icon={<Timer size={13} />} label={t('forwards.duration')} value={formatForwardDuration(forward.started_at, now)} />
        </>
      ) : null}
    </div>
  )
}

function Metric({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <span className="forward-runtime-metric">
      <span className="forward-runtime-metric-icon" aria-hidden="true">{icon}</span>
      <span className="forward-runtime-metric-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </span>
  )
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value || '-'
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
