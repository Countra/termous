import type { ReactNode } from 'react'
import {
  Button,
  Descriptions,
  Progress,
  Typography,
} from 'antd'
import {
  Check,
  CircleAlert,
  Download,
  FolderOpen,
  LoaderCircle,
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
  const showDownloadMetrics = Boolean(
    progress
    && (
      snapshot.phase === 'downloading'
      || snapshot.phase === 'error'
    ),
  )
  const errorMessage = snapshot.phase === 'error'
    ? errorCopy(snapshot.error_code, language)
    : null
  const progressStatus = snapshot.phase === 'error'
    ? 'exception'
    : snapshot.phase === 'downloaded'
      ? 'success'
      : snapshot.phase === 'downloading'
        ? 'active'
        : 'normal'

  return (
    <section
      className={[
        'update-window-status-panel',
        showInstallImpact ? 'is-install-ready' : '',
        !showInstallImpact && !showDownloadMetrics ? 'is-compact' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="update-window-status-heading">
        <span className={`update-window-status-icon is-${snapshot.phase}`} aria-hidden="true">
          {phaseIcon(snapshot.phase)}
        </span>
        <div>
          <Typography.Text strong>{phaseTitle(snapshot, text)}</Typography.Text>
          <Typography.Text
            type="secondary"
            aria-live="polite"
            aria-atomic="true"
          >
            {errorMessage ?? phaseDescription(snapshot, text)}
          </Typography.Text>
        </div>
      </div>

      {showInstallImpact ? (
        <div className="update-window-impact">
          <Descriptions
            className="update-window-impact-grid"
            size="small"
            colon={false}
            column={{ xs: 2, sm: 4 }}
            items={[
              {
                key: 'ssh',
                label: <ImpactLabel icon={<Terminal size={14} />} text={text.sshSessions} />,
                children: <Typography.Text strong>{confirmation.summary.ssh_sessions}</Typography.Text>,
              },
              {
                key: 'sftp',
                label: <ImpactLabel icon={<FolderOpen size={14} />} text={text.fileSessions} />,
                children: <Typography.Text strong>{confirmation.summary.file_sessions}</Typography.Text>,
              },
              {
                key: 'forwards',
                label: <ImpactLabel icon={<Network size={14} />} text={text.forwards} />,
                children: <Typography.Text strong>{confirmation.summary.forwards}</Typography.Text>,
              },
              {
                key: 'transfers',
                label: <ImpactLabel icon={<Download size={14} />} text={text.transfers} />,
                children: (
                  <Typography.Text strong>
                    {confirmation.summary.transfers_complete
                      ? confirmation.summary.transfers
                      : text.unknownCount}
                  </Typography.Text>
                ),
              },
            ]}
          />
          <Typography.Paragraph className="update-window-impact-note">
            {!confirmation.summary.transfers_complete
              ? text.transferSummaryIncomplete
              : summarizeRuntimeImpact(confirmation.summary) > 0
                ? text.activeWorkWillClose
                : text.noActiveWork}
          </Typography.Paragraph>
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
        <span className="update-window-confirmation-status">
          {confirmationUnavailable ? (
            <>
              <CircleAlert size={13} aria-hidden="true" />
              <span>{text.summaryUnavailable}</span>
              <Button
                type="link"
                size="small"
                loading={confirmationBusy}
                onClick={onRetryConfirmation}
              >
                {text.retrySummary}
              </Button>
            </>
          ) : (
            <>
              <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
              {text.readingImpact}
            </>
          )}
        </span>
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
    return <LoaderCircle className="is-spinning" size={16} />
  }
  if (phase === 'downloading') {
    return <Download size={16} />
  }
  return <RefreshCw size={16} />
}
