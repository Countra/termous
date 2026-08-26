import { Tooltip } from 'antd'
import { Activity, Globe2, RefreshCcw, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostReachability } from '#entities/host'
import {
  formatReachabilityLatency,
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

  return (
    <Tooltip title={label}>
      <span className="host-latency-value" aria-label={label}>
        <span className={`host-latency-signal is-${level}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{formatReachabilityLatency(state, t)}</span>
      </span>
    </Tooltip>
  )
}
