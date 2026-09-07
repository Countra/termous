import { Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalScrollableValue, ApprovalValue } from './ApprovalDetailFields'
import styles from '../McpApprovalCoordinator.module.scss'

export function ForwardingApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const actionKey = forwardingActionKeys[operation.action]
    ?? 'settings.mcp.approval.forwardingAction.other'
  const resource = operation.resource_name || operation.resource_id
  const resourceLabel = operation.action === 'start' && operation.lifecycle === 'background_profile'
    ? 'settings.mcp.approval.forwardingProfile'
    : 'settings.mcp.approval.resource'

  return (
    <div className={styles.operation}>
      <div className={styles['operation-title']}>
        <Network size={16} aria-hidden="true" />
        <strong>{t(actionKey)}</strong>
      </div>

      {resource ? (
        <ApprovalValue label={t(resourceLabel)} value={resource} />
      ) : null}
      {operation.host_name ? (
        <ApprovalValue
          label={t('settings.mcp.approval.host')}
          value={operation.host_name}
        />
      ) : null}
      {operation.mode ? (
        <ApprovalValue
          label={t('settings.mcp.approval.forwardingMode')}
          value={t(forwardingModeKeys[operation.mode] ?? 'settings.mcp.approval.forwardingModeValue.other')}
        />
      ) : null}
      {operation.mode && forwardingDirectionKeys[operation.mode] ? (
        <ApprovalValue
          label={t('settings.mcp.approval.forwardingDirection')}
          value={t(forwardingDirectionKeys[operation.mode])}
        />
      ) : null}
      {operation.lifecycle ? (
        <ApprovalValue
          label={t('settings.mcp.approval.forwardingLifecycle')}
          value={t(forwardingLifecycleKeys[operation.lifecycle]
            ?? 'settings.mcp.approval.forwardingLifecycleValue.other')}
        />
      ) : null}
      {operation.bind_address ? (
        <ApprovalScrollableValue
          label={t('settings.mcp.approval.bindAddress')}
          value={operation.bind_address}
        />
      ) : null}
      {operation.target_address ? (
        <ApprovalScrollableValue
          label={t('settings.mcp.approval.targetAddress')}
          value={operation.target_address}
        />
      ) : null}
    </div>
  )
}

const forwardingActionKeys: Record<string, string> = {
  start: 'settings.mcp.approval.forwardingAction.start',
  stop: 'settings.mcp.approval.forwardingAction.stop',
}

const forwardingModeKeys: Record<string, string> = {
  local: 'settings.mcp.approval.forwardingModeValue.local',
  remote: 'settings.mcp.approval.forwardingModeValue.remote',
  dynamic: 'settings.mcp.approval.forwardingModeValue.dynamic',
}

const forwardingDirectionKeys: Record<string, string> = {
  local: 'settings.mcp.approval.forwardingDirectionValue.local',
  remote: 'settings.mcp.approval.forwardingDirectionValue.remote',
  dynamic: 'settings.mcp.approval.forwardingDirectionValue.dynamic',
}

const forwardingLifecycleKeys: Record<string, string> = {
  session: 'settings.mcp.approval.forwardingLifecycleValue.session',
  background_once: 'settings.mcp.approval.forwardingLifecycleValue.backgroundOnce',
  background_profile: 'settings.mcp.approval.forwardingLifecycleValue.backgroundProfile',
}
