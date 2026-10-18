import { Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalValue } from './ApprovalDetailFields'
import { ApprovalNotice } from './ApprovalNotice'
import styles from './ApprovalDetails.module.scss'

export function WorkflowApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const running = operation.action === 'run'
  const items = [
    { key: 'script', label: t('desktopWorkflow.scriptName'), children: running ? operation.target_resource_name : operation.resource_name },
    { key: 'version', label: t('desktopWorkflow.approval.version'), children: `v${operation.script_version}` },
  ]
  return <>
    <section className={styles.operation}>
      <div className={styles['operation-title']}><Workflow size={16} aria-hidden="true" /><strong>{t('desktopWorkflow.workflow')}</strong></div>
      {(running ? [...items,
        { key: 'target', label: t('remoteDesktop.automation.target'), children: operation.resource_name },
        { key: 'protocol', label: t('remoteDesktop.automation.protocol'), children: operation.resource_kind?.toUpperCase() },
        { key: 'connection', label: t('remoteDesktop.automation.connection'), children: operation.resource_id },
        { key: 'steps', label: t('desktopWorkflow.steps'), children: String(operation.item_count ?? 0) },
        { key: 'lifecycle', label: t('desktopWorkflow.approval.connectionEnd'), children: t(`desktopWorkflow.approval.${operation.lifecycle}`) },
        { key: 'duration', label: t('remoteDesktop.automation.duration'), children: t('remoteDesktop.automation.limits') },
      ] : items).map((item) => <ApprovalValue key={item.key} label={item.label} value={item.children || '—'} code={item.key === 'connection'} />)}
    </section>
    <ApprovalNotice warning={!running || operation.mode === 'takeover'}
      title={t(running ? operation.mode === 'takeover' ? 'desktopWorkflow.approval.takeover' : 'desktopWorkflow.approval.run' : 'desktopWorkflow.deleteScript')}
      description={t(running ? 'desktopWorkflow.approval.runHint' : 'desktopWorkflow.deleteHint')} />
  </>
}
