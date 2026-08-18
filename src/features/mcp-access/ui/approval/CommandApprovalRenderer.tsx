import { TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ApprovalScrollableCode } from './ApprovalDetailFields'
import styles from '../McpApprovalCoordinator.module.scss'

export function CommandApprovalRenderer({ command }: { command: string }) {
  const { t } = useTranslation()
  return (
    <div className={styles.operation}>
      <div className={styles['operation-title']}>
        <TerminalSquare size={16} aria-hidden="true" />
        <strong>{t('settings.mcp.approval.command')}</strong>
      </div>
      <ApprovalScrollableCode value={command} />
    </div>
  )
}
