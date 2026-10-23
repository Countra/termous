import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalValue } from './ApprovalDetailFields'
import { ApprovalNotice } from './ApprovalNotice'
import styles from './ApprovalDetails.module.scss'

export function AnalysisApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  return <>
    <section className={styles.operation}>
      <ApprovalValue label={t('analysisCenter.id')} value={operation.resource_id || '—'} code />
    </section>
    <ApprovalNotice warning title={t('settings.mcp.analysisDeleteTitle')} description={t('settings.mcp.analysisDeleteDescription')} />
  </>
}
