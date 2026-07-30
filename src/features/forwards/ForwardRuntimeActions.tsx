import { RefreshCw, Square } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ForwardInstance } from '../../types/domain'
import {
  forwardRuntimeActionAvailability,
  type ForwardRuntimeAction,
} from './forwardRestart'

interface ForwardRuntimeActionsProps {
  forward: ForwardInstance
  disabled?: boolean
  onRestart: () => Promise<void>
  onStop: () => Promise<void>
}

export function ForwardRuntimeActions({
  forward,
  disabled = false,
  onRestart,
  onStop,
}: ForwardRuntimeActionsProps) {
  const { t } = useTranslation()
  const [pendingAction, setPendingAction] = useState<ForwardRuntimeAction | null>(null)
  const pendingActionRef = useRef<ForwardRuntimeAction | null>(null)
  const availability = forwardRuntimeActionAvailability(forward.status)
  const busy = disabled || pendingAction !== null

  const runAction = async (
    action: ForwardRuntimeAction,
    operation: () => Promise<void>,
  ) => {
    if (disabled || pendingActionRef.current !== null || !availability[action]) {
      return
    }
    pendingActionRef.current = action
    setPendingAction(action)
    try {
      await operation()
    } finally {
      pendingActionRef.current = null
      setPendingAction(null)
    }
  }

  return (
    <div
      className="forward-runtime-actions"
      role="group"
      aria-label={t('forwards.runtimeActions')}
      aria-busy={pendingAction !== null}
    >
      <Tooltip
        title={t('forwards.restartForward')}
        mouseEnterDelay={0.3}
        classNames={{ root: 'forward-route-tooltip' }}
      >
        <span className="forward-runtime-action-trigger">
          <Button
            type="text"
            className="forward-runtime-action is-restart"
            aria-label={t('forwards.restartForward')}
            disabled={busy || !availability.restart}
            loading={pendingAction === 'restart'}
            icon={<RefreshCw size={13} />}
            onClick={() => void runAction('restart', onRestart)}
          />
        </span>
      </Tooltip>
      <span className="forward-runtime-action-divider" aria-hidden="true" />
      <Tooltip
        title={t('forwards.stopForward')}
        mouseEnterDelay={0.3}
        classNames={{ root: 'forward-route-tooltip' }}
      >
        <span className="forward-runtime-action-trigger">
          <Button
            type="text"
            className="forward-runtime-action is-stop"
            aria-label={t('forwards.stopForward')}
            disabled={busy || !availability.stop}
            loading={pendingAction === 'stop'}
            icon={<Square size={12} />}
            onClick={() => void runAction('stop', onStop)}
          />
        </span>
      </Tooltip>
    </div>
  )
}
