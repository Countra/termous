import { Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalValue } from './ApprovalDetailFields'
import { ApprovalNotice } from './ApprovalNotice'
import { DesktopApprovalTarget } from './DesktopApprovalTarget'
import styles from './ApprovalDetails.module.scss'

export function DesktopApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const takeover = operation.mode === 'takeover'
  const host = operation.resource_kind === 'host_desktop'
  const description = [
    takeover && operation.resource_kind === 'vnc' ? t('remoteDesktop.automation.takeoverVncHint') : '',
    t(host ? 'hostDesktop.controlHint' : 'remoteDesktop.automation.shares'),
  ].filter(Boolean).join(' ')
  return <>
    <section className={styles.operation}>
      <div className={styles['operation-title']}><Monitor size={16} aria-hidden="true" /><strong>{t(host ? 'hostDesktop.approvalTitle' : 'remoteDesktop.automation.approvalTitle')}</strong></div>
      <DesktopApprovalTarget operation={operation} />
      <ApprovalValue label={t('remoteDesktop.automation.duration')} value={t('remoteDesktop.automation.limits')} />
    </section>
    <ApprovalNotice warning={takeover} title={t(takeover ? 'remoteDesktop.automation.takeoverApproval' : host ? 'hostDesktop.controlApproval' : 'remoteDesktop.automation.controlApproval')} description={description} />
  </>
}
