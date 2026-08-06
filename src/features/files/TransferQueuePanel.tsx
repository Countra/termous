import {
  App as AntdApp,
  Button,
  Dropdown,
  Tooltip,
  type MenuProps,
} from 'antd'
import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  Copy,
  DownloadCloud,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import { formatBytes } from '#shared/format'
import { ContextActionMenu } from '#shared/ui'
import type { TransferTask } from '#entities/file'
import {
  buildTransferQueueItems,
  isActiveTransferTask,
  isClearablePendingOperation,
  isClearableTransferTask,
  summarizeTransferQueue,
  type PendingFileOperation,
  type TransferQueueFilter,
} from './transferQueueState'
import {
  formatSeconds,
  transferDisplayName,
  transferProgress,
  transferStatusClass,
} from '#entities/file'

interface TransferQueuePanelProps {
  transfers: TransferTask[]
  pendingOperations?: PendingFileOperation[]
  pendingActionIds?: ReadonlySet<string>
  hostNames?: Readonly<Record<string, string>>
  showHostContext?: boolean
  liveConnected?: boolean
  onRefresh?: () => Promise<void>
  onDismissPending?: (id: string) => void
  onCancel: (id: string) => Promise<void>
  onDelete: (id: string, options?: { silent?: boolean }) => Promise<boolean>
  onRetry: (id: string) => Promise<void>
}

