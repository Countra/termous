import { Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalValue } from './ApprovalDetailFields'
import { ApprovalNotice } from './ApprovalNotice'
import { DesktopApprovalTarget } from './DesktopApprovalTarget'
import styles from './ApprovalDetails.module.scss'

export function WorkflowApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const running = operation.action === 'run'
  const host = operation.resource_kind === 'host_desktop'
  const items = [
    { key: 'script', label: t('desktopWorkflow.scriptName'), children: running ? operation.target_resource_name : operation.resource_name },
    { key: 'version', label: t('desktopWorkflow.approval.version'), children: `v${operation.script_version}` },
  ]
  return <>
    <section className={styles.operation}>
      <div className={styles['operation-title']}><Workflow size={16} aria-hidden="true" /><strong>{t('desktopWorkflow.workflow')}</strong></div>
      {items.map(item => <ApprovalValue key={item.key} label={item.label} value={item.children || '—'} />)}
      {running && <DesktopApprovalTarget operation={operation} />}
      {(running ? [
        { key: 'steps', label: t('desktopWorkflow.steps'), children: String(operation.item_count ?? 0) },
        { key: 'lifecycle', label: t(host ? 'desktopWorkflow.approval.bindingEnd' : 'desktopWorkflow.approval.connectionEnd'), children: t(`desktopWorkflow.approval.${operation.lifecycle}`) },
        { key: 'duration', label: t('remoteDesktop.automation.duration'), children: t('remoteDesktop.automation.limits') },
      ] : []).map((item) => <ApprovalValue key={item.key} label={item.label} value={item.children || '—'} />)}
    </section>
    <ApprovalNotice warning={!running || operation.mode === 'takeover'}
      title={t(running ? operation.mode === 'takeover' ? 'desktopWorkflow.approval.takeover' : 'desktopWorkflow.approval.run' : 'desktopWorkflow.deleteScript')}
      description={t(running ? host ? 'desktopWorkflow.approval.hostRunHint' : 'desktopWorkflow.approval.runHint' : 'desktopWorkflow.deleteHint')} />
  </>
}
