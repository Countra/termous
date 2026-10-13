import { Alert, Descriptions } from 'antd'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'

export function DesktopApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  return <>
    <Descriptions column={1} size="small" items={[
      { key: 'target', label: t('remoteDesktop.automation.target'), children: operation.resource_name },
      { key: 'protocol', label: t('remoteDesktop.automation.protocol'), children: operation.resource_kind?.toUpperCase() },
      { key: 'id', label: t('remoteDesktop.automation.connection'), children: operation.resource_id },
      { key: 'duration', label: t('remoteDesktop.automation.duration'), children: t('remoteDesktop.automation.limits') },
    ]} />
    <Alert type={operation.mode === 'takeover' ? 'warning' : 'info'} title={t(operation.mode === 'takeover' ? 'remoteDesktop.automation.takeoverApproval' : 'remoteDesktop.automation.controlApproval')} description={t('remoteDesktop.automation.shares')} />
  </>
}
