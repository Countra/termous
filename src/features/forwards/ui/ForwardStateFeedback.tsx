import { AlertCircle, CircleDot } from 'lucide-react'
import { Progress, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ForwardInstance } from '#entities/forward'

interface ForwardStateFeedbackProps {
  forward: ForwardInstance
  compact?: boolean
}

export function ForwardStateFeedback({ forward, compact = false }: ForwardStateFeedbackProps) {
  const { t } = useTranslation()
  const transitioning = forward.status === 'starting' || forward.status === 'waiting_host_trust' || forward.status === 'stopping'

  if (!transitioning && forward.status !== 'failed') {
    return null
  }

  if (forward.status === 'failed') {
    const error = forward.last_error || forward.status_message || t('forwards.status.failed')
    return (
      <Tooltip title={error} mouseEnterDelay={0.3} classNames={{ root: 'forward-route-tooltip' }}>
        <div className={`forward-state-feedback is-failed${compact ? ' is-compact' : ''}`} role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          <span>{error}</span>
        </div>
      </Tooltip>
    )
  }

  return (
    <div className={`forward-state-feedback is-transitioning${compact ? ' is-compact' : ''}`} role="status">
      <div className="forward-state-feedback-copy">
        <span>
          <CircleDot size={13} aria-hidden="true" />
          {t(`forwards.phaseName.${forward.phase}`)}
        </span>
        <strong>{Math.max(0, Math.min(100, forward.progress || 0))}%</strong>
      </div>
      <Progress percent={Math.max(0, Math.min(100, forward.progress || 0))} showInfo={false} status="active" />
    </div>
  )
}
