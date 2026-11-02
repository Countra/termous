import { FileArchive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalValue } from './ApprovalDetailFields'
import { ApprovalNotice } from './ApprovalNotice'
import styles from './ApprovalDetails.module.scss'

export function WorkflowExchangeApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const importing = operation.action === 'import'
  const prefix = 'desktopWorkflow.approval.exchange'
  return <>
    <section className={styles.operation}>
      <div className={styles['operation-title']}><FileArchive size={16} aria-hidden="true" /><strong>{t(`${prefix}.${operation.action}`)}</strong></div>
      <ApprovalValue label={t(`${prefix}.path`)} value={(importing ? operation.local_paths[0] : operation.local_target) ?? '—'} />
      {operation.script_id && <ApprovalValue label={t('desktopWorkflow.scriptName')} value={operation.resource_name || operation.script_id} />}
      {operation.script_version && <ApprovalValue label={t('desktopWorkflow.approval.version')} value={`v${operation.script_version}`} />}
      {operation.resource_id && <ApprovalValue label={t(`${prefix}.template`)} value={operation.resource_id} />}
      {!importing && <>
        <ApprovalValue label={t(`${prefix}.format`)} value={operation.mode ?? '—'} />
        <ApprovalValue label={t(`${prefix}.overwrite`)} value={t(`${prefix}.${operation.overwrite_policy === 'overwrite' ? 'replace' : 'noReplace'}`)} />
      </>}
    </section>
    <ApprovalNotice warning={operation.overwrite_policy === 'overwrite'} title={t(`${prefix}.host`)} description={t(`${prefix}.${importing ? 'readHint' : 'writeHint'}`)} />
  </>
}
