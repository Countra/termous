import type { ReactNode } from 'react'
import { Button } from 'antd'
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
  const hasDownloadProgress = snapshot.phase === 'downloading' && Boolean(progress)
  const errorMessage = snapshot.phase === 'error'
    ? errorCopy(snapshot.error_code, language)
    : null

  return (
    <section
      className={`update-window-status-panel${showInstallImpact ? ' is-install-ready' : ''}`}
      aria-live="polite"
    >
      <div className="update-window-status-heading">
        <span className={`update-window-status-icon is-${snapshot.phase}`} aria-hidden="true">
          {phaseIcon(snapshot.phase)}
        </span>
        <span>
          <strong>{phaseTitle(snapshot, text)}</strong>
          <small>{errorMessage ?? phaseDescription(snapshot, text)}</small>
        </span>
      </div>

      {showInstallImpact ? (
        <div className="update-window-impact-grid">
          <ImpactItem
            icon={<Terminal size={14} />}
            label={text.sshSessions}
            value={confirmation.summary.ssh_sessions}
          />
          <ImpactItem
            icon={<FolderOpen size={14} />}
            label={text.fileSessions}
            value={confirmation.summary.file_sessions}
          />
          <ImpactItem
            icon={<Network size={14} />}
            label={text.forwards}
            value={confirmation.summary.forwards}
          />
          <ImpactItem
            icon={<Download size={14} />}
            label={text.transfers}
            value={confirmation.summary.transfers_complete
              ? confirmation.summary.transfers
              : text.unknownCount}
          />
          <p className="update-window-impact-note">
            {!confirmation.summary.transfers_complete
              ? text.transferSummaryIncomplete
              : summarizeRuntimeImpact(confirmation.summary) > 0
                ? text.activeWorkWillClose
                : text.noActiveWork}
          </p>
        </div>
      ) : (
        <>
          <div
            className="update-window-progress-track"
            {...(hasDownloadProgress ? {
              role: 'progressbar',
              'aria-label': text.downloadProgress,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': Math.round(percent),
            } : { 'aria-hidden': true })}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="update-window-progress-metrics">
            <ProgressMetric
              label={text.downloaded}
              value={progress
                ? `${formatUpdateBytes(progress.transferred, language)} / ${formatUpdateBytes(progress.total, language)}`
                : '—'}
            />
            <ProgressMetric
              label={text.speed}
              value={progress && progress.bytes_per_second > 0
                ? `${formatUpdateBytes(progress.bytes_per_second, language)}/s`
                : '—'}
            />
            <ProgressMetric
              label={text.remaining}
              value={formatUpdateDuration(eta, language)}
            />
          </div>
        </>
      )}

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

function ImpactItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
}) {
  return (
    <span className="update-window-impact-item">
      <span aria-hidden="true">{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function ProgressMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="update-window-progress-metric">
      <small>{label}</small>
      <strong>{value}</strong>
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
