import { Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from '../McpApprovalCoordinator.module.scss'

interface McpApprovalExpiryProps {
  expired: boolean
  remainingSeconds: number
}

export function McpApprovalExpiry({ expired, remainingSeconds }: McpApprovalExpiryProps) {
  const { t } = useTranslation()
  return (
    <span className={styles.expiry}>
      <Clock3 size={14} aria-hidden="true" />
      {expired ? (
        <span role="status">{t('settings.mcp.approval.expired')}</span>
      ) : t('settings.mcp.approval.expiresIn', { time: formatCountdown(remainingSeconds) })}
    </span>
  )
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
