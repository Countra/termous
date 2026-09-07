import {
  Activity,
  CalendarClock,
  Container,
  ServerCog,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalScrollableCode, ApprovalValue } from './ApprovalDetailFields'
import styles from '../McpApprovalCoordinator.module.scss'

export function RemoteOpsApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const Icon = remoteOpsDomainIcons[operation.domain ?? ''] ?? ServerCog
  const domainKey = remoteOpsDomainKeys[operation.domain ?? '']
    ?? 'settings.mcp.approval.remoteOpsDomain.other'
  const actionKey = remoteOpsActionKeys[operation.action]
    ?? 'settings.mcp.approval.remoteOpsAction.other'
  const resource = formatRemoteOpsResource(operation)

  return (
    <div className={styles.operation}>
      <div className={styles['operation-title']}>
        <Icon size={16} aria-hidden="true" />
        <strong>{t(domainKey)} · {t(actionKey)}</strong>
      </div>

      {resource ? (
        <ApprovalValue label={t('settings.mcp.approval.resource')} value={resource} />
      ) : null}
      {operation.schedule ? (
        <ApprovalValue label={t('settings.mcp.approval.schedule')} value={operation.schedule} code />
      ) : null}

      {operation.signal || operation.timeout_seconds !== undefined || operation.enabled !== undefined ? (
        <div className={styles['operation-meta']}>
          {operation.signal ? (
            <span>
              {t('settings.mcp.approval.signal')}
              <strong>{operation.signal}</strong>
            </span>
          ) : null}
          {operation.timeout_seconds !== undefined ? (
            <span>
              {t('settings.mcp.approval.timeout')}
              <strong>{t('settings.mcp.approval.timeoutSeconds', { count: operation.timeout_seconds })}</strong>
            </span>
          ) : null}
          {operation.enabled !== undefined ? (
            <span>
              {t('settings.mcp.approval.enabledState')}
              <strong>{t(operation.enabled
                ? 'settings.mcp.approval.enabled'
                : 'settings.mcp.approval.disabled')}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {operation.command ? (
        <div className={styles['command-group']}>
          <span>{t('settings.mcp.approval.crontabCommand')}</span>
          <ApprovalScrollableCode value={operation.command} />
        </div>
      ) : null}
    </div>
  )
}

const remoteOpsDomainKeys: Record<string, string> = {
  system: 'settings.mcp.approval.remoteOpsDomain.system',
  process: 'settings.mcp.approval.remoteOpsDomain.processes',
  processes: 'settings.mcp.approval.remoteOpsDomain.processes',
  service: 'settings.mcp.approval.remoteOpsDomain.services',
  services: 'settings.mcp.approval.remoteOpsDomain.services',
  docker: 'settings.mcp.approval.remoteOpsDomain.docker',
  crontab: 'settings.mcp.approval.remoteOpsDomain.crontab',
}

const remoteOpsDomainIcons: Record<string, LucideIcon> = {
  system: ServerCog,
  process: Activity,
  processes: Activity,
  service: ServerCog,
  services: ServerCog,
  docker: Container,
  crontab: CalendarClock,
}

const remoteOpsActionKeys: Record<string, string> = {
  terminate: 'settings.mcp.approval.remoteOpsAction.terminate',
  start: 'settings.mcp.approval.remoteOpsAction.start',
  stop: 'settings.mcp.approval.remoteOpsAction.stop',
  restart: 'settings.mcp.approval.remoteOpsAction.restart',
  reload: 'settings.mcp.approval.remoteOpsAction.reload',
  enable: 'settings.mcp.approval.remoteOpsAction.enable',
  disable: 'settings.mcp.approval.remoteOpsAction.disable',
  reset_failed: 'settings.mcp.approval.remoteOpsAction.resetFailed',
  mask: 'settings.mcp.approval.remoteOpsAction.mask',
  unmask: 'settings.mcp.approval.remoteOpsAction.unmask',
  pause: 'settings.mcp.approval.remoteOpsAction.pause',
  unpause: 'settings.mcp.approval.remoteOpsAction.unpause',
  create: 'settings.mcp.approval.remoteOpsAction.create',
  update: 'settings.mcp.approval.remoteOpsAction.update',
  delete: 'settings.mcp.approval.remoteOpsAction.delete',
}

function formatRemoteOpsResource(operation: McpApprovalOperation) {
  if (operation.resource_name && operation.resource_id) {
    return `${operation.resource_name} · ${operation.resource_id}`
  }
  return operation.resource_name || operation.resource_id || ''
}
