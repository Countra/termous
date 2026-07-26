import {
  Alert,
  Button,
  Descriptions,
  Progress,
  Spin,
  Typography,
} from 'antd'
import {
  Check,
  CircleAlert,
  Download,
  RefreshCw,
} from 'lucide-react'
import type { UpdateInstallConfirmation } from '../../../electron/updateRuntime'
import type { UpdateWindowLanguage } from '../../../electron/updateWindow'
import type { UpdateSnapshot } from '../../../electron/updateTypes'
import {
  calculateUpdateEta,
  canPrepareUpdateInstall,
  formatUpdateBytes,
  formatUpdateDuration,
  hasUpdateInstallInterruption,
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
  const showInstallWarning = Boolean(
    installConfirmationNeeded
    && confirmation
    && hasUpdateInstallInterruption(confirmation.summary),
  )
  const showConfirmationState = installConfirmationNeeded && !confirmation
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
        showInstallWarning ? 'has-install-warning' : '',
        !showInstallWarning && !showDownloadMetrics && !showConfirmationState ? 'is-compact' : '',
        !description ? 'is-title-only' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="update-window-status-heading">
        <span className={`update-window-status-icon is-${snapshot.phase}`} aria-hidden="true">
          {phaseIcon(snapshot.phase, showInstallWarning)}
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

      {showInstallWarning ? (
        <Alert
          className="update-window-install-warning"
          type="warning"
          showIcon
          title={text.activeWorkWillClose}
        />
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

      {showConfirmationState ? (
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
            {text.preparingInstallStatus}
          </span>
        )
      ) : null}
    </section>
  )
}

function phaseIcon(
  phase: UpdateSnapshot['phase'],
  installWarning = false,
) {
  if (installWarning) {
    return <CircleAlert size={16} />
  }
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
