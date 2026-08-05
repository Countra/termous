import { ArrowDownLeft, ArrowUpRight, Cable, Clock3, Timer } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ForwardInstance } from '../../types/domain'
import { formatBytes } from '#shared/format'
import { formatForwardDuration } from './forwardTiming'
import { mapForwardTraffic } from './forwardThroughput'
import { useForwardThroughput } from './useForwardThroughput'

interface ForwardRuntimeMetricsProps {
  forward: ForwardInstance
  now?: number
  compact?: boolean
  showTiming?: boolean
  enabled?: boolean
}

export function ForwardRuntimeMetrics({
  forward,
  now = Date.now(),
  compact = false,
  showTiming = true,
  enabled = true,
}: ForwardRuntimeMetricsProps) {
  const { t } = useTranslation()
  const throughput = useForwardThroughput(forward, enabled)
  const traffic = mapForwardTraffic(forward.bytes_in, forward.bytes_out, throughput)
  const sent = formatBytes(traffic.sentTotal)
  const received = formatBytes(traffic.receivedTotal)
  const sendRate = t('forwards.speedValue', { value: formatBytes(traffic.sentPerSecond) })
  const receiveRate = t('forwards.speedValue', { value: formatBytes(traffic.receivedPerSecond) })

  return (
    <div
      className={`forward-runtime-metrics${compact ? ' is-compact' : ''}`}
      role="group"
      aria-label={t('forwards.runtimeMetrics')}
    >
      <Metric
        className="is-connections"
        icon={<Cable size={13} />}
        label={t('forwards.connections')}
        value={String(forward.active_connections)}
      />
      <Metric
        icon={<ArrowUpRight size={13} />}
        label={t('forwards.sent')}
        value={sent}
        rate={sendRate}
        rateLabel={t('forwards.sendRate')}
        totalLabel={t('forwards.totalTraffic')}
        rateActive={throughput.sending}
        tone="sent"
      />
      <Metric
        icon={<ArrowDownLeft size={13} />}
        label={t('forwards.received')}
        value={received}
        rate={receiveRate}
        rateLabel={t('forwards.receiveRate')}
        totalLabel={t('forwards.totalTraffic')}
        rateActive={throughput.receiving}
        tone="received"
      />
      {showTiming ? (
        <>
          <Metric icon={<Clock3 size={13} />} label={t('forwards.startedAt')} value={formatTime(forward.started_at)} />
          <Metric icon={<Timer size={13} />} label={t('forwards.duration')} value={formatForwardDuration(forward.started_at, now)} />
        </>
      ) : null}
    </div>
  )
}

function Metric({
  className = '',
  icon,
  label,
  value,
  rate,
  rateLabel,
  totalLabel,
  rateActive = false,
  tone,
}: {
  className?: string
  icon: ReactNode
  label: string
  value: string
  rate?: string
  rateLabel?: string
  totalLabel?: string
  rateActive?: boolean
  tone?: 'sent' | 'received'
}) {
  const detailRef = useRef<HTMLSpanElement>(null)
  const positionDetail = (target: HTMLSpanElement) => {
    const detail = detailRef.current
    if (!detail) {
      return
    }
    if (!detail.matches(':popover-open')) {
      detail.showPopover()
    }
    const targetRect = target.getBoundingClientRect()
    const detailWidth = detail.offsetWidth
    const detailHeight = detail.offsetHeight
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const viewportPadding = 8
    const gap = 8
    const availableAbove = targetRect.top - viewportPadding - gap
    const availableBelow = viewportHeight - targetRect.bottom - viewportPadding - gap
    const placement = availableAbove >= detailHeight || availableAbove >= availableBelow ? 'above' : 'below'
    const desiredTop = placement === 'above'
      ? targetRect.top - detailHeight - gap
      : targetRect.bottom + gap
    const maxTop = Math.max(viewportPadding, viewportHeight - detailHeight - viewportPadding)
    const top = Math.min(maxTop, Math.max(viewportPadding, desiredTop))
    const desiredLeft = targetRect.left + targetRect.width / 2 - detailWidth / 2
    const maxLeft = Math.max(viewportPadding, viewportWidth - detailWidth - viewportPadding)
    const left = Math.min(maxLeft, Math.max(viewportPadding, desiredLeft))
    const arrowLeft = Math.min(
      detailWidth - 18,
      Math.max(9, targetRect.left + targetRect.width / 2 - left - 5),
    )

    detail.dataset.placement = placement
    detail.style.setProperty('--forward-detail-left', `${Math.round(left)}px`)
    detail.style.setProperty('--forward-detail-top', `${Math.round(top)}px`)
    detail.style.setProperty('--forward-detail-arrow-left', `${Math.round(arrowLeft)}px`)
  }
  const hideDetail = (target: HTMLSpanElement) => {
    const detail = detailRef.current
    if (
      detail
      && detail.matches(':popover-open')
      && document.activeElement !== target
    ) {
      detail.hidePopover()
    }
  }

  return (
    <span
      className={[
        'forward-runtime-metric',
        rate ? 'has-rate' : '',
        rateActive ? 'is-rate-active' : '',
        tone ? `is-${tone}` : '',
        className,
      ].filter(Boolean).join(' ')}
      role="group"
      aria-label={rate && rateLabel ? `${label}: ${value}; ${rateLabel}: ${rate}` : `${label}: ${value}`}
      tabIndex={rate ? 0 : undefined}
      onFocus={rate ? (event) => positionDetail(event.currentTarget) : undefined}
      onBlur={rate ? () => {
        if (detailRef.current?.matches(':popover-open')) {
          detailRef.current.hidePopover()
        }
      } : undefined}
      onPointerEnter={rate ? (event) => positionDetail(event.currentTarget) : undefined}
      onPointerLeave={rate ? (event) => hideDetail(event.currentTarget) : undefined}
      onKeyDown={rate ? (event) => {
        if (event.key === 'Escape') {
          if (detailRef.current?.matches(':popover-open')) {
            detailRef.current.hidePopover()
          }
          event.currentTarget.blur()
        }
      } : undefined}
    >
      <span className="forward-runtime-metric-icon" aria-hidden="true">{icon}</span>
      <span className="forward-runtime-metric-copy" aria-hidden="true">
        {rate ? (
          <>
            <span className="forward-runtime-summary">
              <small className="forward-runtime-metric-label">{label}</small>
              <span className="forward-runtime-total">{value}</span>
            </span>
            <span className="forward-runtime-rate" aria-hidden="true">
              <i aria-hidden="true" />
              <strong>{rate}</strong>
            </span>
            <span ref={detailRef} className="forward-runtime-metric-detail" aria-hidden="true" popover="manual">
              <span className="forward-runtime-metric-detail-heading">
                <i />
                <strong>{label}</strong>
              </span>
              <span className="forward-runtime-metric-detail-row">
                <small>{totalLabel}</small>
                <b>{value}</b>
              </span>
              <span className="forward-runtime-metric-detail-row is-rate">
                <small>{rateLabel}</small>
                <b>{rate}</b>
              </span>
            </span>
          </>
        ) : (
          <>
            <small className="forward-runtime-metric-label">{label}</small>
            <strong className="forward-runtime-value">{value}</strong>
          </>
        )}
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
