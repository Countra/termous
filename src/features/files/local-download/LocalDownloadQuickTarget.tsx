import { App as AntdApp, Tooltip } from 'antd'
import { ChevronUp, FolderDown } from 'lucide-react'
import { forwardRef, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { localPathRelativeLabel } from './localDownloadWorkspaceState'
import type { LocalDownloadQuickTargetProps } from './types'
import { useLocalDownloadDrop } from './useLocalDownloadDrop'

export const LocalDownloadQuickTarget = forwardRef<HTMLButtonElement, LocalDownloadQuickTargetProps>(
function LocalDownloadQuickTarget({
  api,
  target,
  session,
  expanded,
  disabled = false,
  className,
  onOpen,
  onDownload,
  onDropActiveChange,
  onOperationActiveChange,
}, ref) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const targetRef = useRef(target)
  targetRef.current = target
  const resolveLatestTarget = useCallback((candidate: NonNullable<typeof target>) => {
    const latestTarget = targetRef.current
    if (
      !latestTarget?.available
      || latestTarget.mappingId !== candidate.mappingId
      || latestTarget.mappingPath !== candidate.mappingPath
      || latestTarget.path !== candidate.path
    ) {
      return null
    }
    return latestTarget
  }, [])
  const messages = useMemo(() => ({
    invalidSelection: t('files.localDownloadInvalidSelection'),
    nativeFilesRejected: t('files.localDownloadNativeFilesRejected'),
    requestNotStarted: t('files.localDownloadNotStarted'),
    targetUnavailable: t('files.downloadDestinationUnavailable'),
  }), [t])
  const drop = useLocalDownloadDrop({
    api,
    session,
    operationEnabled: !disabled,
    messages,
    resolveTarget: resolveLatestTarget,
    onDownload,
    onSurfaceActiveChange: onDropActiveChange,
    onOperationActiveChange,
    onError: (message) => {
      notification.error({
        message,
        placement: 'topRight',
        duration: 3,
        className: 'termous-notification',
      })
    },
  })
  const targetKey = target ? `quick:${target.mappingId}:${target.path}` : ''
  const dropActive = Boolean(drop.activeDropTarget || drop.busyDropTarget)
  const relativePath = target
    ? localPathRelativeLabel(target.path, target.mappingPath)
    : ''
  const accessibleLabel = target
    ? `${t('files.localMappings')}: ${target.mappingName}${relativePath ? ` / ${relativePath}` : ''}`
    : t('files.addLocalMapping')
  const tooltipLabel = target
    ? `${target.mappingName} · ${target.path}`
    : t('files.addLocalMapping')

  return (
    <Tooltip title={tooltipLabel}>
      <button
        ref={ref}
        type="button"
        className={[
          'local-download-quick-target',
          expanded ? 'is-expanded' : '',
          dropActive ? 'is-drop-target' : '',
          drop.busyDropTarget ? 'is-drop-busy' : '',
          target && !target.available ? 'is-unavailable' : '',
          !target ? 'is-empty' : '',
          className ?? '',
        ].filter(Boolean).join(' ')}
        disabled={disabled}
        aria-label={accessibleLabel}
        aria-controls="files-bottom-drawer"
        aria-expanded={expanded}
        onClick={onOpen}
        onDragEnterCapture={drop.onRootDragEnterCapture}
        onDragOverCapture={drop.onRootDragOverCapture}
        onDropCapture={drop.onRootDropCapture}
        onDragLeave={drop.onRootDragLeave}
        onDragOver={(event) => target?.available && drop.onTargetDragOver(targetKey, target, event)}
        onDrop={(event) => target?.available && void drop.onTargetDrop(targetKey, target, event)}
      >
        <FolderDown className="local-download-quick-target-icon" size={15} aria-hidden="true" />
        <span className="local-download-quick-target-copy">
          <span className="local-download-quick-target-label">{t('files.localMappings')}</span>
          <strong>{target?.mappingName ?? t('files.addLocalMapping')}</strong>
          {relativePath ? <small className="local-download-quick-target-path">{relativePath}</small> : null}
        </span>
        <ChevronUp className="local-download-quick-target-chevron" size={13} aria-hidden="true" />
      </button>
    </Tooltip>
  )
})
