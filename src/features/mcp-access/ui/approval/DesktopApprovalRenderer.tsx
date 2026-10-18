import { Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalValue } from './ApprovalDetailFields'
import { ApprovalNotice } from './ApprovalNotice'
import styles from './ApprovalDetails.module.scss'

export function DesktopApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const takeover = operation.mode === 'takeover'
  const description = [
    takeover && operation.resource_kind === 'vnc' ? t('remoteDesktop.automation.takeoverVncHint') : '',
    t('remoteDesktop.automation.shares'),
  ].filter(Boolean).join(' ')
  return <>
    <section className={styles.operation}>
      <div className={styles['operation-title']}><Monitor size={16} aria-hidden="true" /><strong>{t('remoteDesktop.automation.approvalTitle')}</strong></div>
      <ApprovalValue label={t('remoteDesktop.automation.target')} value={operation.resource_name || '—'} />
      <ApprovalValue label={t('remoteDesktop.automation.protocol')} value={operation.resource_kind?.toUpperCase() || '—'} />
      <ApprovalValue label={t('remoteDesktop.automation.connection')} value={operation.resource_id || '—'} code />
      <ApprovalValue label={t('remoteDesktop.automation.duration')} value={t('remoteDesktop.automation.limits')} />
    </section>
    <ApprovalNotice warning={takeover} title={t(takeover ? 'remoteDesktop.automation.takeoverApproval' : 'remoteDesktop.automation.controlApproval')} description={description} />
  </>
}
