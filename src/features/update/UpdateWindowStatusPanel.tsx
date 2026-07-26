import type { ReactNode } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Progress,
  Spin,
  Statistic,
  Typography,
} from 'antd'
import {
  Check,
  CircleAlert,
  Download,
  FolderOpen,
  Network,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import type { UpdateInstallConfirmation } from '../../../electron/updateRuntime'
import type { UpdateWindowLanguage } from '../../../electron/updateWindow'
import type { UpdateSnapshot } from '../../../electron/updateTypes'
import {
  calculateUpdateEta,
  canPrepareUpdateInstall,
  formatUpdateBytes,
  formatUpdateDuration,
  summarizeRuntimeImpact,
} from './updateWindowUiState'
import {
  errorCopy,
  phaseDescription,
  phaseTitle,
  type UpdateWindowText,
} from './updateWindowCopy'

export function UpdateWindowStatusPanel({
  confirmation,
  confirmationUnavailable,
  language,
  confirmationBusy,
  onRetryConfirmation,
  snapshot,
  text,
}: {
  confirmation: UpdateInstallConfirmation | null
  confirmationUnavailable: boolean
  language: UpdateWindowLanguage
  confirmationBusy: boolean
  onRetryConfirmation: () => void
  snapshot: UpdateSnapshot
  text: UpdateWindowText
}) {
  const progress = snapshot.progress
  const percent = Math.min(100, Math.max(0, progress?.percent ?? 0))
  const eta = calculateUpdateEta(progress)
  const installConfirmationNeeded = canPrepareUpdateInstall(snapshot)
  const showInstallImpact = installConfirmationNeeded && confirmation
  const runtimeImpact = confirmation
    ? summarizeRuntimeImpact(confirmation.summary)
    : 0
  const isInstallFailure = (
    snapshot.phase === 'error'
    && (
      snapshot.error_code === 'UPDATE_CORE_SHUTDOWN_FAILED'
      || snapshot.error_code === 'UPDATE_INSTALL_SUMMARY_STALE'
      || snapshot.error_code === 'UPDATE_INSTALL_START_FAILED'
    )
  )
  const showDownloadMetrics = Boolean(
    progress
    && !isInstallFailure
    && (
      snapshot.phase === 'downloading'
      || snapshot.phase === 'error'
    ),
  )
  const errorMessage = snapshot.phase === 'error'
    ? errorCopy(snapshot.error_code, language)
    : null
  const description = errorMessage ?? phaseDescription(snapshot, text)
  const progressStatus = snapshot.phase === 'error'
    ? 'exception'
    : snapshot.phase === 'downloaded'
      ? 'success'
        : snapshot.phase === 'downloading'
          ? 'active'
          : 'normal'

  if (snapshot.phase === 'unsupported') {
    return (
      <section className="update-window-status-panel is-unsupported">
        <Alert
          className="update-window-unsupported-alert"
          type="warning"
          variant="filled"
          showIcon
          title={phaseTitle(snapshot, text)}
          description={phaseDescription(snapshot, text)}
        />
      </section>
    )
  }

  return (
    <section
      className={[
        'update-window-status-panel',
        showInstallImpact ? 'is-install-ready' : '',
        !showInstallImpact && !showDownloadMetrics ? 'is-compact' : '',
        !description ? 'is-title-only' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="update-window-status-heading">
        <span className={`update-window-status-icon is-${snapshot.phase}`} aria-hidden="true">
          {phaseIcon(snapshot.phase)}
        </span>
        <div className="update-window-status-copy">
          <div className="update-window-status-title-row">
            <div
              className="update-window-status-announcement"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <Typography.Title level={3}>
                {phaseTitle(snapshot, text)}
              </Typography.Title>
              {description ? (
                <Typography.Text type="secondary">
                  {description}
                </Typography.Text>
              ) : null}
            </div>
            {showDownloadMetrics ? (
              <Typography.Text className="update-window-progress-percent">
                {Math.round(percent)}%
              </Typography.Text>
            ) : null}
          </div>
        </div>
      </div>

      {showInstallImpact ? (
        <div className="update-window-impact">
          <div className="update-window-impact-grid">
            <Statistic
              title={<ImpactLabel icon={<Terminal size={14} />} text={text.sshSessions} />}
              value={confirmation.summary.ssh_sessions}
            />
            <Statistic
              title={<ImpactLabel icon={<FolderOpen size={14} />} text={text.fileSessions} />}
              value={confirmation.summary.file_sessions}
            />
            <Statistic
              title={<ImpactLabel icon={<Network size={14} />} text={text.forwards} />}
              value={confirmation.summary.forwards}
            />
            <Statistic
              title={<ImpactLabel icon={<Download size={14} />} text={text.transfers} />}
              value={confirmation.summary.transfers_complete
                ? confirmation.summary.transfers
                : text.unknownCount}
            />
          </div>
          {!confirmation.summary.transfers_complete || runtimeImpact > 0 ? (
            <Alert
              className="update-window-impact-alert"
              type="warning"
              showIcon
              title={!confirmation.summary.transfers_complete
                ? text.transferSummaryIncomplete
                : text.activeWorkWillClose}
            />
          ) : (
            <Typography.Paragraph className="update-window-impact-note">
              {text.noActiveWork}
            </Typography.Paragraph>
          )}
        </div>
      ) : showDownloadMetrics ? (
        <div className="update-window-download-progress">
          <Progress
            className="update-window-progress"
            aria-label={text.downloadProgress}
            percent={percent}
            showInfo={false}
            size="small"
            status={progressStatus}
            strokeLinecap="round"
          />
          <Descriptions
            className="update-window-progress-metrics"
            size="small"
            colon={false}
            column={{ xs: 1, sm: 3 }}
            items={[
              {
                key: 'downloaded',
                label: text.downloaded,
                children: (
                  <Typography.Text>
                    {progress
                      ? `${formatUpdateBytes(progress.transferred, language)} / ${formatUpdateBytes(progress.total, language)}`
                      : text.unavailable}
                  </Typography.Text>
                ),
              },
              {
                key: 'speed',
                label: text.speed,
                children: (
                  <Typography.Text>
                    {progress && progress.bytes_per_second > 0
                      ? `${formatUpdateBytes(progress.bytes_per_second, language)}/s`
                      : text.unavailable}
                  </Typography.Text>
                ),
              },
              {
                key: 'remaining',
                label: text.remaining,
                children: (
                  <Typography.Text>
                    {formatUpdateDuration(eta, language)}
                  </Typography.Text>
                ),
              },
            ]}
          />
        </div>
      ) : null}

      {installConfirmationNeeded && !confirmation ? (
        confirmationUnavailable ? (
          <Alert
            className="update-window-confirmation-alert"
            type="warning"
            showIcon
            title={text.summaryUnavailable}
            action={(
              <Button
                type="link"
                size="small"
                loading={confirmationBusy}
                onClick={onRetryConfirmation}
              >
                {text.retrySummary}
              </Button>
            )}
          />
        ) : (
          <span
            className="update-window-confirmation-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <Spin size="small" />
            {text.readingImpact}
          </span>
        )
      ) : null}
    </section>
  )
}

function ImpactLabel({
  icon,
  text,
}: {
  icon: ReactNode
  text: string
}) {
  return (
    <span className="update-window-impact-label">
      <span aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </span>
  )
}

function phaseIcon(phase: UpdateSnapshot['phase']) {
  if (phase === 'downloaded' || phase === 'up_to_date') {
    return <Check size={16} />
  }
  if (phase === 'error' || phase === 'unsupported') {
    return <CircleAlert size={16} />
  }
  if (phase === 'checking' || phase === 'preparing_install' || phase === 'installing') {
    return <Spin size="small" />
  }
  if (phase === 'downloading') {
    return <Download size={16} />
  }
  return <RefreshCw size={16} />
}
