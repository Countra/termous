import { Braces } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalScrollableCode, ApprovalValue } from './ApprovalDetailFields'
import styles from '../McpApprovalCoordinator.module.scss'

export function SnippetApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const actionKey = snippetActionKeys[operation.action]
    ?? 'settings.mcp.approval.snippetAction.other'
  const resource = operation.resource_name || operation.resource_id
  const groupAction = operation.action.startsWith('group')
  const group = groupAction ? operation.group_name || resource : operation.group_name
  const groupRename = operation.action === 'group_update'
    && resource
    && operation.group_name
    && resource !== operation.group_name
    ? { current: resource, next: operation.group_name }
    : null

  return (
    <div className={styles.operation}>
      <div className={styles['operation-title']}>
        <Braces size={16} aria-hidden="true" />
        <strong>{t(actionKey)}</strong>
      </div>

      {!groupAction && resource ? (
        <ApprovalValue label={t('settings.mcp.approval.snippet')} value={resource} />
      ) : null}
      {groupRename ? (
        <>
          <ApprovalValue
            label={t('settings.mcp.approval.currentSnippetGroup')}
            value={groupRename.current}
          />
          <ApprovalValue
            label={t('settings.mcp.approval.newSnippetGroupName')}
            value={groupRename.next}
          />
        </>
      ) : group ? (
        <ApprovalValue label={t('settings.mcp.approval.snippetGroup')} value={group} />
      ) : null}
      {operation.item_count ? (
        <ApprovalValue
          label={t('settings.mcp.approval.itemCount')}
          value={t('settings.mcp.approval.itemCountValue', { count: operation.item_count })}
        />
      ) : null}
      {operation.action === 'group_delete' ? (
        <ApprovalValue
          label={t('settings.mcp.approval.impact')}
          value={t('settings.mcp.approval.snippetGroupDeleteImpact')}
        />
      ) : null}
      {operation.shell ? (
        <ApprovalValue label={t('settings.mcp.approval.shell')} value={operation.shell} code />
      ) : null}
      {operation.tags && operation.tags.length > 0 ? (
        <ApprovalValue label={t('settings.mcp.approval.tags')} value={operation.tags.join(', ')} />
      ) : null}
      {operation.description ? (
        <ApprovalValue label={t('settings.mcp.approval.snippetDescription')} value={operation.description} />
      ) : null}
      {operation.command ? (
        <div className={styles['command-group']}>
          <span>{t('settings.mcp.approval.snippetCommand')}</span>
          <ApprovalScrollableCode value={operation.command} />
        </div>
      ) : null}
    </div>
  )
}

const snippetActionKeys: Record<string, string> = {
  group_create: 'settings.mcp.approval.snippetAction.groupCreate',
  group_update: 'settings.mcp.approval.snippetAction.groupUpdate',
  group_delete: 'settings.mcp.approval.snippetAction.groupDelete',
  groups_reorder: 'settings.mcp.approval.snippetAction.groupsReorder',
  create: 'settings.mcp.approval.snippetAction.create',
  update: 'settings.mcp.approval.snippetAction.update',
  delete: 'settings.mcp.approval.snippetAction.delete',
}
