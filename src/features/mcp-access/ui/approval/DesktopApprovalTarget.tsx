import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalValue } from './ApprovalDetailFields'

export function DesktopApprovalTarget({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const host = operation.resource_kind === 'host_desktop'
  return <>
    <ApprovalValue label={t('remoteDesktop.automation.target')} value={operation.resource_name || '—'} />
    <ApprovalValue label={t(host ? 'hostDesktop.targetType' : 'remoteDesktop.automation.protocol')}
      value={host ? t('hostDesktop.localDesktop') : operation.resource_kind?.toUpperCase() || '—'} />
    <ApprovalValue label={t(host ? 'hostDesktop.sourceID' : 'remoteDesktop.automation.connection')}
      value={operation.resource_id || '—'} code />
  </>
}
