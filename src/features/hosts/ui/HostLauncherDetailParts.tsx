import { Tooltip } from 'antd'
import { Activity, Clock3, Globe2, RefreshCcw, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostReachability } from '#entities/host'
import {
  formatReachabilityLatency,
  formatDateTime,
  latencyLevel,
  latencySignalLabel,
  reachabilityTooltip,
} from '../model/hostLauncherListModel.ts'

export function DetailItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
}) {
  return (
    <div className="host-launcher-detail-item">
      <span className="host-launcher-detail-icon">
        {icon}
      </span>
      <div className="host-launcher-detail-copy">
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </div>
  )
}

export function HostReachabilityDot({
  state,
  usesProxy = false,
}: {
  state?: HostReachability
  usesProxy?: boolean
}) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  const label = reachabilityTooltip(state, t, usesProxy)
  return (
    <Tooltip title={label}>
      <span className={`host-reachability-dot is-${status}`} aria-label={label} />
    </Tooltip>
  )
}

export function HostReachabilityPill({
  state,
  usesProxy = false,
}: {
  state?: HostReachability
  usesProxy?: boolean
}) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  const Icon = status === 'online'
    ? Activity
    : status === 'checking'
      ? RefreshCcw
      : status === 'offline'
        ? WifiOff
        : Globe2
  return (
    <Tooltip title={reachabilityTooltip(state, t, usesProxy)}>
      <span className={`host-reachability-pill is-${status}`}>
        <Icon size={13} aria-hidden="true" />
        <span>{t(`workbench.hostLauncher.reachability.${status}`)}</span>
      </span>
    </Tooltip>
  )
}

export function LatencyValue({ state }: { state?: HostReachability }) {
  const { t } = useTranslation()
  const level = latencyLevel(state)
  const label = latencySignalLabel(state, t)
  const checkedAt = formatDateTime(state?.checked_at, '')
  const sampleTimeLabel = checkedAt
    ? t('workbench.hostLauncher.latencySampleTime', { time: checkedAt })
    : ''
  const accessibleLabel = [label, sampleTimeLabel].filter(Boolean).join(' · ')

  return (
    <Tooltip title={accessibleLabel}>
      <span className="host-latency-value" aria-label={accessibleLabel}>
        <span className="host-latency-main">
          <span className={`host-latency-signal is-${level}`} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>{formatReachabilityLatency(state, t)}</span>
        </span>
        {checkedAt ? (
          <time className="host-latency-sample" dateTime={state?.checked_at}>
            <Clock3 size={10} aria-hidden="true" />
            <span>{checkedAt}</span>
          </time>
        ) : null}
      </span>
    </Tooltip>
  )
}
