import {
  FileDown,
  FilePenLine,
  FileUp,
  FolderInput,
  FolderPlus,
  ListRestart,
  PencilLine,
  ShieldCheck,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { formatBytes } from '#shared/format'
import { ApprovalPaths, ApprovalRenameMappings } from './ApprovalDetailFields'
import styles from '../McpApprovalCoordinator.module.scss'

export function FilesApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const Icon = filesActionIcons[operation.action] ?? Wrench
  const actionKey = filesActionKeys[operation.action] ?? 'settings.mcp.approval.filesAction.other'
  const isBatchRename = operation.action === 'batch_rename'
  const isDelete = operation.action === 'delete'
  const sourceHost = operation.host_name || operation.file_session_id
  const targetHost = operation.target_host_name || operation.target_file_session_id
  const remotePathsLabel = isDelete ? 'settings.mcp.approval.deletePaths' : operation.action === 'save_text' || operation.action === 'chmod'
    ? 'settings.mcp.approval.remotePath'
    : 'settings.mcp.approval.remotePaths'
  const remoteTargetLabel = isBatchRename
    ? 'settings.mcp.approval.remoteDirectory'
    : 'settings.mcp.approval.remoteTarget'
  const hasOperationMeta = Boolean(
    operation.overwrite_policy
    || operation.mode
    || operation.item_count !== undefined
    || operation.total_bytes !== undefined
    || operation.rule_count !== undefined
    || isBatchRename
    || isDelete,
  )

  return (
    <div className={styles.operation}>
      <div className={styles['operation-title']}>
        <Icon size={16} aria-hidden="true" />
        <strong>{t(actionKey)}</strong>
      </div>

      {sourceHost || targetHost ? (
        <div className={styles['host-route']}>
          {sourceHost ? <span>{sourceHost}</span> : null}
          {sourceHost && targetHost ? <span aria-hidden="true">→</span> : null}
          {targetHost ? <span>{targetHost}</span> : null}
        </div>
      ) : null}

      <ApprovalPaths label={t(remotePathsLabel)} paths={operation.remote_paths} focusable={isDelete} />
      <ApprovalPaths label={t(remoteTargetLabel)} paths={toPathList(operation.remote_target)} />
      <ApprovalPaths label={t('settings.mcp.approval.localPaths')} paths={operation.local_paths} />
      <ApprovalPaths label={t('settings.mcp.approval.localTarget')} paths={toPathList(operation.local_target)} />
      <ApprovalRenameMappings
        label={t('settings.mcp.approval.renameMappings')}
        mappings={operation.rename_mappings}
      />

      {operation.non_atomic ? <p className={styles['delete-warning']}>{t('files.move.nonAtomic')}</p> : null}
      {isDelete ? <p className={styles['delete-warning']}>{t('settings.mcp.approval.deleteWarning')}</p> : null}

      {hasOperationMeta ? (
        <div className={styles['operation-meta']}>
          {isDelete && operation.recursive !== undefined ? (
            <span>{t('settings.mcp.approval.deleteScope')}
              <strong>{t(`settings.mcp.approval.deleteRecursive.${operation.recursive ? 'enabled' : 'disabled'}`)}</strong>
            </span>
          ) : null}
          {isDelete ? (['top_level_count', 'file_count', 'directory_count', 'symlink_count'] as const).map((key) => (
            operation[key] === undefined ? null : <span key={key}>
              {t(`settings.mcp.approval.deleteCounts.${key}`)}<strong>{operation[key]}</strong>
            </span>
          )) : null}
          {operation.overwrite_policy ? (
            <span>
              {t('settings.mcp.approval.overwritePolicy')}
              <strong>{t(`settings.mcp.approval.overwrite.${operation.overwrite_policy}`)}</strong>
            </span>
          ) : null}
          {operation.mode ? (
            <span>
              {t('settings.mcp.approval.mode')}
              <strong>{operation.mode}</strong>
            </span>
          ) : null}
          {operation.item_count !== undefined ? (
            <span>
              {t(isDelete ? 'settings.mcp.approval.deleteTotalCount' : 'settings.mcp.approval.itemCount')}
              <strong>{operation.item_count}</strong>
            </span>
          ) : null}
          {operation.rule_count !== undefined || isBatchRename ? (
            <span>
              {t('settings.mcp.approval.ruleCount')}
              <strong>{operation.rule_count ?? 0}</strong>
            </span>
          ) : null}
          {operation.total_bytes !== undefined ? (
            <span>
              {t('settings.mcp.approval.totalBytes')}
              <strong>{formatBytes(operation.total_bytes)}</strong>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const filesActionKeys: Record<string, string> = {
  save_text: 'settings.mcp.approval.filesAction.saveText',
  mkdir: 'settings.mcp.approval.filesAction.mkdir',
  rename: 'settings.mcp.approval.filesAction.rename',
  delete: 'settings.mcp.approval.filesAction.delete',
  chmod: 'settings.mcp.approval.filesAction.chmod',
  upload: 'settings.mcp.approval.filesAction.upload',
  download: 'settings.mcp.approval.filesAction.download',
  remote_copy: 'settings.mcp.approval.filesAction.remoteCopy',
  batch_rename: 'settings.mcp.approval.filesAction.batchRename',
}

const filesActionIcons: Record<string, LucideIcon> = {
  save_text: FilePenLine,
  mkdir: FolderPlus,
  rename: PencilLine,
  delete: Trash2,
  chmod: ShieldCheck,
  upload: FileUp,
  download: FileDown,
  remote_copy: FolderInput,
  batch_rename: ListRestart,
}

function toPathList(path?: string) {
  return path ? [path] : []
}
