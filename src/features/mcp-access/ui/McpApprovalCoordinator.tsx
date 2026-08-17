import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Button, Modal, Tag } from 'antd'
import {
  Clock3,
  FileDown,
  FilePenLine,
  FileUp,
  FolderInput,
  FolderPlus,
  PencilLine,
  ServerCog,
  ShieldCheck,
  ShieldX,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { formatBytes } from '#shared/format'
import { termousNotificationClassName } from '#shared/ui'
import { useMcpAccessRuntime } from '../runtime/mcpAccessContext'
import styles from './McpApprovalCoordinator.module.scss'

interface McpApprovalCoordinatorProps {
  blocked?: boolean
}

export function McpApprovalCoordinator({ blocked = false }: McpApprovalCoordinatorProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const { approvals, mutationKey, decideApproval, reload } = useMcpAccessRuntime()
  const approval = blocked ? null : approvals[0] ?? null
  const approvalId = approval?.id ?? ''
  const mutationBusy = Boolean(mutationKey)
  const approvalBusy = approval ? mutationKey === `approval:${approval.id}` : false
  const [now, setNow] = useState(() => Date.now())
  const expiryTimestamp = useMemo(
    () => approval?.expires_at ? Date.parse(approval.expires_at) : Number.NaN,
    [approval?.expires_at],
  )
  const remainingSeconds = Number.isFinite(expiryTimestamp)
    ? Math.max(0, Math.ceil((expiryTimestamp - now) / 1_000))
    : 0
  const expired = Boolean(approval) && remainingSeconds === 0
  const expiryReconciledRef = useRef('')

  useEffect(() => {
    if (!approvalId) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [approvalId])

  useEffect(() => {
    if (!approval || !expired || expiryReconciledRef.current === approval.id) return
    expiryReconciledRef.current = approval.id
    void reload().catch(() => undefined)
  }, [approval, expired, reload])

  const decide = (decision: 'approve' | 'reject') => {
    if (!approval || expired) return
    void decideApproval(approval.id, decision).catch(() => notification.error({
      title: t('settings.mcp.operationFailed'),
      duration: 4,
      className: termousNotificationClassName,
    }))
  }

  return (
    <Modal
      open={Boolean(approval)}
      centered
      width={620}
      zIndex={3900}
      title={null}
      footer={null}
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      destroyOnHidden
      rootClassName={styles['approval-modal-root']}
      className={styles['approval-modal']}
      aria-labelledby="mcp-approval-title"
    >
      {approval ? (
        <section className={styles.dialog}>
          <header className={styles.header}>
            <span className={styles.icon} aria-hidden="true">
              <ShieldCheck size={23} />
            </span>
            <div>
              <h2 id="mcp-approval-title">{t('settings.mcp.approval.title')}</h2>
              <p>{t('settings.mcp.approval.description')}</p>
            </div>
          </header>

          <div className={styles.client}>
            <ServerCog size={17} aria-hidden="true" />
            <span>{t('settings.mcp.approval.client')}</span>
            <strong>{approval.client_name || approval.client_id || t('settings.mcp.unknownClient')}</strong>
          </div>

          {approval.kind === 'sftp' && approval.operation ? (
            <SftpApprovalOperation operation={approval.operation} />
          ) : (
            <div className={styles.operation}>
              <div className={styles['operation-title']}>
                <TerminalSquare size={16} aria-hidden="true" />
                <strong>{t('settings.mcp.approval.command')}</strong>
              </div>
              <pre>{approval.command}</pre>
            </div>
          )}

          {approval.targets.length > 0 ? (
            <div className={styles.targets}>
              <span>{t('settings.mcp.approval.targets', { count: approval.targets.length })}</span>
              <div>
                {approval.targets.map((target) => (
                  <Tag key={target.id} title={target.id}>
                    {target.host_name || target.endpoint || target.id}
                    {target.host_name && target.endpoint ? ` · ${target.endpoint}` : ''}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}

          <footer className={styles.footer}>
            <span className={styles.expiry}>
              <Clock3 size={14} aria-hidden="true" />
              {expired ? (
                <span role="status">{t('settings.mcp.approval.expired')}</span>
              ) : t('settings.mcp.approval.expiresIn', { time: formatCountdown(remainingSeconds) })}
            </span>
            <div className={styles.actions}>
              <Button
                danger
                icon={<ShieldX size={16} aria-hidden="true" />}
                disabled={mutationBusy || expired}
                onClick={() => decide('reject')}
              >
                {t('settings.mcp.approval.reject')}
              </Button>
              <Button
                type="primary"
                icon={<ShieldCheck size={16} aria-hidden="true" />}
                loading={approvalBusy}
                disabled={mutationBusy || expired}
                onClick={() => decide('approve')}
              >
                {t('settings.mcp.approval.allowOnce')}
              </Button>
            </div>
          </footer>
        </section>
      ) : null}
    </Modal>
  )
}

function SftpApprovalOperation({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const Icon = sftpActionIcons[operation.action] ?? Wrench
  const actionKey = sftpActionKeys[operation.action] ?? 'settings.mcp.approval.sftpAction.other'
  const sourceHost = operation.host_name || operation.file_session_id
  const targetHost = operation.target_host_name || operation.target_file_session_id
  const remotePathsLabel = operation.action === 'save_text' || operation.action === 'chmod'
    ? 'settings.mcp.approval.remotePath'
    : 'settings.mcp.approval.remotePaths'

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

      <ApprovalPaths label={t(remotePathsLabel)} paths={operation.remote_paths} />
      <ApprovalPaths label={t('settings.mcp.approval.remoteTarget')} paths={toPathList(operation.remote_target)} />
      <ApprovalPaths label={t('settings.mcp.approval.localPaths')} paths={operation.local_paths} />
      <ApprovalPaths label={t('settings.mcp.approval.localTarget')} paths={toPathList(operation.local_target)} />

      {operation.overwrite_policy || operation.mode || operation.item_count !== undefined || operation.total_bytes !== undefined ? (
        <div className={styles['operation-meta']}>
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
              {t('settings.mcp.approval.itemCount')}
              <strong>{operation.item_count}</strong>
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

function ApprovalPaths({ label, paths }: { label: string; paths: string[] }) {
  if (paths.length === 0) return null
  return (
    <div className={styles['path-group']}>
      <span>{label}</span>
      <div className={styles['path-list']}>
        {paths.map((path, index) => <code key={`${index}:${path}`}>{path}</code>)}
      </div>
    </div>
  )
}

const sftpActionKeys: Record<string, string> = {
  save_text: 'settings.mcp.approval.sftpAction.saveText',
  mkdir: 'settings.mcp.approval.sftpAction.mkdir',
  rename: 'settings.mcp.approval.sftpAction.rename',
  chmod: 'settings.mcp.approval.sftpAction.chmod',
  upload: 'settings.mcp.approval.sftpAction.upload',
  download: 'settings.mcp.approval.sftpAction.download',
  remote_copy: 'settings.mcp.approval.sftpAction.remoteCopy',
}

const sftpActionIcons: Record<string, LucideIcon> = {
  save_text: FilePenLine,
  mkdir: FolderPlus,
  rename: PencilLine,
  chmod: ShieldCheck,
  upload: FileUp,
  download: FileDown,
  remote_copy: FolderInput,
}

function toPathList(path?: string) {
  return path ? [path] : []
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
