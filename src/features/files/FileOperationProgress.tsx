import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

export interface FileOperationProgressState {
  title: string
  description?: string
  progress: number
  status?: 'running' | 'success' | 'error'
  indeterminate?: boolean
}

interface FileOperationProgressProps extends FileOperationProgressState {
  compact?: boolean
}

export function FileOperationProgress({
  title,
  description,
  progress,
  status = 'running',
  indeterminate = false,
  compact = false,
}: FileOperationProgressProps) {
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress || 0)))
  const Icon = status === 'success' ? CheckCircle2 : status === 'error' ? AlertTriangle : Loader2
  const showPercent = !indeterminate || status !== 'running'

  return (
    <div className={`file-operation-progress is-${status} ${indeterminate ? 'is-indeterminate' : ''} ${compact ? 'is-compact' : ''}`}>
      <div className="file-operation-progress-main">
        <span className="file-operation-progress-icon">
          <Icon size={compact ? 14 : 16} aria-hidden="true" />
        </span>
        <div className="file-operation-progress-copy">
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        {showPercent ? <em>{normalizedProgress}%</em> : null}
      </div>
      <div
        className="file-operation-progress-bar"
        role="progressbar"
        aria-label={description ? `${title}: ${description}` : title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate && status === 'running' ? undefined : normalizedProgress}
      >
        <span style={indeterminate && status === 'running' ? undefined : { width: `${normalizedProgress}%` }} />
      </div>
    </div>
  )
}
