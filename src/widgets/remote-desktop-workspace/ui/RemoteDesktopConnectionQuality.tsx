import { Popover } from 'antd'
import { Activity, ArrowDown, ArrowUp, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVncConnectionMetrics } from '#features/remote-desktop'
import {
  formatBytes,
  formatDuration,
  formatRate,
  formatSshRtt,
  transportHealth,
} from '../model/connectionQuality.ts'
import styles from './RemoteDesktopConnectionQuality.module.scss'

export function RemoteDesktopConnectionQuality({
  sessionId,
  connected,
}: {
  sessionId: string
  connected: boolean
}) {
  const { t } = useTranslation()
  const metrics = useVncConnectionMetrics(sessionId)
  if (!connected || metrics.connectedAt === null) {
    return null
  }
  const health = transportHealth(metrics.bufferedAmount)
  const healthClassName = styles[`is-${health}`]
  const sshRtt = formatSshRtt(metrics.sshRttMs, metrics.sshRttSampledAt)
  const details = (
    <div className={`${styles.details} ${healthClassName}`}>
      <div className={styles['details-heading']}>
        <Activity className={styles['heading-icon']} size={16} strokeWidth={1.8} />
        <div className={styles['heading-copy']}>
          <strong>{t(`remoteDesktop.connectionQuality.${health}`)}</strong>
          <span>{t('remoteDesktop.connectionQuality.duration')} · {formatDuration(metrics.sampledAt - metrics.connectedAt)}</span>
        </div>
      </div>
      <div className={styles['live-metrics']}>
        <PrimaryMetric
          icon={<Timer size={13} strokeWidth={1.8} />}
          label={t('remoteDesktop.connectionQuality.sshLatency')}
          value={sshRtt}
        />
        <PrimaryMetric
          icon={<ArrowDown size={13} strokeWidth={1.8} />}
          label={t('remoteDesktop.connectionQuality.receiveRate')}
          value={formatRate(metrics.receiveBytesPerSecond)}
        />
        <PrimaryMetric
          icon={<ArrowUp size={13} strokeWidth={1.8} />}
          label={t('remoteDesktop.connectionQuality.sendRate')}
          value={metrics.outboundMeasured ? formatRate(metrics.sendBytesPerSecond) : '--'}
        />
      </div>
      <dl className={styles.metrics}>
        <MetricRow label={t('remoteDesktop.connectionQuality.received')} value={formatBytes(metrics.receivedBytes)} />
        <MetricRow label={t('remoteDesktop.connectionQuality.sent')} value={metrics.outboundMeasured ? formatBytes(metrics.sentBytes) : '--'} />
        <MetricRow label={t('remoteDesktop.connectionQuality.sendQueue')} value={formatBytes(metrics.bufferedAmount)} />
      </dl>
    </div>
  )
  return (
    <Popover
      trigger="click"
      placement="topRight"
      arrow={false}
      content={details}
      classNames={{ root: styles.popover }}
      getPopupContainer={() => document.body}
    >
      <button
        type="button"
        className={`${styles.summary} ${healthClassName}`}
        aria-label={t('remoteDesktop.connectionQuality.details')}
      >
        <span className={styles['summary-status']}>
          <span className={styles.indicator} />
          <span className={styles['health-label']}>{t(`remoteDesktop.connectionQuality.${health}`)}</span>
        </span>
        <span className={styles['summary-divider']} />
        <SummaryMetric icon={<Timer size={11} />} value={sshRtt} compact />
        <SummaryMetric icon={<ArrowDown size={11} />} value={formatRate(metrics.receiveBytesPerSecond)} />
        {metrics.outboundMeasured ? (
          <SummaryMetric icon={<ArrowUp size={11} />} value={formatRate(metrics.sendBytesPerSecond)} />
        ) : null}
      </button>
    </Popover>
  )
}

function PrimaryMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className={styles['primary-metric']}>
      <span className={styles['metric-label']}>
        {icon}
        <span>{label}</span>
      </span>
      <strong>{value}</strong>
    </div>
  )
}

function SummaryMetric({
  icon,
  value,
  compact = false,
}: {
  icon: React.ReactNode
  value: string
  compact?: boolean
}) {
  return (
    <span className={`${styles['summary-metric']} ${compact ? styles['is-compact'] : ''}`}>
      <span className={styles['summary-metric-icon']} aria-hidden="true">{icon}</span>
      <span className={styles['summary-metric-value']}>{value}</span>
    </span>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