export function TransferQueuePanel({
  transfers,
  pendingOperations = [],
  pendingActionIds = new Set(),
  hostNames = {},
  showHostContext = false,
  liveConnected = true,
  onRefresh,
  onDismissPending,
  onCancel,
  onDelete,
  onRetry,
}: TransferQueuePanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const [filter, setFilter] = useState<TransferQueueFilter>('all')
  const [clearing, setClearing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const summary = useMemo(
    () => summarizeTransferQueue(transfers, pendingOperations),
    [pendingOperations, transfers],
  )
  const items = useMemo(
    () => buildTransferQueueItems(transfers, pendingOperations, filter),
    [filter, pendingOperations, transfers],
  )
  const activeTasks = useMemo(
    () => transfers.filter(isActiveTransferTask),
    [transfers],
  )
  const activeTransferredBytes = activeTasks.reduce(
    (total, task) => total + Math.max(0, task.transferred_bytes),
    0,
  )
  const activeTotalBytes = activeTasks.reduce(
    (total, task) => total + Math.max(0, task.total_bytes),
    0,
  )
  const activeSpeed = activeTasks.reduce(
    (total, task) => total + Math.max(0, task.speed_bytes_per_sec || task.average_speed_bytes_per_sec),
    0,
  )
  const aggregateProgress = activeTotalBytes > 0
    ? Math.min(100, Math.max(0, Math.round((activeTransferredBytes / activeTotalBytes) * 100)))
    : 0
  const clearableTasks = items.flatMap((item) => (
    item.kind === 'task' && isClearableTransferTask(item.task) ? [item.task] : []
  ))
  const clearablePending = items.flatMap((item) => (
    item.kind === 'pending' && isClearablePendingOperation(item.operation) ? [item.operation] : []
  ))
  const clearableCount = clearableTasks.length + clearablePending.length
  const hasBusyClearableTask = clearableTasks.some((task) => pendingActionIds.has(task.id))
  const filterOptions: Array<{
    key: TransferQueueFilter
    label: string
    count: number
  }> = [
    { key: 'all', label: t('files.transferAll'), count: summary.all },
    { key: 'active', label: t('files.transferActive'), count: summary.active },
    { key: 'completed', label: t('files.transferCompleted'), count: summary.completed },
    { key: 'failed', label: t('files.transferFailed'), count: summary.failed },
  ]

  const clearRecords = () => {
    if (clearableCount === 0 || clearing || hasBusyClearableTask) {
      return
    }
    modal.confirm({
      title: t('files.clearTransferRecordsTitle', { count: clearableCount }),
      content: t('files.clearTransferRecordsHint'),
      okText: t('files.clearTransferRecords'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      centered: true,
      onOk: async () => {
        setClearing(true)
        try {
          let failedCount = 0
          for (let index = 0; index < clearableTasks.length; index += 4) {
            const results = await Promise.all(
              clearableTasks
                .slice(index, index + 4)
                .map((task) => onDelete(task.id, { silent: true })),
            )
            failedCount += results.filter((succeeded) => !succeeded).length
          }
          clearablePending.forEach((operation) => onDismissPending?.(operation.id))
          if (failedCount > 0) {
            notification.warning({
              message: t('files.clearTransferRecordsPartial'),
              description: t('files.clearTransferRecordsPartialHint', { count: failedCount }),
              placement: 'topRight',
              duration: 3.2,
              className: 'termous-notification',
            })
          }
        } finally {
          setClearing(false)
        }
      },
    })
  }

  const refreshState = async () => {
    if (!onRefresh || refreshing) {
      return
    }
    setRefreshing(true)
    try {
      await onRefresh()
    } catch (error) {
      notification.error({
        message: t('files.transferRefreshFailed'),
        description: error instanceof Error ? error.message : undefined,
        placement: 'topRight',
        duration: 3,
        className: 'termous-notification',
      })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className="files-transfer-panel">
      <div className="transfer-command-bar">
        <div
          className="transfer-filter-tabs"
          role="group"
          aria-label={t('files.transferFilter')}
        >
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              className={filter === option.key ? 'is-active' : ''}
              onClick={() => setFilter(option.key)}
            >
              <span>{option.label}</span>
              <em>{option.count}</em>
            </button>
          ))}
        </div>
        <div className="transfer-command-status">
          {summary.active > 0 ? (
            <span className="transfer-live-summary">
              <i aria-hidden="true" />
              <span>{t('files.activeTransferCount', { count: summary.active })}</span>
              {activeTasks.length > 0 ? (
                <>
                  <b>{aggregateProgress}%</b>
                  <b>{t('files.transferSpeed', { value: formatBytes(activeSpeed) })}</b>
                </>
              ) : null}
            </span>
          ) : null}
          {!liveConnected ? (
            <Tooltip title={t('files.transferSyncing')}>
              <Button
                type="text"
                size="small"
                className="transfer-sync-button"
                loading={refreshing}
                disabled={!onRefresh || refreshing}
                icon={<RefreshCw size={13} aria-hidden="true" />}
                onClick={() => void refreshState()}
              >
                {t('files.transferSyncing')}
              </Button>
            </Tooltip>
          ) : null}
          {clearableCount > 0 ? (
            <Tooltip title={t('files.clearTransferRecords')}>
              <Button
                type="text"
                size="small"
                className="transfer-clear-button"
                loading={clearing}
                disabled={clearing || hasBusyClearableTask}
                icon={<Trash2 size={13} aria-hidden="true" />}
                onClick={clearRecords}
              >
                {t('files.clearTransferRecords')}
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div
        className="transfer-list"
        role={items.length > 0 ? 'list' : undefined}
        aria-busy={clearing}
      >
        {items.length === 0 ? (
          <TransferQueueEmpty
            hasAnyTransfer={summary.all > 0}
            canShowAll={filter !== 'all'}
            onShowAll={() => setFilter('all')}
          />
        ) : (
          items.map((item) => (
            item.kind === 'pending' ? (
              <TransferPreparationRow
                key={item.operation.id}
                operation={item.operation}
                hostLabel={showHostContext ? hostNames[item.operation.hostId] : undefined}
                onDismiss={onDismissPending}
              />
            ) : (
              <TransferRow
                key={item.task.id}
                task={item.task}
                hostLabel={showHostContext ? hostNames[item.task.host_id] : undefined}
                actionBusy={pendingActionIds.has(item.task.id)}
                onCancel={onCancel}
                onDelete={onDelete}
                onRetry={onRetry}
              />
            )
          ))
        )}
      </div>
    </section>
  )
}

function TransferQueueEmpty({
  hasAnyTransfer,
  canShowAll,
  onShowAll,
}: {
  hasAnyTransfer: boolean
  canShowAll: boolean
  onShowAll: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="transfer-quiet-empty">
      <span className="transfer-quiet-empty-icon" aria-hidden="true">
        <DownloadCloud size={20} />
      </span>
      <strong>{hasAnyTransfer ? t('files.noTransfersForFilter') : t('files.noTransfers')}</strong>
      <span>{hasAnyTransfer ? t('files.noTransfersForFilterHint') : t('files.noTransfersHint')}</span>
      {canShowAll ? (
        <Button type="text" size="small" onClick={onShowAll}>
          {t('files.showAllTransfers')}
        </Button>
      ) : null}
    </div>
  )
}

function TransferPreparationRow({
  operation,
  hostLabel,
  onDismiss,
}: {
  operation: PendingFileOperation
  hostLabel?: string
  onDismiss?: (id: string) => void
}) {
  const { t } = useTranslation()
  const status = operation.status ?? 'running'
  const progress = Math.max(0, Math.min(100, Math.round(operation.progress || 0)))
  const Icon = status === 'success' ? CheckCircle2 : status === 'error' ? AlertTriangle : Loader2
  const statusLabel = status === 'success'
    ? t('files.transferCompleted')
    : status === 'error'
      ? t('files.transferPreparationFailed')
      : t('files.transferPreparing')

  return (
    <article
      className={`transfer-row transfer-preparation-row is-${status}`}
      role="listitem"
      aria-label={`${operation.title}: ${statusLabel}`}
    >
      <span className="transfer-kind-icon">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="transfer-copy">
        <div className="transfer-title-line">
          <Tooltip title={operation.title}>
            <strong>{operation.title}</strong>
          </Tooltip>
        </div>
        <span className="transfer-subline">
          {operation.description}
          {hostLabel ? <em>{hostLabel}</em> : null}
        </span>
      </div>
      <div className="transfer-progress-block">
        <div className="transfer-state-line">
          <span className="transfer-state-label">
            <i aria-hidden="true" />
            {statusLabel}
          </span>
          {!operation.indeterminate && status === 'running' ? <b>{progress}%</b> : null}
        </div>
        {status === 'running' ? (
          <div
            className={`transfer-progress-line ${operation.indeterminate ? 'is-indeterminate' : ''}`}
            role="progressbar"
            aria-label={`${operation.title}: ${statusLabel}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={operation.indeterminate ? undefined : progress}
          >
            <span style={operation.indeterminate ? undefined : { width: `${progress}%` }} />
          </div>
        ) : null}
      </div>
      <div className="transfer-actions">
        {status !== 'running' && onDismiss ? (
          <Tooltip title={t('files.deleteTransferRecord')}>
            <Button
              type="text"
              size="small"
              className="files-icon-button transfer-more-button"
              aria-label={t('files.deleteTransferRecord')}
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => onDismiss(operation.id)}
            />
          </Tooltip>
        ) : null}
      </div>
    </article>
  )
}

function TransferRow({
  task,
  hostLabel,
  actionBusy,
  onCancel,
  onDelete,
  onRetry,
}: {
  task: TransferTask
  hostLabel?: string
  actionBusy: boolean
  onCancel: (id: string) => Promise<void>
  onDelete: (id: string, options?: { silent?: boolean }) => Promise<boolean>
  onRetry: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const isUpload = task.type.startsWith('upload')
  const isDownload = task.type.startsWith('download')
  const canDelete = isClearableTransferTask(task)
  const localDirectoryPath = resolveTransferLocalDirectory(task)
  const progress = transferProgress(task)
  const speed = task.speed_bytes_per_sec || task.average_speed_bytes_per_sec
  const currentName = transferDisplayName(task)
  const totalFiles = Math.max(0, task.total_files || task.source_paths.length)
  const completedFiles = Math.max(0, Math.min(totalFiles, task.completed_files || 0))
  const Icon = isUpload ? UploadCloud : isDownload ? DownloadCloud : Copy
  const isActive = isActiveTransferTask(task)

  const openLocalDirectory = async () => {
    const filesBridge = getTermousBridge()?.files
    if (!localDirectoryPath || !filesBridge?.openDirectory) {
      notification.error({
        message: t('files.openLocalDirectoryFailed'),
        placement: 'topRight',
        duration: 2.8,
        className: 'termous-notification',
      })
      return
    }
    try {
      const result = await filesBridge.openDirectory(localDirectoryPath)
      if (!result.ok) {
        throw new Error(result.error)
      }
    } catch (error) {
      notification.error({
        message: t('files.openLocalDirectoryFailed'),
        description: error instanceof Error ? error.message : undefined,
        placement: 'topRight',
        duration: 3,
        className: 'termous-notification',
      })
    }
  }

  const runMenuAction = (key: string) => {
    if (key === 'cancel') {
      void onCancel(task.id)
    } else if (key === 'retry') {
      void onRetry(task.id)
    } else if (key === 'open-local-directory') {
      void openLocalDirectory()
    } else if (key === 'delete') {
      void onDelete(task.id)
    }
  }

  const primaryMenuItems: MenuProps['items'] = []
  if (task.cancellable) {
    primaryMenuItems.push(transferMenuItem('cancel', t('files.cancelTransfer'), <CircleStop size={14} />))
  }
  if (task.retryable) {
    primaryMenuItems.push(transferMenuItem('retry', t('files.retryTransfer'), <RotateCcw size={14} />))
  }

  const secondaryMenuItems: MenuProps['items'] = []
  if (localDirectoryPath) {
    secondaryMenuItems.push(
      transferMenuItem('open-local-directory', t('files.openLocalDirectory'), <FolderOpen size={14} />),
    )
  }
  if (canDelete) {
    secondaryMenuItems.push(
      transferMenuItem('delete', t('files.deleteTransferRecord'), <Trash2 size={14} />, true),
    )
  }
  const contextMenuItems: MenuProps['items'] = [...primaryMenuItems, ...secondaryMenuItems]
  const handleMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (!actionBusy) {
      runMenuAction(key)
    }
  }

  return (
    <ContextActionMenu
      items={contextMenuItems}
      onClick={handleMenuClick}
      disabled={actionBusy || contextMenuItems.length === 0}
    >
      <article
        className={`transfer-row ${transferStatusClass(task.status)} ${canDelete ? 'is-history' : ''}`}
        role="listitem"
        aria-label={`${currentName}: ${t(`files.transferStatus.${task.status}`)}`}
      >
        <span className="transfer-kind-icon">
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="transfer-copy">
          <div className="transfer-title-line">
            <Tooltip title={currentName}>
              <strong>{currentName}</strong>
            </Tooltip>
          </div>
          <Tooltip title={task.target_path}>
            <span className="transfer-subline">
              <span>{t(`files.transferType.${task.type}`)} · {task.target_path}</span>
              {hostLabel ? <em>{hostLabel}</em> : null}
            </span>
          </Tooltip>
          {task.error_message ? (
            <Tooltip title={task.error_message}>
              <span className="transfer-error">
                <AlertTriangle size={12} aria-hidden="true" />
                {task.error_message}
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className="transfer-progress-block">
          <div className="transfer-state-line">
            <span className="transfer-state-label">
              <i aria-hidden="true" />
              {t(`files.transferStatus.${task.status}`)}
            </span>
            {isActive || task.status === 'completed' ? <b>{progress}%</b> : null}
          </div>
          <div
            className={`transfer-progress-line ${task.status === 'queued' ? 'is-indeterminate' : ''}`}
            role="progressbar"
            aria-label={`${currentName}: ${t(`files.transferStatus.${task.status}`)}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={task.status === 'queued' ? undefined : progress}
          >
            <span style={task.status === 'queued' ? undefined : { width: `${progress}%` }} />
          </div>
          <div className="transfer-meta-line">
            {task.status === 'running' || task.status === 'queued' ? (
              <>
                <span>{t('files.transferBytes', {
                  done: formatBytes(task.transferred_bytes),
                  total: formatBytes(task.total_bytes),
                })}</span>
                {totalFiles > 1 ? (
                  <span>{t('files.transferFiles', { done: completedFiles, total: totalFiles })}</span>
                ) : null}
                <span>{t('files.transferSpeed', { value: formatBytes(speed) })}</span>
                <span>{t('files.transferEta', { value: formatSeconds(task.eta_seconds) })}</span>
              </>
            ) : (
              <>
                <span>{formatBytes(task.total_bytes || task.transferred_bytes)}</span>
                {totalFiles > 1 ? (
                  <span>{t('files.transferFiles', { done: completedFiles, total: totalFiles })}</span>
                ) : null}
                <span>{t('files.transferElapsed', { value: formatSeconds(task.elapsed_seconds) })}</span>
              </>
            )}
          </div>
        </div>
        <div className="transfer-actions">
          {actionBusy ? (
            <span className="transfer-action-busy" role="status" aria-label={t('app.loading')}>
              <Loader2 size={15} aria-hidden="true" />
            </span>
          ) : (
            <>
              {task.cancellable ? (
                <Tooltip title={t('files.cancelTransfer')}>
                  <Button
                    type="text"
                    size="small"
                    className="files-icon-button transfer-cancel-action"
                    aria-label={t('files.cancelTransfer')}
                    icon={<CircleStop size={15} aria-hidden="true" />}
                    onClick={() => void onCancel(task.id)}
                  />
                </Tooltip>
              ) : null}
              {task.retryable ? (
                <Button
                  type="text"
                  size="small"
                  className="transfer-primary-action"
                  icon={<RotateCcw size={14} aria-hidden="true" />}
                  onClick={() => void onRetry(task.id)}
                >
                  {t('app.retry')}
                </Button>
              ) : null}
              {secondaryMenuItems.length > 0 ? (
                <Dropdown
                  trigger={['click']}
                  placement="bottomRight"
                  classNames={{ root: 'context-action-menu' }}
                  menu={{ items: secondaryMenuItems, onClick: handleMenuClick }}
                >
                  <Tooltip title={t('files.actions')}>
                    <Button
                      type="text"
                      size="small"
                      className="files-icon-button transfer-more-button"
                      aria-label={t('files.actions')}
                      icon={<MoreHorizontal size={15} aria-hidden="true" />}
                    />
                  </Tooltip>
                </Dropdown>
              ) : null}
            </>
          )}
        </div>
      </article>
    </ContextActionMenu>
  )
}

function transferMenuItem(
  key: string,
  label: string,
  icon: ReactNode,
  danger = false,
) {
  return {
    key,
    danger,
    label: (
      <span className="context-action-menu-item">
        <span className="context-action-menu-icon">{icon}</span>
        <span>{label}</span>
      </span>
    ),
  }
}

function resolveTransferLocalDirectory(task: TransferTask) {
  if (task.type.startsWith('download')) {
    return task.local_directory_path || task.target_path
  }
  if (task.type.startsWith('upload')) {
    return task.local_directory_path || ''
  }
  return ''
}
