import { Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalScrollableValue, ApprovalValue } from './ApprovalDetailFields'
import { LocalFileApproval } from './LocalFileApproval'
import styles from './ApprovalDetails.module.scss'

export function LocalApprovalRenderer({ operation, approvalId, readFileReview }: { operation: McpApprovalOperation; approvalId: string; readFileReview?: import('../../api/mcpAccessGateway').McpApprovalGateway['readFileReview'] }) {
  const { t } = useTranslation()
  const local = operation.local
  if (!local) return null
  const command = local.tool === 'termous.local.commands.execute'
  if (!command) return <LocalFileApproval key={local.path} file={local} approvalId={approvalId} readFileReview={readFileReview} />
  return <div className={styles.operation}>
    <div className={styles['operation-title']}><Terminal size={17} />
      <strong>{t('localTools.execute')}</strong></div>
    <ApprovalValue label={t('localTools.directory')} value={local.directory} code />
    <ApprovalValue label="Shell" value={local.shell!} />
    <ApprovalValue label={t('localTools.executable')} value={local.executable!} code />
    <ApprovalScrollableValue label={t('localTools.command')} value={local.command!} />
  </div>
}
